#!/bin/bash
# Fabrique Budget.app : compile l'app web (dist/) puis l'enveloppe native Swift, et les assemble.
set -euo pipefail
MAC="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$MAC/.." && pwd)"
APP="$MAC/build/Budget.app"

# Logs sur stderr : stdout ne contient que le chemin du paquet (utilisable en $(...)).
cd "$ROOT"
[ -d node_modules ] || npm ci >&2
npm run build >&2
swift build -c release --package-path "$MAC" >&2
BIN="$(swift build -c release --package-path "$MAC" --show-bin-path)/Buget"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Buget"
cp -R "$ROOT/dist" "$APP/Contents/Resources/web"

TMP="$(mktemp -d)"
swift "$MAC/Scripts/make-icon.swift" "$MAC/Resources/icon-source.png" "$TMP" >&2
iconutil -c icns "$TMP/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$TMP"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>Buget</string>
    <key>CFBundleIdentifier</key><string>local.louloubl.Buget</string>
    <key>CFBundleName</key><string>Budget</string>
    <key>CFBundleDisplayName</key><string>Budget</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>CFBundleDevelopmentRegion</key><string>fr</string>
    <key>LSMinimumSystemVersion</key><string>26.0</string>
    <key>LSApplicationCategoryType</key><string>public.app-category.finance</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSPrincipalClass</key><string>NSApplication</string>
    <key>NSHumanReadableCopyright</key><string>Budget personnel local et chiffré</string>
    <!-- uniquement le serveur interne (127.0.0.1) et Ollama en local : pas d'exception HTTP générale -->
    <key>NSAppTransportSecurity</key>
    <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

# Signature ad hoc (suffisante en local) ; touch + lsregister pour rafraîchir l'icône dans le Finder et le Dock.
codesign --force --deep --sign - --timestamp=none "$APP" >/dev/null 2>&1 || true
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true
echo "$APP"
