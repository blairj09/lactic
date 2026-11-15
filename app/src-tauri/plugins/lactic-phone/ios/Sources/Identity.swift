// Which Lactic this is, from its bundle id: Lactic (fit.lactic.app) or the Lactic Modular testing
// app (fit.lactic.modular), whose App Group, iCloud container and Bonjour service are its own, so
// it never shares data or a computer with the real app. The widgets keep a copy (widgets/Shared.swift).

import Foundation

enum Identity {
  /// "fit.lactic.app" or "fit.lactic.modular": the app's bundle id, without an extension's suffix
  /// (.widget, .watchkitapp). Anything else (a command-line check) counts as Lactic.
  static let base: String = {
    let parts = (Bundle.main.bundleIdentifier ?? "").split(separator: ".")
    guard parts.count >= 3, parts[0] == "fit", parts[1] == "lactic" else { return "fit.lactic.app" }
    return parts[0...2].joined(separator: ".")
  }()

  static var isModular: Bool { base == "fit.lactic.modular" }

  /// Shared with the widgets and the Watch app.
  static var group: String { "group." + base }
  /// The iCloud sync fallback (Mailbox.swift).
  static var container: String { "iCloud." + base }
  /// What Lactic on the computer advertises (phone.rs `direct`).
  static var service: String { isModular ? "_lactic-modular._tcp" : "_lactic._tcp" }
}
