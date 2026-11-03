import Foundation
import Network

/// Mini serveur HTTP en lecture seule, sur 127.0.0.1 uniquement, qui sert l'app web embarquée.
/// Pourquoi pas file:// : le chiffrement (WebCrypto) et IndexedDB exigent un « contexte sécurisé »,
/// ce que http://127.0.0.1 est, et un port fixe garde la même origine donc les mêmes données d'une session à l'autre.
final class LocalServer {
    static let port: UInt16 = 47219
    private let root: URL
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "buget.server")

    init(root: URL) { self.root = root.standardizedFileURL }

    func start() throws {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: Self.port)!)
        params.allowLocalEndpointReuse = true
        let l = try NWListener(using: params)
        l.newConnectionHandler = { [weak self] c in self?.handle(c) }
        l.start(queue: queue)
        listener = l
    }

    private func handle(_ c: NWConnection) {
        c.start(queue: queue)
        c.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, _, _ in
            guard let self, let data, let head = String(data: data, encoding: .utf8) else { c.cancel(); return }
            let parts = head.split(separator: "\r\n").first?.split(separator: " ") ?? []
            guard parts.count >= 2, parts[0] == "GET" || parts[0] == "HEAD" else { return self.send(c, 405, "text/plain", Data("405".utf8)) }
            let rawPath = String(parts[1]).split(separator: "?").first.map(String.init) ?? "/"
            let path = (rawPath.removingPercentEncoding ?? rawPath) == "/" ? "/index.html" : (rawPath.removingPercentEncoding ?? rawPath)
            let file = self.root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
            // refuse toute sortie du dossier web (../)
            guard file.path.hasPrefix(self.root.path + "/"), let body = try? Data(contentsOf: file) else {
                return self.send(c, 404, "text/plain", Data("404".utf8))
            }
            self.send(c, 200, Self.mime(file.pathExtension), parts[0] == "HEAD" ? Data() : body, length: body.count)
        }
    }

    private func send(_ c: NWConnection, _ status: Int, _ type: String, _ body: Data, length: Int? = nil) {
        let reason = [200: "OK", 404: "Not Found", 405: "Method Not Allowed"][status] ?? "OK"
        var h = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(type)\r\nContent-Length: \(length ?? body.count)\r\n"
        h += "Cache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nCross-Origin-Resource-Policy: same-origin\r\nConnection: close\r\n\r\n"
        c.send(content: Data(h.utf8) + body, completion: .contentProcessed { _ in c.cancel() })
    }

    static func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": "text/html; charset=utf-8"
        case "js", "mjs": "text/javascript; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "wasm": "application/wasm"
        case "json", "webmanifest": "application/json"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "woff2": "font/woff2"
        default: "application/octet-stream" // .gz du modèle OCR : décompressé par Tesseract lui-même
        }
    }
}
