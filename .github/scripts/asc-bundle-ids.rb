# Lists the team's Lactic App IDs and their capabilities from App Store Connect, so a signing
# failure in the TestFlight job shows what Apple has registered. Prints identifiers only.
# Needs APPLE_API_KEY, APPLE_API_ISSUER and APPLE_API_KEY_PATH.
require_relative "asc-auth"

ids = get("/v1/bundleIds?limit=200&fields[bundleIds]=identifier,platform,seedId", TOKEN)["data"]
lactic = ids.select { |b| b.dig("attributes", "identifier").to_s.include?("lactic") }
puts "::notice::Lactic App IDs on this key's team (#{ids.size} App IDs in all):"
lactic.each do |b|
  caps = get("/v1/bundleIds/#{b["id"]}/bundleIdCapabilities", TOKEN)["data"].map { |c| c.dig("attributes", "capabilityType") }
  puts "::notice::#{b.dig("attributes", "identifier")} (#{b.dig("attributes", "platform")}, team #{b.dig("attributes", "seedId")}): #{caps.sort.join(", ")}"
end
# The app and the ids its widgets and Watch app derive from it (ios-widgets.rb).
app = ENV.fetch("BUNDLE_ID", "fit.lactic.app")
[app, "#{app}.widget", "#{app}.watchkitapp", "#{app}.watchkitapp.widget"].each do |id|
  puts "::warning::#{id} is not registered on this team" unless lactic.any? { |b| b.dig("attributes", "identifier") == id }
end
