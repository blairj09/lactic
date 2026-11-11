// Checks the iPhone's wire format against the computer's (CI, on a Mac):
//   swiftc Sources/Wire.swift WireCheck/main.swift -o wire-check
//   ./wire-check request DIR    writes DIR/request.bin, a sealed hello as the iPhone sends it when
//                               pairing, public key included (its private half goes in DIR/private.bin)
//   (phone.rs's swift_wire test opens it, then writes DIR/reply.bin as the computer answers and
//   DIR/paired.bin sealed with the key the pairing agreed on)
//   ./wire-check reply DIR      opens DIR/reply.bin as the iPhone does, works out the agreed key
//                               and opens DIR/paired.bin with it
//   ./wire-check direct DIR     finds the test listener by Bonjour and sends a hello over the direct
//                               link (Direct.swift), as phone.rs's swift_direct test sets up
// The key is the test's fixed one: 32 bytes of 7.

import CryptoKit
import Foundation

let key = SymmetricKey(data: Data(repeating: 7, count: 32))
let args = CommandLine.arguments
guard args.count == 3 else {
  print("usage: wire-check request|reply DIR")
  exit(2)
}
let dir = URL(fileURLWithPath: args[2])

do {
  switch args[1] {
  case "request":
    let mine = Curve25519.KeyAgreement.PrivateKey()
    try mine.rawRepresentation.write(to: dir.appendingPathComponent("private.bin"))
    let hello: JSONValue = .object(["name": .string("Test iPhone"), "pub": .string(Wire.b64url(mine.publicKey.rawRepresentation))])
    let sealed = try Wire.request(kind: "hello", body: hello, key: key)
    try sealed.write(to: dir.appendingPathComponent("request.bin"))
    print("wrote request.bin")
  case "reply":
    let reply = try Wire.reply(try Data(contentsOf: dir.appendingPathComponent("reply.bin")), key: key)
    guard case .bool(true) = reply["ok"] ?? .null,
      case .object(let body) = reply["body"] ?? .null,
      case .string(let computer) = body["computer"] ?? .null,
      case .string(let theirs) = body["pub"] ?? .null,
      let theirKey = Wire.fromB64url(theirs)
    else {
      print("reply didn't read as the iPhone expects: \(reply)")
      exit(1)
    }
    print("read reply from \(computer)")
    // The same fixed case phone.rs checks, so the two sides can't drift apart together.
    let fixed = Wire.pairingKey(shared: Data(repeating: 1, count: 32), code: Data(repeating: 2, count: 32), deviceId: "test")
    guard Wire.b64url(fixed) == "J8pHG4sZGDAV5zM_3G8-zR4VMraP8_CnZwlozAkmT8o" else {
      print("the pairing key for the fixed case came out as \(Wire.b64url(fixed))")
      exit(1)
    }
    let mine = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: try Data(contentsOf: dir.appendingPathComponent("private.bin")))
    let kept = try Wire.pairingKey(mine: mine, theirs: theirKey, code: Data(repeating: 7, count: 32), deviceId: "test")
    let paired = try Wire.reply(try Data(contentsOf: dir.appendingPathComponent("paired.bin")), key: SymmetricKey(data: kept))
    guard case .bool(true) = paired["ok"] ?? .null else {
      print("the message sealed with the agreed key didn't read: \(paired)")
      exit(1)
    }
    print("pairing agreed on the same key")
  case "direct":
    let done = DispatchSemaphore(value: 0)
    var failure: String?
    Task {
      do {
        let found = await Direct.candidates(within: 10)
        guard let endpoint = found.first else { throw LacticError("Bonjour found no \(Direct.service) service") }
        let sealed = try Wire.request(kind: "hello", body: .object(["name": .string("Test iPhone")]), key: key)
        let (status, data) = try await Direct.post(
          to: endpoint, path: "/lactic/phone", body: sealed,
          headers: ["Content-Type": "application/octet-stream", "X-Lactic-Device": "test"], timeout: 10)
        guard status == 200 else { throw LacticError("answered \(status)") }
        let reply = try Wire.reply(data, key: key)
        guard case .bool(true) = reply["ok"] ?? .null else { throw LacticError("reply: \(reply)") }
        print("direct link to \(endpoint) works")
      } catch {
        failure = "\(error)"
      }
      done.signal()
    }
    done.wait()
    if let failure {
      print("direct link failed: \(failure)")
      exit(1)
    }
  default:
    print("usage: wire-check request|reply|direct DIR")
    exit(2)
  }
} catch {
  print("wire-check failed: \(error)")
  exit(1)
}
