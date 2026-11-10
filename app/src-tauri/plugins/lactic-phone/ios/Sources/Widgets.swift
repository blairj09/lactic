// The home and lock screen widgets' data (the widgets themselves are an app extension built from
// app/src-tauri/ios/widgets). The app writes the snapshot it worded (web/lib/widget-snapshot.ts)
// into the App Group both share, then asks iOS to redraw them.

import Foundation
import Tauri
import WidgetKit

enum WidgetShare {
  static let group = "group.fit.lactic.app"
  static let file = "widget.json"

  static func save(_ json: String) throws {
    guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
      throw WidgetError.noGroup
    }
    try Data(json.utf8).write(to: dir.appendingPathComponent(file), options: .atomic)
    WidgetCenter.shared.reloadAllTimelines()
  }
}

enum WidgetError: LocalizedError {
  case noGroup
  var errorDescription: String? { "This build can't reach the widgets' shared space (App Group)" }
}

struct WidgetArgs: Decodable {
  var json: String
}

extension LacticPhonePlugin {
  @objc public func saveWidget(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(WidgetArgs.self)
    do {
      try WidgetShare.save(args.json)
      invoke.resolve()
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }
}
