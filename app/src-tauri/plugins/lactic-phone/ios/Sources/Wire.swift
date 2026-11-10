// What goes over the wire between the iPhone and the computer: a sealed envelope out, a sealed
// reply back. Foundation and CryptoKit only, so CI compiles this file on its own and checks it
// against the computer's Rust side (WireCheck/main.swift and phone.rs's swift_wire test).

import CryptoKit
import Foundation

/// Any JSON, decoded from the web layer and passed through untouched.
enum JSONValue: Codable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() { self = .null }
    else if let b = try? c.decode(Bool.self) { self = .bool(b) }
    else if let n = try? c.decode(Double.self) { self = .number(n) }
    else if let s = try? c.decode(String.self) { self = .string(s) }
    else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
    else { self = .object(try c.decode([String: JSONValue].self)) }
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .bool(let b): try c.encode(b)
    case .number(let n): try c.encode(n)
    case .string(let s): try c.encode(s)
    case .array(let a): try c.encode(a)
    case .object(let o): try c.encode(o)
    }
  }
}

struct LacticError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

enum Wire {
  /// `{t, kind, body}` sealed with AES-256-GCM. `t` is whole milliseconds since 1970.
  static func request(kind: String, body: JSONValue, key: SymmetricKey, now: Date = Date()) throws -> Data {
    let envelope: [String: JSONValue] = ["t": .number((now.timeIntervalSince1970 * 1000).rounded()), "kind": .string(kind), "body": body]
    let plain = try JSONEncoder().encode(envelope)
    guard let sealed = try AES.GCM.seal(plain, using: key).combined else { throw LacticError("Couldn't seal the request") }
    return sealed
  }

  /// The computer's sealed answer: `{ok: true, body}` or `{ok: false, error}`.
  static func reply(_ data: Data, key: SymmetricKey) throws -> [String: JSONValue] {
    let opened = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key)
    return try JSONDecoder().decode([String: JSONValue].self, from: opened)
  }

  // Pairing: the QR code's key is used once. The hello carries a fresh public key, the computer
  // answers with its own, and both keep the key worked out here (X25519, then HKDF-SHA256 salted
  // with the code's key), so a photo of the code opens nothing sent afterwards. phone.rs's
  // pairing_key is the computer's half.

  /// The key to keep, from this side's private key and the public key in the computer's answer.
  static func pairingKey(mine: Curve25519.KeyAgreement.PrivateKey, theirs: Data, code: Data, deviceId: String) throws -> Data {
    let shared = try mine.sharedSecretFromKeyAgreement(with: Curve25519.KeyAgreement.PublicKey(rawRepresentation: theirs))
    return pairingKey(shared: shared.withUnsafeBytes { Data($0) }, code: code, deviceId: deviceId)
  }

  static func pairingKey(shared: Data, code: Data, deviceId: String) -> Data {
    // HKDF-SHA256 for one block of output: extract with the code's key as salt, then expand.
    let extracted = HMAC<SHA256>.authenticationCode(for: shared, using: SymmetricKey(data: code))
    let info = Data("lactic pairing v2 \(deviceId)".utf8) + [1]
    return Data(HMAC<SHA256>.authenticationCode(for: info, using: SymmetricKey(data: Data(extracted))))
  }

  static func b64url(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }

  static func fromB64url(_ text: String) -> Data? {
    var s = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while s.count % 4 != 0 { s += "=" }
    return Data(base64Encoded: s)
  }
}
