import AppKit
import UniformTypeIdentifiers
import WebKit

/// Buget : fenêtre native qui affiche l'app web locale (données chiffrées dans le stockage de WebKit propre à l'app).
final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate, WKScriptMessageHandlerWithReply {
    var window: NSWindow!
    var webView: WKWebView!
    var popups: [NSWindow] = []
    let home = URL(string: "http://127.0.0.1:\(LocalServer.port)/")!
    var server: LocalServer?

    func applicationDidFinishLaunching(_ note: Notification) {
        guard let web = Bundle.main.resourceURL?.appendingPathComponent("web"), FileManager.default.fileExists(atPath: web.path) else {
            fatal("Fichiers de l’app introuvables dans le paquet.")
        }
        do { server = LocalServer(root: web); try server?.start() }
        catch { fatal("Impossible de démarrer Buget (port \(LocalServer.port) déjà utilisé ?).\n\(error.localizedDescription)") }

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // persistant : la base chiffrée survit aux redémarrages
        config.applicationNameForUserAgent = "BugetMac/1.0"
        config.preferences.isElementFullscreenEnabled = true
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "bugetAuth")
        webView = makeWebView(config)

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Buget"
        window.minSize = NSSize(width: 380, height: 500)
        window.contentView = webView
        window.setFrameAutosaveName("BugetMain")
        if !window.setFrameUsingName("BugetMain") { window.center() }
        window.makeKeyAndOrderFront(nil)
        buildMenu()
        // laisse au serveur le temps d'écouter
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.webView.load(URLRequest(url: self.home)) }
        NSApp.activate()
    }

    func makeWebView(_ config: WKWebViewConfiguration) -> WKWebView {
        let w = WKWebView(frame: .zero, configuration: config)
        w.uiDelegate = self
        w.navigationDelegate = self
        w.isInspectable = true
        w.allowsBackForwardNavigationGestures = false
        return w
    }

    // MARK: pont Touch ID ↔ app web (réservé à la page principale de l'app, servie par 127.0.0.1)
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage, replyHandler reply: @escaping (Any?, String?) -> Void) {
        let o = m.frameInfo.securityOrigin
        guard m.frameInfo.isMainFrame, o.host == "127.0.0.1", o.port == Int(LocalServer.port), m.webView === webView,
              let body = m.body as? [String: Any], let action = body["action"] as? String else { return reply(nil, "Refusé") }
        switch action {
        case "status": reply(["available": TouchID.available, "enrolled": TouchID.enrolled], nil)
        case "enroll":
            guard TouchID.available, let pw = body["password"] as? String, !pw.isEmpty else { return reply(nil, "Touch ID indisponible") }
            do { try TouchID.enroll(secret: pw); reply(true, nil) } catch { reply(nil, error.localizedDescription) }
        case "unlock":
            guard TouchID.enrolled else { return reply(nil, "Touch ID n’est pas activé") }
            Task { @MainActor in
                do { reply(try await TouchID.unlock(), nil) } catch { reply(nil, error.localizedDescription) }
            }
        case "disable": TouchID.disable(); reply(true, nil)
        default: reply(nil, "Action inconnue")
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }

    func fatal(_ msg: String) -> Never {
        let a = NSAlert(); a.messageText = "Buget"; a.informativeText = msg; a.runModal(); exit(1)
    }

    // MARK: menus (sans eux, copier/coller et ⌘Q ne fonctionnent pas)
    func buildMenu() {
        let main = NSMenu()
        func sub(_ title: String, _ items: [NSMenuItem]) { let m = NSMenu(title: title); items.forEach(m.addItem); let i = NSMenuItem(); i.submenu = m; main.addItem(i) }
        func item(_ t: String, _ s: Selector?, _ k: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem { let i = NSMenuItem(title: t, action: s, keyEquivalent: k); i.keyEquivalentModifierMask = mods; return i }
        sub("Buget", [item("À propos de Buget", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""), .separator(),
                      item("Masquer Buget", #selector(NSApplication.hide(_:)), "h"), .separator(),
                      item("Quitter Buget", #selector(NSApplication.terminate(_:)), "q")])
        sub("Édition", [item("Annuler", Selector(("undo:")), "z"), item("Rétablir", Selector(("redo:")), "Z", [.command, .shift]), .separator(),
                        item("Couper", #selector(NSText.cut(_:)), "x"), item("Copier", #selector(NSText.copy(_:)), "c"),
                        item("Coller", #selector(NSText.paste(_:)), "v"), item("Tout sélectionner", #selector(NSText.selectAll(_:)), "a")])
        sub("Présentation", [item("Recharger", #selector(reload), "r"), item("Taille réelle", #selector(zoomReset), "0"),
                             item("Agrandir", #selector(zoomIn), "+"), item("Réduire", #selector(zoomOut), "-"), .separator(),
                             item("Plein écran", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])])
        sub("Fenêtre", [item("Placer dans le Dock", #selector(NSWindow.miniaturize(_:)), "m"), item("Fermer", #selector(NSWindow.performClose(_:)), "w")])
        NSApp.mainMenu = main
    }
    @objc func reload() { webView.reload() }
    @objc func zoomIn() { webView.pageZoom = min(2, webView.pageZoom + 0.1) }
    @objc func zoomOut() { webView.pageZoom = max(0.5, webView.pageZoom - 0.1) }
    @objc func zoomReset() { webView.pageZoom = 1 }

    // MARK: boîtes de dialogue JavaScript (sans elles, confirm() renvoie toujours « non »)
    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = m; a.beginSheetModal(for: w.window ?? window) { _ in done() }
    }
    func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = m; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Annuler")
        a.beginSheetModal(for: w.window ?? window) { done($0 == .alertFirstButtonReturn) }
    }
    func webView(_ w: WKWebView, runJavaScriptTextInputPanelWithPrompt p: String, defaultText: String?, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = p; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Annuler")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24)); field.stringValue = defaultText ?? ""; a.accessoryView = field
        a.beginSheetModal(for: w.window ?? window) { done($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    // MARK: choix de fichier (import de relevés, pièces jointes, restauration)
    func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = p.allowsMultipleSelection; panel.canChooseDirectories = false
        panel.beginSheetModal(for: w.window ?? window) { done($0 == .OK ? panel.urls : nil) }
    }

    // MARK: fenêtres ouvertes par l'app (aperçu d'une pièce jointe)
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = action.request.url, u.scheme == "http" || u.scheme == "https", u.host != "127.0.0.1" { NSWorkspace.shared.open(u); return nil }
        let child = makeWebView(c)
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        win.contentView = child; win.title = "Buget"; win.isReleasedWhenClosed = false; win.center(); win.makeKeyAndOrderFront(nil)
        popups.append(win)
        return child
    }

    // MARK: navigation : liens externes dans le navigateur, téléchargements dans ~/Téléchargements
    func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload { return decisionHandler(.download) }
        if let u = action.request.url, u.scheme == "http" || u.scheme == "https", u.host != "127.0.0.1" {
            NSWorkspace.shared.open(u); return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }
    func webView(_ w: WKWebView, decidePolicyFor r: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(r.canShowMIMEType ? .allow : .download)
    }
    func webView(_ w: WKWebView, navigationAction a: WKNavigationAction, didBecome d: WKDownload) { d.delegate = self }
    func webView(_ w: WKWebView, navigationResponse r: WKNavigationResponse, didBecome d: WKDownload) { d.delegate = self }

    func download(_ d: WKDownload, decideDestinationUsing r: URLResponse, suggestedFilename name: String, completionHandler done: @escaping (URL?) -> Void) {
        let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        var url = dir.appendingPathComponent(name), n = 1
        while FileManager.default.fileExists(atPath: url.path) {
            let base = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
            url = dir.appendingPathComponent("\(base) (\(n))" + (ext.isEmpty ? "" : ".\(ext)")); n += 1
        }
        lastDownload = url
        done(url)
    }
    var lastDownload: URL?
    func downloadDidFinish(_ d: WKDownload) { if let u = lastDownload { NSWorkspace.shared.activateFileViewerSelecting([u]) } }
    func download(_ d: WKDownload, didFailWithError e: Error, resumeData: Data?) {
        let a = NSAlert(); a.messageText = "Téléchargement impossible"; a.informativeText = e.localizedDescription; a.runModal()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
