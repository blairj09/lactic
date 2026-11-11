// The home and lock screen widgets' data (the widgets themselves are an app extension built from
// app/src-tauri/ios/widgets). The app writes the snapshot it worded (web/lib/widget-snapshot.ts)
// into the App Group both share, then asks iOS to redraw them, and sends it on to the Lactic app on
// a paired Apple Watch (app/src-tauri/ios/watch) for its Smart Stack widget and complications.

import Foundation
import Tauri
import WatchConnectivity
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
    WatchLink.shared.send(json)
  }
}

/// The snapshot to the Watch: as the app context (the Watch app reads the latest when it opens) and,
/// while a Lactic complication is on the watch face, as a complication transfer, which wakes the Watch
/// app to redraw it (iOS allows a limited number a day).
final class WatchLink: NSObject, WCSessionDelegate {
  static let shared = WatchLink()
  private var waiting: String?
  private var lastTransferred: String?

  func start() {
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  func send(_ json: String) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated else {
      waiting = json
      return
    }
    guard session.isPaired, session.isWatchAppInstalled else { return }
    try? session.updateApplicationContext(["widget": json])
    if session.isComplicationEnabled, session.remainingComplicationUserInfoTransfers > 0, json != lastTransferred {
      session.transferCurrentComplicationUserInfo(["widget": json])
      lastTransferred = json
    }
  }

  func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
    guard state == .activated, let json = waiting else { return }
    waiting = nil
    send(json)
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    // Switched to another Watch: listen to the new one.
    session.activate()
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
