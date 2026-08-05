import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let screenSize = NSScreen.main?.visibleFrame.size ?? CGSize(width: 1280, height: 850)
        let windowWidth: CGFloat = min(1280, screenSize.width * 0.9)
        let windowHeight: CGFloat = min(850, screenSize.height * 0.9)

        let windowRect = NSRect(
            x: (screenSize.width - windowWidth) / 2,
            y: (screenSize.height - windowHeight) / 2,
            width: windowWidth,
            height: windowHeight
        )

        // 使用標準 titlebar（可拖曳移動視窗），避免 fullSizeContentView
        // 讓系統紅綠燈與 Web 內容重疊、以及無法拖曳的問題。
        window = NSWindow(
            contentRect: windowRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )

        window.title = "SpecForge — PRD 引導工作台"
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

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        if #available(macOS 12.0, *) {
            webView.underPageBackgroundColor = NSColor(calibratedRed: 0.047, green: 0.043, blue: 0.039, alpha: 1)
        }

        window.contentView?.addSubview(webView)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        let mainBundle = Bundle.main
        let distDir: URL
        let indexURL: URL
        if let distPath = mainBundle.resourceURL?.appendingPathComponent("dist", isDirectory: true),
           FileManager.default.fileExists(atPath: distPath.appendingPathComponent("index.html").path) {
            distDir = distPath.standardizedFileURL
            let login = distPath.appendingPathComponent("login.html")
            indexURL = (FileManager.default.fileExists(atPath: login.path) ? login : distPath.appendingPathComponent("index.html")).standardizedFileURL
        } else if let distPath = mainBundle.path(forResource: "dist", ofType: nil) {
            distDir = URL(fileURLWithPath: distPath, isDirectory: true).standardizedFileURL
            let login = distDir.appendingPathComponent("login.html")
            indexURL = FileManager.default.fileExists(atPath: login.path) ? login : distDir.appendingPathComponent("index.html")
        } else {
            let currentDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            distDir = currentDir.appendingPathComponent("dist", isDirectory: true).standardizedFileURL
            let login = distDir.appendingPathComponent("login.html")
            indexURL = FileManager.default.fileExists(atPath: login.path) ? login : distDir.appendingPathComponent("index.html")
        }

        guard FileManager.default.fileExists(atPath: indexURL.path) else {
            let alert = NSAlert()
            alert.messageText = "找不到介面檔案"
            alert.informativeText = "預期路徑：\n\(indexURL.path)"
            alert.runModal()
            NSApp.terminate(nil)
            return
        }

        webView.loadFileURL(indexURL, allowingReadAccessTo: distDir)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("SpecForge load failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("SpecForge navigation failed: \(error.localizedDescription)")
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
