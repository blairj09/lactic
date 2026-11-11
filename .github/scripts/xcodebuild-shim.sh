#!/usr/bin/env bash
# Put first on PATH as `xcodebuild` while `tauri ios build` runs. Tauri builds and archives with
# `-sdk iphoneos`, which forces every target onto the iOS SDK, so the embedded Apple Watch app and
# its widgets (watchOS) fail to compile. This swaps it for `-destination generic/platform=iOS`, which
# builds the app for iOS and its watchOS targets with their own SDK. Everything else passes through.
set -euo pipefail
args=()
swapped=0
while [ $# -gt 0 ]; do
  if [ "$1" = "-sdk" ] && [ "${2:-}" = "iphoneos" ]; then
    args+=(-destination "generic/platform=iOS")
    swapped=1
    shift 2
    continue
  fi
  args+=("$1")
  shift
done
[ "$swapped" = 1 ] && echo "xcodebuild shim: -sdk iphoneos -> -destination generic/platform=iOS" >&2

# Tauri archives without code signing and then signs only the app's executable, with no
# entitlements. The export copies each bundle's entitlements from its signature in the archive, so
# the IPA lost all of them (Health, iCloud, the App Group the widgets share). Before the export, sign
# every bundle in the archive with its target's entitlements file, innermost first; the export then
# re-signs them for distribution and keeps those entitlements.
archive=""
exporting=0
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[$i]}" in
    -exportArchive) exporting=1 ;;
    -archivePath) archive="${args[$((i + 1))]}" ;;
  esac
done
if [ "$exporting" = 1 ] && [ -n "$archive" ]; then
  gen=$(cd "$(dirname "$archive")/.." && pwd)
  app=$(find "$archive/Products/Applications" -maxdepth 1 -name '*.app' | head -1)
  main=$(find "$gen" -maxdepth 2 -name '*.entitlements' -path '*_iOS/*' | head -1)
  identity=$(security find-identity -v -p codesigning | awk '/Apple Distribution/ { print $2; exit }')
  identity=${identity:--}
  sign() {
    if [ -d "$1" ] && [ -f "$2" ]; then
      echo "xcodebuild shim: signing ${1#"$archive/"} with $(basename "$2")" >&2
      /usr/bin/codesign --force --sign "$identity" --entitlements "$2" --generate-entitlement-der "$1" >&2 ||
        /usr/bin/codesign --force --sign - --entitlements "$2" --generate-entitlement-der "$1" >&2
    fi
  }
  sign "$app/Watch/LacticWatch.app/PlugIns/LacticWatchWidgets.appex" "$gen/LacticWatchWidgets/LacticWatchWidgets.entitlements"
  sign "$app/Watch/LacticWatch.app" "$gen/LacticWatch/LacticWatch.entitlements"
  sign "$app/PlugIns/LacticWidgets.appex" "$gen/LacticWidgets/LacticWidgets.entitlements"
  sign "$app" "$main"
fi
exec /usr/bin/xcodebuild "${args[@]}"
