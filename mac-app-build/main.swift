import Cocoa
import WebKit

/**
 * JS ↔ 原生橋：資料夾選擇（NSOpenPanel）+ 掃描 .md/.txt。
 * WKWebView 的 <input webkitdirectory> 在 file:// 下經常無反應，必須走原生。
 */
final class SpecForgeBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "specforge" else { return }

        var action = ""
        if let dict = message.body as? [String: Any] {
            action = dict["action"] as? String ?? ""
        } else if let s = message.body as? String {
            action = s
        }

        switch action {
        case "pickFolder":
            DispatchQueue.main.async { [weak self] in
                self?.pickFolder()
            }
        case "pickProjectFolder":
            // 綁定／新建專案資料夾：面板文案不同，且允許在面板裡直接建新資料夾
            DispatchQueue.main.async { [weak self] in
                self?.pickFolder(bindMode: true)
            }
        case "projectStats":
            // 專案儀表板要的三件事：git 狀態、技術線、資料夾容量。
            // 全部只能在原生端算 —— WebView 看不到磁碟，也跑不了 git。
            guard let dict = message.body as? [String: Any],
                  let path = dict["folderPath"] as? String, !path.isEmpty
            else {
                postToJS(["type": "projectStatsError", "message": "缺少 folderPath"])
                return
            }
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let stats = Self.collectStats(URL(fileURLWithPath: path))
                DispatchQueue.main.async { self?.postToJS(stats) }
            }
        case "onefetch":
            // 歡迎畫面用。onefetch 有 --output json，不必解析 ANSI。
            guard let dict = message.body as? [String: Any],
                  let path = dict["folderPath"] as? String, !path.isEmpty
            else {
                postToJS(["type": "onefetchError", "message": "缺少 folderPath"])
                return
            }
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let dir = URL(fileURLWithPath: path)
                guard let raw = Self.runTool("onefetch", ["--output", "json"], in: dir) else {
                    DispatchQueue.main.async {
                        self?.postToJS([
                            "type": "onefetchError",
                            "message": "找不到 onefetch，或這不是 git 專案。可用 brew install onefetch 安裝。",
                        ])
                    }
                    return
                }
                DispatchQueue.main.async {
                    self?.postToJS(["type": "onefetch", "folderPath": dir.path, "raw": raw])
                }
            }
        case "ping":
            postToJS([
                "type": "pong",
                "native": true,
                "capabilities": ["pickFolder", "pickProjectFolder", "createDirectories"],
            ])
        default:
            NSLog("SpecForge bridge unknown action: \(action)")
        }
    }

    /// 選單 / JS 共用
    func pickFolder(bindMode: Bool = false) {
        let hostWindow = webView?.window ?? NSApp.keyWindow ?? NSApp.mainWindow

        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        // App 本身不寫磁碟；「新增資料夾」由 NSOpenPanel 自己完成，
        // 這是這個 app 能建資料夾的唯一途徑，兩種模式都開放。
        panel.canCreateDirectories = true
        panel.treatsFilePackagesAsDirectories = true
        if bindMode {
            panel.message = "選擇這份 PRD 對應的專案資料夾。沒有的話，用左下角「新增資料夾」建一個。"
            panel.prompt = "使用此資料夾"
            panel.title = "指定專案資料夾"
        } else {
            panel.message = "選擇要匯入的專案資料夾（將掃描其中的 Markdown／文字檔）"
            panel.prompt = "選擇此資料夾"
            panel.title = "專案匯入"
        }
        panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser

        let handle: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard let self = self else { return }
            guard response == .OK, let url = panel.url else {
                self.postToJS(["type": "folderPickCancelled"])
                return
            }

            DispatchQueue.global(qos: .userInitiated).async {
                let accessed = url.startAccessingSecurityScopedResource()
                defer {
                    if accessed { url.stopAccessingSecurityScopedResource() }
                }

                let files = Self.scanDirectory(url)
                let payload: [String: Any] = [
                    "type": bindMode ? "projectFolderPickResult" : "folderPickResult",
                    "folderName": url.lastPathComponent,
                    "folderPath": url.path,
                    "files": files,
                ]
                DispatchQueue.main.async {
                    self.postToJS(payload)
                }
            }
        }

        if let hostWindow = hostWindow {
            panel.beginSheetModal(for: hostWindow, completionHandler: handle)
        } else {
            panel.begin(completionHandler: handle)
        }
    }

    // MARK: - 專案統計（儀表板用）

    /**
     * 只跑寫死的 git 子指令，資料夾路徑當工作目錄傳入 —— 不接受任何來自 JS 的
     * 參數字串，避免命令注入。非 git 專案就安靜回空值，不當成錯誤。
     */
    private static func git(_ args: [String], in dir: URL) -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["git", "-C", dir.path] + args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else { return nil }
        return String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /**
     * 跑一個外部 CLI。走 /usr/bin/env 並補上 Homebrew 路徑 ——
     * GUI app 繼承的 PATH 通常沒有 /opt/homebrew/bin，直接 env onefetch 會找不到。
     */
    static func runTool(_ tool: String, _ args: [String], in dir: URL) -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = [tool] + args
        p.currentDirectoryURL = dir
        var env = ProcessInfo.processInfo.environment
        let extra = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        env["PATH"] = (env["PATH"].map { "\($0):\(extra)" }) ?? extra
        p.environment = env
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// 走完整個資料夾：容量、副檔名分佈、manifest 檔名。文字檔那條路只收 .md/.txt，
    /// 這裡要看到 .ts/.rs/.py 才算得出技術線，所以是另一趟走訪。
    static func collectStats(_ root: URL) -> [String: Any] {
        let fm = FileManager.default
        let skip: Set<String> = [
            "node_modules", ".git", "dist", "build", ".next", "target",
            "coverage", "vendor", ".turbo", ".cache", "DerivedData", ".venv", "__pycache__",
        ]
        var totalBytes: Int64 = 0
        var fileCount = 0
        var extBytes: [String: Int64] = [:]
        var extCount: [String: Int] = [:]
        var manifests: [String] = []
        /// 這些檔名決定框架判定，體積小，直接讀回內容交給 JS 判
        let manifestNames: Set<String> = [
            "package.json", "cargo.toml", "go.mod", "pyproject.toml", "requirements.txt",
            "gemfile", "pom.xml", "build.gradle", "composer.json", "pubspec.yaml",
            "package.swift", "podfile", "dockerfile", "docker-compose.yml", "makefile",
        ]
        var manifestBodies: [[String: String]] = []

        if let e = fm.enumerator(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey, .isDirectoryKey],
            options: []
        ) {
            for case let url as URL in e {
                if url.pathComponents.contains(where: { skip.contains($0) }) {
                    e.skipDescendants()
                    continue
                }
                let v = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                guard v?.isRegularFile == true else { continue }
                let size = Int64(v?.fileSize ?? 0)
                totalBytes += size
                fileCount += 1

                let ext = url.pathExtension.lowercased()
                if !ext.isEmpty {
                    extBytes[ext, default: 0] += size
                    extCount[ext, default: 0] += 1
                }

                let name = url.lastPathComponent.lowercased()
                if manifestNames.contains(name), manifests.count < 20 {
                    manifests.append(url.lastPathComponent)
                    // 只讀小檔，framework 判定不需要整包
                    if size < 96 * 1024,
                       let d = try? Data(contentsOf: url),
                       let text = String(data: d, encoding: .utf8) {
                        manifestBodies.append(["name": url.lastPathComponent, "text": text])
                    }
                }
            }
        }

        var payload: [String: Any] = [
            "type": "projectStats",
            "folderPath": root.path,
            "totalBytes": totalBytes,
            "fileCount": fileCount,
            "extBytes": extBytes.mapValues { Int($0) },
            "extCount": extCount,
            "manifests": manifests,
            "manifestBodies": manifestBodies,
        ]

        // git：不是 repo 就整段留空，前端顯示「非 git 專案」而不是報錯
        if let head = git(["rev-parse", "--short", "HEAD"], in: root) {
            var g: [String: Any] = ["head": head]
            g["branch"] = git(["rev-parse", "--abbrev-ref", "HEAD"], in: root) ?? ""
            g["lastMessage"] = git(["log", "-1", "--pretty=%s"], in: root) ?? ""
            g["lastAt"] = git(["log", "-1", "--pretty=%cI"], in: root) ?? ""
            g["author"] = git(["log", "-1", "--pretty=%an"], in: root) ?? ""
            // porcelain 每行一個變更檔；空字串代表乾淨
            let dirty = git(["status", "--porcelain"], in: root) ?? ""
            g["dirtyCount"] = dirty.isEmpty ? 0 : dirty.split(separator: "\n").count
            g["remote"] = git(["remote", "get-url", "origin"], in: root) ?? ""
            // 落後／超前 origin：沒有 upstream 就留 -1，前端顯示「未追蹤遠端」
            if let ab = git(["rev-list", "--left-right", "--count", "@{u}...HEAD"], in: root) {
                let parts = ab.split(whereSeparator: { $0 == "\t" || $0 == " " })
                g["behind"] = Int(parts.first ?? "0") ?? 0
                g["ahead"] = Int(parts.count > 1 ? parts[1] : "0") ?? 0
            } else {
                g["behind"] = -1
                g["ahead"] = -1
            }
            g["tag"] = git(["describe", "--tags", "--abbrev=0"], in: root) ?? ""

            // commit 列表：欄位用 \u{1F} 分隔，避免 commit 訊息裡的 | 把欄位切爛
            if let log = git(
                ["log", "-n", "40", "--pretty=%h\u{1F}%s\u{1F}%cI\u{1F}%an\u{1F}%D"],
                in: root
            ) {
                g["commits"] = log.split(separator: "\n").map { line -> [String: String] in
                    let f = line.components(separatedBy: "\u{1F}")
                    return [
                        "hash": f.count > 0 ? f[0] : "",
                        "subject": f.count > 1 ? f[1] : "",
                        "at": f.count > 2 ? f[2] : "",
                        "author": f.count > 3 ? f[3] : "",
                        // %D 給 refs：HEAD -> main, tag: v1.2.0
                        "refs": f.count > 4 ? f[4] : "",
                    ]
                }
            }

            // worktree：porcelain 以空行分段，每段 worktree/HEAD/branch 三行
            if let wt = git(["worktree", "list", "--porcelain"], in: root) {
                var list: [[String: String]] = []
                var cur: [String: String] = [:]
                for line in wt.split(separator: "\n", omittingEmptySubsequences: false) {
                    let l = String(line)
                    if l.isEmpty {
                        if !cur.isEmpty { list.append(cur); cur = [:] }
                        continue
                    }
                    if l.hasPrefix("worktree ") { cur["path"] = String(l.dropFirst(9)) }
                    else if l.hasPrefix("HEAD ") { cur["head"] = String(String(l.dropFirst(5)).prefix(7)) }
                    else if l.hasPrefix("branch ") {
                        cur["branch"] = String(l.dropFirst(7)).replacingOccurrences(of: "refs/heads/", with: "")
                    } else if l == "detached" { cur["branch"] = "(detached)" }
                    else if l == "bare" { cur["branch"] = "(bare)" }
                }
                if !cur.isEmpty { list.append(cur) }
                g["worktrees"] = list
            }

            // 本地 branch：附最後提交時間，讓「哪條還活著」看得出來
            if let br = git(
                ["for-each-ref", "--sort=-committerdate", "--count=30",
                 "--format=%(refname:short)\u{1F}%(committerdate:iso8601)\u{1F}%(HEAD)",
                 "refs/heads"],
                in: root
            ), !br.isEmpty {
                g["branches"] = br.split(separator: "\n").map { line -> [String: String] in
                    let f = line.components(separatedBy: "\u{1F}")
                    return [
                        "name": f.count > 0 ? f[0] : "",
                        "at": f.count > 1 ? f[1] : "",
                        // %(HEAD) 在目前分支是 "*"
                        "current": (f.count > 2 && f[2] == "*") ? "1" : "",
                    ]
                }
            }

            // tag 依建立時間新到舊，附上指向的 commit
            if let tags = git(
                ["for-each-ref", "--sort=-creatordate", "--count=20",
                 // contents:subject：annotated tag 給 tag 訊息，
                 // lightweight tag 給它指向的 commit 主旨 —— 兩種都是「這版做了什麼」
                 "--format=%(refname:short)\u{1F}%(objectname:short)\u{1F}%(creatordate:iso8601)\u{1F}%(contents:subject)",
                 "refs/tags"],
                in: root
            ), !tags.isEmpty {
                g["tags"] = tags.split(separator: "\n").map { line -> [String: String] in
                    let f = line.components(separatedBy: "\u{1F}")
                    return [
                        "name": f.count > 0 ? f[0] : "",
                        "hash": f.count > 1 ? f[1] : "",
                        "at": f.count > 2 ? f[2] : "",
                        "subject": f.count > 3 ? f[3] : "",
                    ]
                }
            }
            g["commitCount"] = Int(git(["rev-list", "--count", "HEAD"], in: root) ?? "0") ?? 0
            payload["git"] = g
        }

        return payload
    }

    /// 遞迴掃描文字檔；path 格式與 webkitRelativePath 對齊：FolderName/rel/path.md
    /// 供 AppDelegate 的 handoff 流程重用同一份掃描邏輯
    static func scanDirectoryPublic(_ root: URL) -> [[String: Any]] { scanDirectory(root) }

    /// 供 AppDelegate 的 handoff 流程送資料進 JS
    func postToJSPublic(_ payload: [String: Any]) { postToJS(payload) }

    private static func scanDirectory(_ root: URL) -> [[String: Any]] {
        var results: [[String: Any]] = []
        let fm = FileManager.default
        let textExts: Set<String> = ["md", "markdown", "txt", "mdx", "rst"]
        let skipNames: Set<String> = [
            "node_modules", ".git", "dist", "build", ".next",
            "coverage", "vendor", ".turbo", ".cache", "DerivedData",
        ]
        let maxBytes = 512 * 1024
        let maxFiles = 200
        let maxTotalChars = 4_000_000 // 避免 evaluateJavaScript 塞爆

        guard let enumerator = fm.enumerator(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey, .isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else {
            return results
        }

        let rootPath = root.standardizedFileURL.path
        let folderName = root.lastPathComponent
        var totalChars = 0

        for case let fileURL as URL in enumerator {
            if results.count >= maxFiles { break }
            let standardized = fileURL.standardizedFileURL

            if standardized.pathComponents.contains(where: { skipNames.contains($0) }) {
                enumerator.skipDescendants()
                continue
            }

            let values = try? standardized.resourceValues(forKeys: [
                .isRegularFileKey, .isDirectoryKey, .fileSizeKey,
            ])
            if values?.isDirectory == true { continue }
            guard values?.isRegularFile == true else { continue }

            let ext = standardized.pathExtension.lowercased()
            guard textExts.contains(ext) else { continue }

            let size = values?.fileSize ?? 0
            if size <= 0 || size > maxBytes { continue }

            guard let data = try? Data(contentsOf: standardized),
                  let text = String(data: data, encoding: .utf8),
                  !text.contains("\0")
            else { continue }

            if totalChars + text.count > maxTotalChars { break }
            totalChars += text.count

            var rel = standardized.path
            if rel.hasPrefix(rootPath) {
                rel = String(rel.dropFirst(rootPath.count))
                if rel.hasPrefix("/") { rel = String(rel.dropFirst()) }
            }
            let path = rel.isEmpty
                ? "\(folderName)/\(standardized.lastPathComponent)"
                : "\(folderName)/\(rel)"

            results.append([
                "path": path.replacingOccurrences(of: "\\", with: "/"),
                "name": standardized.lastPathComponent,
                "size": size,
                "text": text,
            ])
        }

        return results
    }

    private func postToJS(_ payload: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let json = String(data: data, encoding: .utf8)
        else {
            NSLog("SpecForge bridge: failed to serialize payload")
            return
        }
        let script = """
        (function(){
          try {
            var payload = \(json);
            if (typeof window.__specforgeNativeFolderResult === 'function') {
              window.__specforgeNativeFolderResult(payload);
            }
            window.dispatchEvent(new CustomEvent('specforge-native', { detail: payload }));
          } catch (e) {
            console.error('specforge native callback', e);
          }
        })();
        """
        webView?.evaluateJavaScript(script, completionHandler: { _, error in
            if let error = error {
                NSLog("SpecForge bridge JS error: \(error.localizedDescription)")
            }
        })
    }
}

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    /// 必須強引用，否則 message handler 會被釋放
    private let bridge = SpecForgeBridge()

    private var appDisplayName: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
            ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String)
            ?? "PRD開發監控台"
    }

    private func setupMainMenu() {
        let mainMenu = NSMenu()
        let name = appDisplayName

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "關於 \(name)",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(
            withTitle: "隱藏 \(name)",
            action: #selector(NSApplication.hide(_:)),
            keyEquivalent: "h"
        )
        let hideOthers = NSMenuItem(
            title: "隱藏其他",
            action: #selector(NSApplication.hideOtherApplications(_:)),
            keyEquivalent: "h"
        )
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(
            withTitle: "顯示全部",
            action: #selector(NSApplication.unhideAllApplications(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(NSMenuItem.separator())
        let quit = NSMenuItem(
            title: "結束 \(name)",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        quit.keyEquivalentModifierMask = .command
        appMenu.addItem(quit)
        appItem.submenu = appMenu

        let fileItem = NSMenuItem()
        mainMenu.addItem(fileItem)
        let fileMenu = NSMenu(title: "檔案")
        let importItem = NSMenuItem(
            title: "專案匯入資料夾…",
            action: #selector(menuPickFolder(_:)),
            keyEquivalent: "o"
        )
        importItem.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(importItem)
        fileItem.submenu = fileMenu

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "編輯")
        editMenu.addItem(withTitle: "還原", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "剪下", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷貝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "貼上", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全選", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: "視窗")
        windowMenu.addItem(withTitle: "縮小", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "縮放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(NSMenuItem.separator())
        windowMenu.addItem(
            withTitle: "將全部移到最前",
            action: #selector(NSApplication.arrangeInFront(_:)),
            keyEquivalent: ""
        )
        windowItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
    }

    @objc private func menuPickFolder(_ sender: Any?) {
        bridge.pickFolder()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMainMenu()

        let screenSize = NSScreen.main?.visibleFrame.size ?? CGSize(width: 1280, height: 850)
        let windowWidth: CGFloat = min(1280, screenSize.width * 0.9)
        let windowHeight: CGFloat = min(850, screenSize.height * 0.9)

        let windowRect = NSRect(
            x: (screenSize.width - windowWidth) / 2,
            y: (screenSize.height - windowHeight) / 2,
            width: windowWidth,
            height: windowHeight
        )

        window = NSWindow(
            contentRect: windowRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )

        window.title = "\(appDisplayName) — PRD 引導工作台"
        window.titlebarAppearsTransparent = false
        window.titleVisibility = .visible
        window.isMovableByWindowBackground = true
        window.minSize = NSSize(width: 800, height: 600)
        window.center()
        window.backgroundColor = NSColor(calibratedRed: 0.047, green: 0.043, blue: 0.039, alpha: 1)

        let config = WKWebViewConfiguration()
        let prefs = WKPreferences()
        prefs.javaScriptCanOpenWindowsAutomatically = true
        prefs.setValue(true, forKey: "developerExtrasEnabled")
        prefs.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.preferences = prefs
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        config.userContentController.add(bridge, name: "specforge")
        let boot = WKUserScript(
            source: """
            window.__SPECFORGE_NATIVE__ = true;
            window.__specforgeHasNativeFolder = true;
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(boot)

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        bridge.webView = webView
        if #available(macOS 12.0, *) {
            webView.underPageBackgroundColor = NSColor(calibratedRed: 0.047, green: 0.043, blue: 0.039, alpha: 1)
        }

        window.contentView?.addSubview(webView)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        let mainBundle = Bundle.main
        let distDir: URL
        let indexURL: URL

        func pickEntry(in dist: URL) -> URL {
            let login = dist.appendingPathComponent("login.html")
            let onboard = dist.appendingPathComponent("onboarding.html")
            let index = dist.appendingPathComponent("index.html")
            if FileManager.default.fileExists(atPath: login.path) { return login.standardizedFileURL }
            if FileManager.default.fileExists(atPath: onboard.path) { return onboard.standardizedFileURL }
            return index.standardizedFileURL
        }

        if let distPath = mainBundle.resourceURL?.appendingPathComponent("dist", isDirectory: true),
           FileManager.default.fileExists(atPath: distPath.appendingPathComponent("index.html").path) {
            distDir = distPath.standardizedFileURL
            indexURL = pickEntry(in: distDir)
        } else if let distPath = mainBundle.path(forResource: "dist", ofType: nil) {
            distDir = URL(fileURLWithPath: distPath, isDirectory: true).standardizedFileURL
            indexURL = pickEntry(in: distDir)
        } else {
            let currentDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            distDir = currentDir.appendingPathComponent("dist", isDirectory: true).standardizedFileURL
            indexURL = pickEntry(in: distDir)
        }

        guard FileManager.default.fileExists(atPath: indexURL.path) else {
            let alert = NSAlert()
            alert.messageText = "找不到介面檔案"
            alert.informativeText = "預期路徑：\n\(indexURL.path)"
            alert.runModal()
            NSApp.terminate(nil)
            return
        }

        // 資料夾內容由原生讀取後以 JSON 注入，不需擴張 allowingReadAccessTo
        webView.loadFileURL(indexURL, allowingReadAccessTo: distDir)
    }

    // MARK: - Agent 交接（handoff）
    //
    // agent（Skill）在終端問完問題、把資料夾與 seed 檔寫好之後，
    // 會丟一個 handoff 檔再 `open -a` 這個 App。App 啟動／回到前景時讀它，
    // 掃描該資料夾並把結果交給 JS，使用者不必自己去找「專案匯入」。
    //
    // 用 drop file 而不是註冊 URL scheme：少一半程式碼，而且未簽章的 app
    // 走 LaunchServices 註冊 scheme 常常靜默失敗。
    private static var handoffURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".specforge/handoff.json")
    }

    func consumeHandoffIfAny() {
        let url = Self.handoffURL
        guard let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let folderPath = obj["folderPath"] as? String
        else { return }

        // 消費即刪除：同一份交接只生效一次，否則每次切回前景都會重跑
        try? FileManager.default.removeItem(at: url)

        let folderURL = URL(fileURLWithPath: folderPath)
        guard FileManager.default.fileExists(atPath: folderURL.path) else {
            NSLog("SpecForge handoff: folder not found \(folderPath)")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let files = SpecForgeBridge.scanDirectoryPublic(folderURL)
            let payload: [String: Any] = [
                "type": "agentHandoff",
                "folderName": folderURL.lastPathComponent,
                "folderPath": folderURL.path,
                "files": files,
                "title": obj["title"] as? String ?? folderURL.lastPathComponent,
                "section": obj["section"] as? String ?? "",
            ]
            DispatchQueue.main.async { self.bridge.postToJSPublic(payload) }
        }
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        // App 已經開著時，agent 再丟一份交接也要吃得到
        consumeHandoffIfAny()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        consumeHandoffIfAny()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("SpecForge load failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("SpecForge navigation failed: \(error.localizedDescription)")
    }

    // MARK: - JS dialogs（預設 WKWebView 不實作 → prompt/alert/confirm 全無效）

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = appDisplayName
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = appDisplayName
        alert.informativeText = message
        alert.addButton(withTitle: "確定")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = appDisplayName
        alert.informativeText = prompt
        alert.addButton(withTitle: "確定")
        alert.addButton(withTitle: "取消")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        field.isEditable = true
        field.isSelectable = true
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        alert.beginSheetModal(for: window) { response in
            if response == .alertFirstButtonReturn {
                completionHandler(field.stringValue)
            } else {
                completionHandler(nil)
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        return .terminateNow
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
