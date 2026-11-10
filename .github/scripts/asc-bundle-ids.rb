# Lists the team's Lactic App IDs and their capabilities from App Store Connect, so a signing
# failure in the TestFlight job shows what Apple has registered. Prints identifiers only.
# Needs APPLE_API_KEY, APPLE_API_ISSUER and APPLE_API_KEY_PATH.
require "base64"
require "json"
require "net/http"
require "openssl"

def b64(s) = Base64.urlsafe_encode64(s, padding: false)

key = OpenSSL::PKey::EC.new(File.read(ENV.fetch("APPLE_API_KEY_PATH")))
header = b64({ alg: "ES256", kid: ENV.fetch("APPLE_API_KEY"), typ: "JWT" }.to_json)
now = Time.now.to_i
claims = b64({ iss: ENV.fetch("APPLE_API_ISSUER"), iat: now, exp: now + 600, aud: "appstoreconnect-v1" }.to_json)
der = key.sign(OpenSSL::Digest.new("SHA256"), "#{header}.#{claims}")
r, s = OpenSSL::ASN1.decode(der).value.map { |i| i.value.to_s(2).rjust(32, "\0")[-32, 32] }
token = "#{header}.#{claims}.#{b64(r + s)}"

def get(path, token)
  uri = URI("https://api.appstoreconnect.apple.com#{path}")
  res = Net::HTTP.get_response(uri, { "Authorization" => "Bearer #{token}" })
  abort "App Store Connect #{path}: #{res.code} #{res.body[0, 300]}" unless res.is_a?(Net::HTTPSuccess)
  JSON.parse(res.body)
end

ids = get("/v1/bundleIds?limit=200&fields[bundleIds]=identifier,platform,seedId", token)["data"]
lactic = ids.select { |b| b.dig("attributes", "identifier").to_s.include?("lactic") }
puts "::notice::Lactic App IDs on this key's team (#{ids.size} App IDs in all):"
lactic.each do |b|
  caps = get("/v1/bundleIds/#{b["id"]}/bundleIdCapabilities", token)["data"].map { |c| c.dig("attributes", "capabilityType") }
  puts "::notice::#{b.dig("attributes", "identifier")} (#{b.dig("attributes", "platform")}, team #{b.dig("attributes", "seedId")}): #{caps.sort.join(", ")}"
end
puts "::warning::fit.lactic.app.widget is not registered on this team" unless lactic.any? { |b| b.dig("attributes", "identifier") == "fit.lactic.app.widget" }
