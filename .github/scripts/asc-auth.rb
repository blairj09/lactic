# App Store Connect API access for the iPhone workflow's scripts: a short-lived token from
# APPLE_API_KEY, APPLE_API_ISSUER and APPLE_API_KEY_PATH, and get(path, TOKEN).
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
TOKEN = "#{header}.#{claims}.#{b64(r + s)}"

def get(path, token)
  uri = URI("https://api.appstoreconnect.apple.com#{path}")
  res = Net::HTTP.get_response(uri, { "Authorization" => "Bearer #{token}" })
  abort "App Store Connect #{path}: #{res.code} #{res.body[0, 300]}" unless res.is_a?(Net::HTTPSuccess)
  JSON.parse(res.body)
end

