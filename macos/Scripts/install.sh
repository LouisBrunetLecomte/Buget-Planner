#!/bin/bash
# Fabrique puis installe Budget.app dans /Applications (remplace la version précédente ; tes données, elles, restent).
set -euo pipefail
APP="$("$(dirname "$0")/bundle.sh")"
pkill -x Buget 2>/dev/null && sleep 1 || true # nom interne de l'exécutable
rm -rf "/Applications/Buget.app" "/Applications/Budget.app" # Buget.app : ancien nom de l'app
ditto "$APP" "/Applications/Budget.app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Applications/Budget.app" >/dev/null 2>&1 || true
echo "Installé : /Applications/Budget.app"
