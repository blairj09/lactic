// Checks the iPhone's wire format against the computer's (CI, on a Mac):
//   swiftc Sources/Wire.swift WireCheck/main.swift -o wire-check
//   ./wire-check request DIR    writes DIR/request.bin, a sealed hello as the iPhone sends it
//   (phone.rs's swift_wire test opens it, then writes DIR/reply.bin as the computer answers)
//   ./wire-check reply DIR      opens DIR/reply.bin as the iPhone does
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
    let sealed = try Wire.request(kind: "hello", body: .object(["name": .string("Test iPhone")]), key: key)
    try sealed.write(to: dir.appendingPathComponent("request.bin"))
    print("wrote request.bin")
  case "reply":
    let reply = try Wire.reply(try Data(contentsOf: dir.appendingPathComponent("reply.bin")), key: key)
    guard case .bool(true) = reply["ok"] ?? .null,
      case .object(let body) = reply["body"] ?? .null,
      case .string(let computer) = body["computer"] ?? .null
    else {
      print("reply didn't read as the iPhone expects: \(reply)")
      exit(1)
    }
    print("read reply from \(computer)")
  default:
    print("usage: wire-check request|reply DIR")
    exit(2)
  }
} catch {
  print("wire-check failed: \(error)")
  exit(1)
}
