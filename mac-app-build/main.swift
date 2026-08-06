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
        case "ping":
            postToJS([
                "type": "pong",
                "native": true,
                "capabilities": ["pickFolder"],
            ])
        default:
            NSLog("SpecForge bridge unknown action: \(action)")
        }
    }

    /// 選單 / JS 共用
    func pickFolder() {
        let hostWindow = webView?.window ?? NSApp.keyWindow ?? NSApp.mainWindow

        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.treatsFilePackagesAsDirectories = true
        panel.message = "選擇要匯入的專案資料夾（將掃描其中的 Markdown／文字檔）"
        panel.prompt = "選擇此資料夾"
        panel.title = "專案匯入"
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
                    "type": "folderPickResult",
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

    /// 遞迴掃描文字檔；path 格式與 webkitRelativePath 對齊：FolderName/rel/path.md
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
