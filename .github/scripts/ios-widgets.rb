# Adds the home and lock screen widgets (app/src-tauri/ios/widgets) to the Xcode project that
# `tauri ios init` generated: an app extension target embedded in the app, sharing the App Group the
# app writes the widgets' snapshot to. Run by ios-project.sh with the project.yml path; it then runs
# xcodegen again.
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

targets["LacticWidgets"] = {
  "type" => "app-extension",
  "platform" => "iOS",
  # containerBackground and the other widget APIs used; the app itself still runs on iOS 16.
  "deploymentTarget" => "17.0",
  "sources" => [{ "path" => "LacticWidgets" }],
  "info" => {
    "path" => "LacticWidgets/Info.plist",
    "properties" => {
      "CFBundleDisplayName" => "Lactic",
      # Matched to the app's at build time (the script below); App Store Connect wants them equal.
      "CFBundleShortVersionString" => app.dig("info", "properties", "CFBundleShortVersionString").to_s,
      "CFBundleVersion" => app.dig("info", "properties", "CFBundleVersion").to_s,
      "NSExtension" => { "NSExtensionPointIdentifier" => "com.apple.widgetkit-extension" },
    },
  },
  "entitlements" => {
    "path" => "LacticWidgets/LacticWidgets.entitlements",
    "properties" => { "com.apple.security.application-groups" => ["group.fit.lactic.app"] },
  },
  "settings" => {
    "base" => {
      "PRODUCT_NAME" => "LacticWidgets",
      "PRODUCT_BUNDLE_IDENTIFIER" => "#{bundle_id}.widget",
      "DEVELOPMENT_TEAM" => team,
      "CODE_SIGN_STYLE" => "Automatic",
      "SWIFT_VERSION" => "5.0",
      "TARGETED_DEVICE_FAMILY" => "1,2",
      "SKIP_INSTALL" => "YES",
      "ENABLE_USER_SCRIPT_SANDBOXING" => "NO",
      "LD_RUNPATH_SEARCH_PATHS" => "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks",
    },
  },
  "dependencies" => [{ "sdk" => "WidgetKit.framework" }, { "sdk" => "SwiftUI.framework" }],
  "postBuildScripts" => [{
    "name" => "Match the app's version",
    "basedOnDependencyAnalysis" => false,
    # tauri ios build writes the build's version into the app's Info.plist just before building.
    "script" => <<~SH,
      app="$SRCROOT/#{app_plist}"
      out="$TARGET_BUILD_DIR/$INFOPLIST_PATH"
      for key in CFBundleShortVersionString CFBundleVersion; do
        value=$(/usr/libexec/PlistBuddy -c "Print :$key" "$app" 2>/dev/null) || continue
        case "$value" in *'$('*) continue ;; esac
        /usr/libexec/PlistBuddy -c "Set :$key $value" "$out"
      done
    SH
  }],
}

(app["dependencies"] ||= []) << { "target" => "LacticWidgets", "embed" => true, "codeSign" => true }

File.write(spec_path, spec.to_yaml)
puts "Widgets added to #{app_name} in #{spec_path}"
