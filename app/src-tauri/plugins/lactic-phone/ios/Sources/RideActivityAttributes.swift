// The ride's Live Activity: what the app hands iOS and the widget extension lays out
// (app/src-tauri/ios/widgets/RideActivity.swift). ios-project.sh copies this file into the widget
// extension as well, so both sides have the same type; iOS matches them by name. The app words
// everything (web/lib/ride/live-activity.ts, whose LiveActivityState this matches field for field).

#if canImport(ActivityKit) && os(iOS)
import ActivityKit
import Foundation

struct LacticRideAttributes: ActivityAttributes {
  struct Bar: Codable, Hashable {
    var share: Double
    var step: Int
  }

  struct ContentState: Codable, Hashable {
    /// "ready", "riding", "paused" or "done".
    var phase: String
    var title: String
    /// "On MacBook" for the computer's ride; nil for the phone's own.
    var place: String?
    var interval: String?
    var step: Int?
    var counter: String?
    /// Seconds since 1970, while riding.
    var intervalEnd: Double?
    var intervalLeft: Double
    var rideEnd: Double?
    var rideLeft: Double
    var started: Double?
    var elapsed: Double
    var target: String?
    var power: Int?
    var heartRate: Int?
    var cadence: Int?
    /// "on", "under" or "over".
    var tone: String?
    var next: String?
    var bar: [Bar]
    var at: Double
    var note: String?
  }
}
#endif
