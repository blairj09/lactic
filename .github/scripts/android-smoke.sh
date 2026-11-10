#!/usr/bin/env bash
# The Android smoke test, inside the emulator runner: installs the debug APK, opens Lactic,
# grants Health Connect access (as the rider would on its permission screen), drives the app
# through its WebView (android-smoke.mjs) against a stand-in computer (android-computer.mjs,
# started by the workflow), and keeps screenshots and the log. Run from the repo root.
set -uo pipefail
OUT=${OUT:-android-smoke}
mkdir -p "$OUT"
pkg=fit.lactic.app
apk=$(find apk -name '*.apk' | head -1)
adb install -r -g "$apk"
for p in READ_SLEEP READ_HEART_RATE_VARIABILITY READ_RESTING_HEART_RATE READ_RESPIRATORY_RATE READ_HEART_RATE READ_ACTIVE_CALORIES_BURNED READ_STEPS READ_VO2_MAX READ_EXERCISE READ_HEALTH_DATA_IN_BACKGROUND WRITE_EXERCISE WRITE_HEART_RATE WRITE_POWER WRITE_ACTIVE_CALORIES_BURNED WRITE_DISTANCE; do
  adb shell pm grant $pkg android.permission.health.$p 2>&1 | head -1 || true
done
adb logcat -c
adb shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 25
adb exec-out screencap -p > "$OUT/launch.png"
pid=$(adb shell pidof $pkg | tr -d '\r')
echo "Lactic pid: $pid"
sock=$(adb shell cat /proc/net/unix | tr -d '\r' | grep -o "webview_devtools_remote_$pid" | head -1)
if [ -z "$sock" ]; then sock=$(adb shell cat /proc/net/unix | tr -d '\r' | grep -o 'webview_devtools_remote_[0-9]*' | head -1); fi
status=1
if [ -n "$sock" ]; then
  adb forward tcp:9222 "localabstract:$sock"
  OUT=$OUT node .github/scripts/android-smoke.mjs
  status=$?
else
  echo "::error::No WebView DevTools socket (is the app running?)"
fi
adb exec-out screencap -p > "$OUT/after.png"
adb logcat -d > "$OUT/logcat.txt"
if grep -q "FATAL EXCEPTION" "$OUT/logcat.txt"; then
  echo "::error::Lactic crashed"
  grep -A 30 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -60
  status=1
fi
exit $status
