# Adds Lactic's widgets and Watch app to the Xcode project that `tauri ios init` generated:
# - LacticWidgets: the iPhone's home and lock screen widgets (app/src-tauri/ios/widgets), embedded
#   in the app.
# - LacticWatch: the Apple Watch app (app/src-tauri/ios/watch/App.swift), embedded in the app, with
# - LacticWatchWidgets: its Smart Stack widget and complications (app/src-tauri/ios/watch/Widgets.swift).
# All share the App Group the snapshot goes through: group.<the app's bundle id>, so
# group.fit.lactic.app for Lactic and group.fit.lactic.modular for the Lactic Modular testing app. ios-project.sh copies the sources into the
# generated project, runs this with the project.yml path, then runs xcodegen again.
require "yaml"

spec_path = ARGV.fetch(0)
spec = YAML.load_file(spec_path)
targets = spec.fetch("targets")
app_name, app = targets.find { |_, t| t["type"] == "application" }
abort "::error::No application target in #{spec_path}" unless app

team = app.dig("settings", "base", "DEVELOPMENT_TEAM") ||
  spec.dig("settingGroups", "app", "base", "DEVELOPMENT_TEAM") || "PXC4RTM468"
bundle_id = spec.dig("settingGroups", "app", "base", "PRODUCT_BUNDLE_IDENTIFIER") || "fit.lactic.app"
app_plist = app.dig("info", "path")
GROUP = "group.#{bundle_id}"
NAME = bundle_id == "fit.lactic.modular" ? "Lactic Modular" : "Lactic"

# tauri ios build sets the build's version on every Info.plist (agvtool) and in the app's; this
# copies the app's in case a plist was missed. App Store Connect wants them all equal.
version_script = {
  "name" => "Match the app's version",
  "basedOnDependencyAnalysis" => false,
  "script" => <<~SH,
    app="$SRCROOT/#{app_plist}"
    out="$TARGET_BUILD_DIR/$INFOPLIST_PATH"
    for key in CFBundleShortVersionString CFBundleVersion; do
      value=$(/usr/libexec/PlistBuddy -c "Print :$key" "$app" 2>/dev/null) || continue
      case "$value" in *'$('*) continue ;; esac
      /usr/libexec/PlistBuddy -c "Set :$key $value" "$out"
    done
  SH
}

target = lambda do |name, type:, platform:, os:, id:, info: {}, settings: {}, dependencies: []|
  {
    "type" => type,
    "platform" => platform,
    "deploymentTarget" => os,
    "sources" => [{ "path" => name }],
    "info" => {
      "path" => "#{name}/Info.plist",
      "properties" => {
        "CFBundleDisplayName" => NAME,
        "CFBundleShortVersionString" => app.dig("info", "properties", "CFBundleShortVersionString").to_s,
        "CFBundleVersion" => app.dig("info", "properties", "CFBundleVersion").to_s,
      }.merge(Marshal.load(Marshal.dump(info))),
    },
    "entitlements" => {
      "path" => "#{name}/#{name}.entitlements",
      "properties" => { "com.apple.security.application-groups" => [GROUP] },
    },
    "settings" => {
      "base" => {
        "PRODUCT_NAME" => name,
        "PRODUCT_BUNDLE_IDENTIFIER" => id,
        "DEVELOPMENT_TEAM" => team,
        "CODE_SIGN_STYLE" => "Automatic",
        "SWIFT_VERSION" => "5.0",
        "SKIP_INSTALL" => "YES",
        "ENABLE_USER_SCRIPT_SANDBOXING" => "NO",
      }.merge(settings),
    },
    "dependencies" => dependencies,
    "postBuildScripts" => [Marshal.load(Marshal.dump(version_script))],
  }
end

widget = { "NSExtension" => { "NSExtensionPointIdentifier" => "com.apple.widgetkit-extension" } }

# (Copies of shared hashes, so the YAML has no anchors.)
# containerBackground and the other widget APIs used; the app itself still runs on iOS 16.
targets["LacticWidgets"] = target.call("LacticWidgets",
  type: "app-extension", platform: "iOS", os: "17.0", id: "#{bundle_id}.widget", info: widget,
  settings: {
    "TARGETED_DEVICE_FAMILY" => "1,2",
    "LD_RUNPATH_SEARCH_PATHS" => "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks",
  },
  dependencies: [{ "sdk" => "WidgetKit.framework" }, { "sdk" => "SwiftUI.framework" }, { "sdk" => "AppIntents.framework" }])

targets["LacticWatchWidgets"] = target.call("LacticWatchWidgets",
  type: "app-extension", platform: "watchOS", os: "10.0", id: "#{bundle_id}.watchkitapp.widget", info: widget,
  settings: {
    "TARGETED_DEVICE_FAMILY" => "4",
    "LD_RUNPATH_SEARCH_PATHS" => "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks",
  },
  dependencies: [{ "sdk" => "WidgetKit.framework" }, { "sdk" => "SwiftUI.framework" }])

targets["LacticWatch"] = target.call("LacticWatch",
  type: "application", platform: "watchOS", os: "10.0", id: "#{bundle_id}.watchkitapp",
  info: { "WKApplication" => true, "WKCompanionAppBundleIdentifier" => bundle_id },
  settings: {
    "TARGETED_DEVICE_FAMILY" => "4",
    "ASSETCATALOG_COMPILER_APPICON_NAME" => "AppIcon",
    "LD_RUNPATH_SEARCH_PATHS" => "$(inherited) @executable_path/Frameworks",
  },
  dependencies: [
    { "target" => "LacticWatchWidgets", "embed" => true, "codeSign" => true },
    { "sdk" => "WatchConnectivity.framework" },
    { "sdk" => "WidgetKit.framework" },
  ])

(app["dependencies"] ||= []) << { "target" => "LacticWidgets", "embed" => true, "codeSign" => true }
app["dependencies"] << { "target" => "LacticWatch", "embed" => true, "codeSign" => true }

File.write(spec_path, spec.to_yaml)
puts "Widgets and Watch app added to #{app_name} in #{spec_path}"
