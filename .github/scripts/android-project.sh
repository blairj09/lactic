#!/usr/bin/env bash
# Generates the Android app's Gradle project (app/src-tauri/gen/android) and gives it what Lactic
# needs. Run from app/, with the Android SDK and NDK installed (ANDROID_HOME, NDK_HOME).
set -euo pipefail
npx tauri android init --ci

gen=src-tauri/gen/android
gradle=$gen/app/build.gradle.kts
manifest=$gen/app/src/main/AndroidManifest.xml
for f in "$gradle" "$manifest"; do
  if [ ! -f "$f" ]; then
    echo "::error::$f wasn't generated"
    find "$gen" -maxdepth 3
    exit 1
  fi
done

# The paired computer answers plain HTTP on the local network (what's inside is sealed with the
# pairing key, Link.kt), which Android blocks by default outside debug builds.
sed -i 's/manifestPlaceholders\["usesCleartextTraffic"\] = "false"/manifestPlaceholders["usesCleartextTraffic"] = "true"/' "$gradle"

# Keep the database, pairing and keys out of Android's cloud backups: the computer has the main copy.
if ! grep -q 'android:allowBackup' "$manifest"; then
  sed -i '0,/<application/s//<application android:allowBackup="false"/' "$manifest"
else
  sed -i 's/android:allowBackup="true"/android:allowBackup="false"/' "$manifest"
fi

# tauri android init fills the launcher icon with Tauri's placeholder; put Lactic's in.
out=$(mktemp -d)
npx tauri icon src-tauri/icons/icon.png -o "$out" >/dev/null
if [ -d "$out/android" ]; then
  cp -R "$out/android/." "$gen/app/src/main/res/"
  echo "App icon: from $out/android"
else
  echo "::warning::tauri icon made no android folder; keeping the placeholder icon"
  ls "$out"
fi

echo "--- $manifest"
cat "$manifest"
echo "--- $gradle"
cat "$gradle"
