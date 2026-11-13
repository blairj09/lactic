# Whether App Store Connect has an app for BUNDLE_ID yet, so the TestFlight job can skip (with a
# note) instead of failing until it's created. Writes ready=true|false to GITHUB_OUTPUT. Lactic
# Modular (fit.lactic.modular) needs, once, in the Apple Developer account: the App ID with
# HealthKit, iCloud (CloudKit/Documents) and App Groups, the App Group group.fit.lactic.modular, the
# iCloud container iCloud.fit.lactic.modular, and then the app in App Store Connect.
require_relative "asc-auth"

id = ENV.fetch("BUNDLE_ID")
apps = get("/v1/apps?filter[bundleId]=#{id}&fields[apps]=name,bundleId", TOKEN)["data"]
ready = apps.any? { |a| a.dig("attributes", "bundleId") == id }
if ready
  puts "::notice::App Store Connect app for #{id}: #{apps.first.dig("attributes", "name")}"
else
  puts "::notice title=Not uploaded::No App Store Connect app for #{id} yet, so this build isn't made or uploaded. " \
    "Create the App ID, App Group group.#{id} and iCloud container iCloud.#{id} at developer.apple.com, then the app in App Store Connect."
end
File.write(ENV["GITHUB_OUTPUT"], "ready=#{ready}\n", mode: "a") if ENV["GITHUB_OUTPUT"]
