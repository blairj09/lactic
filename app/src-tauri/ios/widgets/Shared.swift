// What the widgets on the iPhone and the Watch, and the Watch app, share: the snapshot the iPhone
// app words (web/lib/widget-snapshot.ts) and writes to the App Group, the timeline, and the score
// ring. Copied into each target by .github/scripts/ios-project.sh.

import SwiftUI
import WidgetKit
#if canImport(UIKit)
import UIKit
#endif

// MARK: - The snapshot

struct Snapshot: Decodable {
  struct Recovery: Decodable {
    let score: Double?
    let word: String?
    let reason: String?
    let week: [Double?]
  }

  struct Metric: Decodable, Identifiable {
    let key: String
    let label: String
    let value: String
    let concern: Bool
    var id: String { key }
  }

  /// A day's ride: today's, or tomorrow's.
  struct Today: Decodable {
    let title: String
    let detail: String?
    /// planned, done, rest or event.
    let state: String
    /// Planned or ridden TSS, and the workout's zone as the app's 1 to 7 color step (added later, so optional).
    var stress: Double? = nil
    var step: Int? = nil
  }

  struct Week: Decodable {
    struct Day: Decodable {
      let label: String
      /// done, partial, missed, rest or planned.
      let state: String
      let today: Bool
    }
    struct Count: Decodable {
      let done: Int
      let planned: Int
    }
    struct Time: Decodable {
      let done: String
      let planned: String
      let share: Double
    }
    let label: String?
    let days: [Day]
    let rides: Count
    let time: Time
  }

  struct Exertion: Decodable {
    let soFar: Double?
    let low: Double?
    let high: Double?
    let landsAt: Double?
  }

  let v: Int
  let at: String
  let day: String
  let recovery: Recovery?
  let metrics: [Metric]
  let sleepScore: Double?
  let signal: String?
  let today: Today
  let exertion: Exertion?
  // Added later: older snapshots don't have them.
  var recoveryTracked: Bool? = nil
  var tomorrow: Today? = nil
  var week: Week? = nil

  var score: Int? { recovery?.score.map { Int($0.rounded()) } }
  /// False only when the rider said they don't track sleep; then the widgets lead with the ride.
  var tracksRecovery: Bool { recoveryTracked ?? true }

  static let sample = Snapshot(
    v: 1, at: "", day: "",
    recovery: Recovery(score: 64, word: "Normal", reason: "HRV 6% above your normal", week: [52, 58, 41, 47, 60, 55, 64]),
    metrics: [
      Metric(key: "hrv", label: "HRV", value: "58 ms", concern: false),
      Metric(key: "restingHeartRate", label: "Resting HR", value: "49 bpm", concern: false),
      Metric(key: "sleepHours", label: "Sleep", value: "7h 32m", concern: false),
    ],
    sleepScore: 82, signal: nil,
    today: Today(title: "Threshold 4 x 8", detail: "70 min · Threshold", state: "planned", stress: 82, step: 5),
    exertion: Exertion(soFar: 1.2, low: 3.4, high: 4.4, landsAt: 3.9),
    recoveryTracked: true,
    tomorrow: Today(title: "Endurance 90 min", detail: "90 min · Endurance", state: "planned", stress: 58, step: 2),
    week: Week(
      label: "Build week",
      days: zip(["M", "T", "W", "T", "F", "S", "S"], ["done", "done", "rest", "done", "planned", "planned", "planned"]).enumerated().map { i, d in
        Week.Day(label: d.0, state: d.1, today: i == 4)
      },
      rides: Week.Count(done: 3, planned: 5),
      time: Week.Time(done: "3h 05m", planned: "6h 10m", share: 0.5)))
}

enum Store {
  /// group.fit.lactic.app, or group.fit.lactic.modular in the Lactic Modular testing app: the App
  /// Group of the app this extension is part of (its bundle id without .widget or .watchkitapp).
  static let group: String = {
    let parts = (Bundle.main.bundleIdentifier ?? "").split(separator: ".")
    guard parts.count >= 3, parts[0] == "fit", parts[1] == "lactic" else { return "group.fit.lactic.app" }
    return "group." + parts[0...2].joined(separator: ".")
  }()

  static var url: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("widget.json")
  }

  static func load() -> Snapshot? {
    guard let url, let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(Snapshot.self, from: data)
  }

  /// Why there's no snapshot to show, in words for the widget.
  static func problem() -> String {
    guard let url else { return "The widget can't reach Lactic's shared data" }
    guard let data = try? Data(contentsOf: url) else { return "Open Lactic to set up recovery" }
    do {
      _ = try JSONDecoder().decode(Snapshot.self, from: data)
      return "Open Lactic to read last night"
    } catch DecodingError.keyNotFound(let key, _) {
      return "Lactic's data is missing \(key.stringValue)"
    } catch DecodingError.typeMismatch(_, let c), DecodingError.valueNotFound(_, let c) {
      return "Lactic's data has a bad \(c.codingPath.map(\.stringValue).joined(separator: "."))"
    } catch {
      return "Lactic's data couldn't be read"
    }
  }

  /// The day as the app writes it, YYYY-MM-DD in this iPhone's time zone.
  static func day(_ date: Date) -> String {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = .current
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: date)
  }
}

// MARK: - Timeline

