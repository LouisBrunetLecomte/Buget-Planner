// Icônes à partir de macos/Resources/icon-source.png :
//  - Mac : gabarit macOS (carré arrondi de 824 px centré dans 1024, bords transparents) → AppIcon.iconset
//  - web/téléphone (si un 2e argument est donné) : carrés pleins pwa-192, pwa-512, apple-touch-icon, favicon
import AppKit
let args = CommandLine.arguments
let src = NSImage(contentsOfFile: args[1])!
let out = args[2]
let web = args.count > 3 ? args[3] : nil

func render(_ size: Int, rounded: Bool) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                               isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    let s = CGFloat(size) / 1024
    let rect = rounded ? NSRect(x: 100 * s, y: 100 * s, width: 824 * s, height: 824 * s) : NSRect(x: 0, y: 0, width: size, height: size)
    if rounded { NSBezierPath(roundedRect: rect, xRadius: 185 * s, yRadius: 185 * s).addClip() }
    // recadrage carré centré de l'image source
    let side = min(src.size.width, src.size.height)
    let from = NSRect(x: (src.size.width - side) / 2, y: (src.size.height - side) / 2, width: side, height: side)
    src.draw(in: rect, from: from, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}
let set = out + "/AppIcon.iconset"
try? FileManager.default.createDirectory(atPath: set, withIntermediateDirectories: true)
for b in [16, 32, 128, 256, 512] {
    try! render(b, rounded: true).write(to: URL(fileURLWithPath: "\(set)/icon_\(b)x\(b).png"))
    try! render(b * 2, rounded: true).write(to: URL(fileURLWithPath: "\(set)/icon_\(b)x\(b)@2x.png"))
}
if let web {
    for (name, size) in [("pwa-192.png", 192), ("pwa-512.png", 512), ("apple-touch-icon.png", 180), ("favicon.png", 64)] {
        try! render(size, rounded: false).write(to: URL(fileURLWithPath: "\(web)/\(name)"))
    }
}
