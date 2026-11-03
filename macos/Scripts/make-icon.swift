// Dessine l'icône (1024 px, gabarit macOS : carré arrondi de 824 px centré) → AppIcon.icns via iconutil.
import AppKit
let out = CommandLine.arguments[1]
func png(_ size: Int) -> Data {
    let img = NSImage(size: NSSize(width: size, height: size), flipped: false) { _ in
        let s = CGFloat(size) / 1024
        let card = NSBezierPath(roundedRect: NSRect(x: 100 * s, y: 100 * s, width: 824 * s, height: 824 * s), xRadius: 185 * s, yRadius: 185 * s)
        NSGradient(starting: NSColor(srgbRed: 0.24, green: 0.55, blue: 0.93, alpha: 1), ending: NSColor(srgbRed: 0.13, green: 0.38, blue: 0.78, alpha: 1))!.draw(in: card, angle: -90)
        for (i, (h, a)) in [(220.0, 0.7), (360.0, 0.85), (540.0, 1.0)].enumerated() {
            NSColor.white.withAlphaComponent(a).setFill()
            NSBezierPath(roundedRect: NSRect(x: (250 + Double(i) * 200) * s, y: 260 * s, width: 125 * s, height: h * s), xRadius: 24 * s, yRadius: 24 * s).fill()
        }
        return true
    }
    let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
    return rep.representation(using: .png, properties: [:])!
}
let set = out + "/AppIcon.iconset"
try? FileManager.default.createDirectory(atPath: set, withIntermediateDirectories: true)
for b in [16, 32, 128, 256, 512] {
    try! png(b).write(to: URL(fileURLWithPath: "\(set)/icon_\(b)x\(b).png"))
    try! png(b * 2).write(to: URL(fileURLWithPath: "\(set)/icon_\(b)x\(b)@2x.png"))
}
