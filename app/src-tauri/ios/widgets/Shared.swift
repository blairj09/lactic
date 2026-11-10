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

  struct Today: Decodable {
    let title: String
    let detail: String?
    let state: String
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

  var score: Int? { recovery?.score.map { Int($0.rounded()) } }

  static let sample = Snapshot(
    v: 1, at: "", day: "",
    recovery: Recovery(score: 64, word: "Normal", reason: "HRV 6% above your normal", week: [52, 58, 41, 47, 60, 55, 64]),
    metrics: [
      Metric(key: "hrv", label: "HRV", value: "58 ms", concern: false),
      Metric(key: "restingHeartRate", label: "Resting HR", value: "49 bpm", concern: false),
      Metric(key: "sleepHours", label: "Sleep", value: "7h 32m", concern: false),
    ],
    sleepScore: 82, signal: nil,
    today: Today(title: "Threshold 4 x 8", detail: "70 min · Threshold", state: "planned"),
    exertion: Exertion(soFar: 1.2, low: 3.4, high: 4.4, landsAt: 3.9))
}

enum Store {
  static let group = "group.fit.lactic.app"

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
