#!/bin/bash
# Fabrique puis installe Buget.app dans /Applications (remplace la version précédente ; tes données, elles, restent).
set -euo pipefail
APP="$("$(dirname "$0")/bundle.sh")"
pkill -x Buget 2>/dev/null && sleep 1 || true
rm -rf "/Applications/Buget.app"
ditto "$APP" "/Applications/Buget.app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Applications/Buget.app" >/dev/null 2>&1 || true
echo "Installé : /Applications/Buget.app"
