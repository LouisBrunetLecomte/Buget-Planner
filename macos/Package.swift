// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "Buget",
    platforms: [.macOS("26.0")],
    targets: [
        .executableTarget(
            name: "Buget",
            path: "Sources/Buget",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
