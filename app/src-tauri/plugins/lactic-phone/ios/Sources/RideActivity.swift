// Starts, updates and ends the ride's Live Activity (lock screen and Dynamic Island). The app hands
// over what to show (web/lib/ride/live-activity.ts) for its own ride or the computer's; the widget
// extension lays it out (app/src-tauri/ios/widgets/RideActivity.swift). iOS only lets an app start
// one while it's open on screen, so a start that fails in the background is simply tried again on
// the next update. One at a time: any others are ended.

import Foundation
import Tauri

#if canImport(ActivityKit) && os(iOS)
import ActivityKit
#endif

struct RideActivityArgs: Decodable {
  let json: String
}

struct EndRideActivityArgs: Decodable {
  /// Leave the last view up for a couple of minutes (the workout was done), or take it away now.
  let linger: Bool?
}

enum RideActivity {
  /// Without an update for this long, the activity counts as stale: the computer's ride went quiet
  /// (phone locked), so live numbers step aside and only the countdowns show.
  static let staleAfter: TimeInterval = 25

  static func show(_ json: String) async throws {
    #if canImport(ActivityKit) && os(iOS)
    guard #available(iOS 16.2, *) else { return }
    let state = try JSONDecoder().decode(LacticRideAttributes.ContentState.self, from: Data(json.utf8))
    let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(staleAfter))
    let running = Activity<LacticRideAttributes>.activities
    if let first = running.first {
      await first.update(content)
      for extra in running.dropFirst() { await extra.end(nil, dismissalPolicy: .immediate) }
      return
    }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    _ = try Activity.request(attributes: LacticRideAttributes(), content: content, pushType: nil)
    #endif
  }

  static func end(linger: Bool) async {
    #if canImport(ActivityKit) && os(iOS)
    guard #available(iOS 16.2, *) else { return }
    for activity in Activity<LacticRideAttributes>.activities {
      await activity.end(nil, dismissalPolicy: linger ? .after(Date().addingTimeInterval(120)) : .immediate)
    }
    #endif
  }
}

extension LacticPhonePlugin {
  @objc public func rideActivity(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(RideActivityArgs.self)
    Task {
      do {
        try await RideActivity.show(args.json)
        invoke.resolve()
      } catch {
        invoke.reject(error.localizedDescription)
      }
    }
  }

  @objc public func endRideActivity(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(EndRideActivityArgs.self)
    Task {
      await RideActivity.end(linger: args.linger ?? false)
      invoke.resolve()
    }
  }
}
