#!/usr/bin/env bash
# Generates the iPhone app's Xcode project (app/src-tauri/gen/apple) and gives it Lactic's
# entitlements, icon, widgets and Watch app. Run from app/.
#
# LACTIC_CHANNEL=modular makes the Lactic Modular testing app instead (fit.lactic.modular, purple
# icon): its own App Group (group.fit.lactic.modular), iCloud container (iCloud.fit.lactic.modular)
# and Bonjour service, so it never shares data or a computer with the real app. `tauri ios build`
# then needs the same --config (see ios.yml).
set -euo pipefail
command -v xcodegen >/dev/null || brew install xcodegen
config=()
icons=src-tauri/icons/ios
if [ "${LACTIC_CHANNEL:-}" = modular ]; then
  config=(--config src-tauri/tauri.modular.conf.json)
  icons=src-tauri/icons-modular/ios
fi
npx tauri ios init --ci ${config[@]+"${config[@]}"}
entitlements=$(find src-tauri/gen/apple -maxdepth 2 -name '*.entitlements' | head -1)
if [ -z "$entitlements" ]; then
  echo "::error::No .entitlements file in the generated project"
  find src-tauri/gen/apple -maxdepth 2
  exit 1
fi
# tauri ios init fills the app icon with Tauri's placeholder; put Lactic's in (same file names).
iconset=$(find src-tauri/gen/apple -type d -name 'AppIcon.appiconset' | head -1)
if [ -z "$iconset" ]; then
  echo "::error::No AppIcon.appiconset in the generated project"
  exit 1
fi
cp "$icons"/*.png "$iconset/"
echo "App icon: $iconset"
# The widgets and the Watch app: targets the template doesn't have. Each gets the shared code.
project=$(dirname "$entitlements")/..
spec=$(cd "$project" && pwd)/project.yml
test -f "$spec" || { echo "::error::No project.yml in the generated project"; exit 1; }
gen=$(dirname "$spec")
for t in LacticWidgets LacticWatch LacticWatchWidgets; do rm -rf "${gen:?}/$t" && mkdir -p "$gen/$t" && cp src-tauri/ios/widgets/Shared.swift "$gen/$t/"; done
cp src-tauri/ios/widgets/iPhone.swift "$gen/LacticWidgets/"
cp src-tauri/ios/watch/App.swift "$gen/LacticWatch/"
cp src-tauri/ios/watch/Widgets.swift "$gen/LacticWatchWidgets/"
# The Watch app's icon: Lactic's, one 1024 px image that watchOS sizes itself.
icon="$gen/LacticWatch/Assets.xcassets/AppIcon.appiconset"
mkdir -p "$icon"
cp "$icons/AppIcon-512@2x.png" "$icon/icon.png"
printf '{"images":[{"filename":"icon.png","idiom":"universal","platform":"watchos","size":"1024x1024"}],"info":{"author":"xcode","version":1}}\n' > "$icon/Contents.json"
printf '{"info":{"author":"xcode","version":1}}\n' > "$gen/LacticWatch/Assets.xcassets/Contents.json"
ruby "$(dirname "$0")/ios-widgets.rb" "$spec"
(cd "$(dirname "$spec")" && xcodegen generate --spec project.yml)
# After xcodegen, which rewrites the app's entitlements file from project.yml and would drop these.
cp src-tauri/ios/Lactic.entitlements "$entitlements"
if [ "${LACTIC_CHANNEL:-}" = modular ]; then
  sed -i '' 's/\.fit\.lactic\.app</.fit.lactic.modular</' "$entitlements"
fi
echo "Entitlements: $entitlements"
