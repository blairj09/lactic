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
exec /usr/bin/xcodebuild "${args[@]}"
