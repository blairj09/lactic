// The iCloud fallback, for when the iPhone can't reach the computer directly (away from home, or
// the Mac asleep). A sync request goes, sealed, into Lactic's iCloud container at
// Documents/Link/<device>/to-computer/<name>.bin; Lactic on the Mac answers into
// to-phone/<name>.bin (phone.rs `mailbox`). iCloud only carries bytes only the two devices can open.

import Foundation

enum Mailbox {
  static var container: String { Identity.container }

  /// This pairing's folder in iCloud, or nil when iCloud is off (or not signed in). Blocks: never
  /// call it on the main thread.
  static func folder(device: String) -> URL? {
    guard let root = FileManager.default.url(forUbiquityContainerIdentifier: container) else { return nil }
    return root.appendingPathComponent("Documents/Link", isDirectory: true).appendingPathComponent(device, isDirectory: true)
  }

  /// Leaves `sealed` for the computer and waits up to `wait` seconds for its answer. Nil when it
  /// didn't come in time: the request stays for the computer, and the next sync asks again.
  static func exchange(device: String, sealed: Data, wait: Double) async throws -> Data? {
    guard let dir = folder(device: device) else { return nil }
    let fm = FileManager.default
    let inbox = dir.appendingPathComponent("to-computer", isDirectory: true)
    let outbox = dir.appendingPathComponent("to-phone", isDirectory: true)
    try fm.createDirectory(at: inbox, withIntermediateDirectories: true)
    try fm.createDirectory(at: outbox, withIntermediateDirectories: true)

    // A new request carries everything an older unanswered one did: replace it, and drop answers
    // nobody waited for.
    for old in (try? fm.contentsOfDirectory(at: inbox, includingPropertiesForKeys: nil)) ?? [] {
      try? fm.removeItem(at: old)
    }
    for old in (try? fm.contentsOfDirectory(at: outbox, includingPropertiesForKeys: nil)) ?? [] {
      try? fm.removeItem(at: old)
    }

    let name = "\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8)).bin"
    try sealed.write(to: inbox.appendingPathComponent(name), options: .atomic)

    let answer = outbox.appendingPathComponent(name)
    let until = Date().addingTimeInterval(wait)
    while Date() < until {
      try await Task.sleep(nanoseconds: 2_000_000_000)
      // Files from the Mac arrive as placeholders until asked for.
      try? fm.startDownloadingUbiquitousItem(at: answer)
      if let data = try? Data(contentsOf: answer), !data.isEmpty {
        try? fm.removeItem(at: answer)
        return data
      }
    }
    return nil
  }
}