struct Entry: TimelineEntry {
  let date: Date
  let snapshot: Snapshot?
  /// The snapshot is for this entry's day; a new day needs the app to read last night first.
  let current: Bool
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry {
    Entry(date: Date(), snapshot: .sample, current: true)
  }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    if context.isPreview { return completion(placeholder(in: context)) }
    completion(entry(at: Date(), Store.load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let now = Date()
    let snapshot = Store.load()
    let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86_400))
    // The app reloads the widgets whenever it has something new; past midnight the day turns stale.
    completion(Timeline(entries: [entry(at: now, snapshot), entry(at: midnight, snapshot)], policy: .after(midnight.addingTimeInterval(3_600))))
  }

  private func entry(at date: Date, _ snapshot: Snapshot?) -> Entry {
    Entry(date: date, snapshot: snapshot, current: snapshot.map { $0.day == Store.day(date) } ?? false)
  }
}

// MARK: - Look

enum Palette {
  #if os(watchOS)
  // The Watch is always dark.
  static let accent = Color(red: 0x4F / 255, green: 0x7D / 255, blue: 1)
  static let accentSoft = Color(red: 0x1E / 255, green: 0x2A / 255, blue: 0x4D / 255)
  static let warning = Color(red: 0xE5 / 255, green: 0xA9 / 255, blue: 0x3B / 255)
  #else
  static let accent = Color(uiColor: UIColor { t in
    t.userInterfaceStyle == .dark ? UIColor(red: 0x4F / 255, green: 0x7D / 255, blue: 1, alpha: 1) : UIColor(red: 0x2B / 255, green: 0x55 / 255, blue: 0xD6 / 255, alpha: 1)
  })
  static let accentSoft = Color(uiColor: UIColor { t in
    t.userInterfaceStyle == .dark ? UIColor(red: 0x14 / 255, green: 0x1C / 255, blue: 0x33 / 255, alpha: 1) : UIColor(red: 0xE3 / 255, green: 0xE9 / 255, blue: 0xFB / 255, alpha: 1)
  })
  static let warning = Color(uiColor: UIColor { t in
    t.userInterfaceStyle == .dark ? UIColor(red: 0xE5 / 255, green: 0xA9 / 255, blue: 0x3B / 255, alpha: 1) : UIColor(red: 0x8F / 255, green: 0x3F / 255, blue: 0x0C / 255, alpha: 1)
  })
  #endif

  static func ring(_ score: Int) -> Color { score < 34 ? warning : accent }
}

/// The app's zone colors, 1 (recovery) to 7 (anaerobic), as on the Rides calendar.
enum ZoneColor {
  static let light: [UInt32] = [0xD5DAE6, 0xB2C0EA, 0x8AA2E6, 0x6283E2, 0x3F66DB, 0x2B55D6, 0x1B3593]

  static func of(_ step: Int?) -> Color {
    guard let step, step >= 1, step <= light.count else { return Color.secondary.opacity(0.4) }
    let v = light[step - 1]
    return Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
  }
}

struct Ring: View {
  let score: Int?
  let size: CGFloat

  var body: some View {
    let line = size * 0.11
    ZStack {
      Circle().stroke(Color.secondary.opacity(0.22), lineWidth: line)
      if let score {
        Circle()
          .trim(from: 0, to: CGFloat(max(score, 1)) / 100)
          .stroke(Palette.ring(score), style: StrokeStyle(lineWidth: line, lineCap: .round))
          .rotationEffect(.degrees(-90))
          .widgetAccentable()
      }
      Text(score.map(String.init) ?? "–")
        .font(.system(size: size * 0.34, weight: .semibold, design: .rounded))
        .monospacedDigit()
    }
    .frame(width: size, height: size)
  }
}

/// Today's exertion so far against its target band, with where the planned ride should land it.
struct ExertionBar: View {
  let exertion: Snapshot.Exertion

  var body: some View {
    let top = max(8, exertion.high ?? 0, exertion.landsAt ?? 0, exertion.soFar ?? 0)
    VStack(alignment: .leading, spacing: 3) {
      HStack {
        Text("Exertion today").foregroundStyle(.secondary)
        Spacer()
        if let soFar = exertion.soFar { Text(String(format: "%.1f", soFar)).monospacedDigit() }
        if let low = exertion.low, let high = exertion.high {
          Text("target \(String(format: "%.1f", low))–\(String(format: "%.1f", high))").foregroundStyle(.secondary).monospacedDigit()
        }
      }
      .font(.caption2)
      GeometryReader { g in
        let x = { (v: Double) in g.size.width * CGFloat(min(v, top) / top) }
        ZStack(alignment: .leading) {
          Capsule().fill(Color.secondary.opacity(0.18))
          if let low = exertion.low, let high = exertion.high {
            Rectangle().fill(Palette.accentSoft).frame(width: max(2, x(high) - x(low))).offset(x: x(low))
          }
          if let landsAt = exertion.landsAt {
            Capsule().fill(Palette.accent.opacity(0.35)).frame(width: x(landsAt))
          }
          if let soFar = exertion.soFar {
            Capsule().fill(Palette.accent).frame(width: max(3, x(soFar))).widgetAccentable()
          }
        }
      }
      .frame(height: 6)
    }
  }
}
