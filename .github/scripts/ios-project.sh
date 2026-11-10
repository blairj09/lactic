#!/usr/bin/env bash
# Generates the iPhone app's Xcode project (app/src-tauri/gen/apple) and gives it Lactic's
# entitlements. Run from app/.
set -euo pipefail
command -v xcodegen >/dev/null || brew install xcodegen
npx tauri ios init --ci
entitlements=$(find src-tauri/gen/apple -maxdepth 2 -name '*.entitlements' | head -1)
if [ -z "$entitlements" ]; then
  echo "::error::No .entitlements file in the generated project"
  find src-tauri/gen/apple -maxdepth 2
  exit 1
fi
cp src-tauri/ios/Lactic.entitlements "$entitlements"
echo "Entitlements: $entitlements"
# tauri ios init fills the app icon with Tauri's placeholder; put Lactic's in (same file names).
iconset=$(find src-tauri/gen/apple -type d -name 'AppIcon.appiconset' | head -1)
if [ -z "$iconset" ]; then
  echo "::error::No AppIcon.appiconset in the generated project"
  exit 1
fi
cp src-tauri/icons/ios/*.png "$iconset/"
echo "App icon: $iconset"
