// Lactic's home and lock screen widgets: last night's recovery and today's ride. The app words
// everything (web/lib/widget-snapshot.ts) and writes it to the App Group after each Health read and
// sync (plugins/lactic-phone/ios/Sources/Widgets.swift); this only lays it out. Built as an app
// extension added to the generated Xcode project by .github/scripts/ios-project.sh.

import SwiftUI
import UIKit
import WidgetKit

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

  static func load() -> Snapshot? {
    guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
          let data = try? Data(contentsOf: dir.appendingPathComponent("widget.json"))
    else { return nil }
    return try? JSONDecoder().decode(Snapshot.self, from: data)
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
  static let accent = Color(uiColor: UIColor { t in
    t.userInterfaceStyle == .dark ? UIColor(red: 0x4F / 255, green: 0x7D / 255, blue: 1, alpha: 1) : UIColor(red: 0x2B / 255, green: 0x55 / 255, blue: 0xD6 / 255, alpha: 1)
  })
  static let accentSoft = Color(uiColor: UIColor { t in
    t.userInterfaceStyle == .dark ? UIColor(red: 0x14 / 255, green: 0x1C / 255, blue: 0x33 / 255, alpha: 1) : UIColor(red: 0xE3 / 255, green: 0xE9 / 255, blue: 0xFB / 255, alpha: 1)
  })
  static let warning = Color(uiColor: UIColor { t in
    t.userInterfaceStyle == .dark ? UIColor(red: 0xE5 / 255, green: 0xA9 / 255, blue: 0x3B / 255, alpha: 1) : UIColor(red: 0x8F / 255, green: 0x3F / 255, blue: 0x0C / 255, alpha: 1)
  })

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

// MARK: - Views

struct WidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: Entry

  var body: some View {
    switch family {
    case .accessoryCircular: circular
    case .accessoryRectangular: rectangular
    case .accessoryInline: inline
    case .systemMedium: medium.containerBackground(for: .widget) { Color(uiColor: .systemBackground) }
    default: small.containerBackground(for: .widget) { Color(uiColor: .systemBackground) }
    }
  }

  /// The snapshot, when it's for today.
  var today: Snapshot? { entry.current ? entry.snapshot : nil }

  var waiting: String { entry.snapshot == nil ? "Open Lactic to set up recovery" : "Open Lactic to read last night" }

  // Home screen

  var small: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .center, spacing: 8) {
        Ring(score: today?.score, size: 52)
        VStack(alignment: .leading, spacing: 1) {
          Text("Recovery").font(.caption2).foregroundStyle(.secondary)
          Text(today?.recovery?.word ?? "–").font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
        }
      }
      Spacer(minLength: 0)
      if let s = today {
        if let signal = s.signal {
          Text(signal).font(.caption2).foregroundStyle(Palette.warning).lineLimit(2)
        } else {
          Text(s.recovery?.reason ?? "").font(.caption2).foregroundStyle(.secondary).lineLimit(2)
        }
        Text(s.today.title).font(.caption.weight(.medium)).lineLimit(1)
      } else {
        Text(waiting).font(.caption2).foregroundStyle(.secondary).lineLimit(3)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  var medium: some View {
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading, spacing: 6) {
        Ring(score: today?.score, size: 64)
        Text(today?.recovery?.word ?? "Recovery").font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
        Text(today.map { $0.signal ?? $0.recovery?.reason ?? "" } ?? waiting)
          .font(.caption2)
          .foregroundStyle(today?.signal != nil ? Palette.warning : .secondary)
          .lineLimit(3)
      }
      .frame(width: 112, alignment: .leading)

      VStack(alignment: .leading, spacing: 4) {
        if let s = today {
          ForEach(s.metrics) { m in
            HStack(spacing: 4) {
              Text(m.label).foregroundStyle(.secondary)
              Spacer(minLength: 4)
              if m.concern { Circle().fill(Palette.warning).frame(width: 5, height: 5) }
              Text(m.value).monospacedDigit()
            }
            .font(.caption)
          }
          if let sleep = s.sleepScore {
            HStack {
              Text("Sleep score").foregroundStyle(.secondary)
              Spacer()
              Text("\(Int(sleep.rounded()))").monospacedDigit()
            }
            .font(.caption)
          }
          Spacer(minLength: 2)
          VStack(alignment: .leading, spacing: 0) {
            Text(s.today.title).font(.caption.weight(.medium)).lineLimit(1)
            if let detail = s.today.detail { Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
          }
          if let exertion = s.exertion { ExertionBar(exertion: exertion) }
        } else {
          Spacer()
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  // Lock screen

  var circular: some View {
    Group {
      if let score = today?.score {
        Gauge(value: Double(score), in: 0...100) {
          Text("REC")
        } currentValueLabel: {
          Text("\(score)").monospacedDigit()
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetAccentable()
      } else {
        ZStack {
          AccessoryWidgetBackground()
          Text("–").font(.title3)
        }
      }
    }
    .containerBackground(for: .widget) { Color.clear }
  }

  var rectangular: some View {
    VStack(alignment: .leading, spacing: 1) {
      if let s = today {
        Text(s.score.map { "Recovery \($0) · \(s.recovery?.word ?? "")" } ?? "Recovery").font(.headline).widgetAccentable().lineLimit(1)
        Text(s.signal ?? s.metrics.prefix(2).map { "\($0.label) \($0.value)" }.joined(separator: " · ")).font(.caption).lineLimit(1)
        Text([s.today.title, s.today.detail.map { $0.components(separatedBy: " · ").first ?? $0 }].compactMap { $0 }.joined(separator: " · ")).font(.caption).lineLimit(1)
      } else {
        Text("Recovery").font(.headline).widgetAccentable()
        Text(waiting).font(.caption).lineLimit(2)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .containerBackground(for: .widget) { Color.clear }
  }

  var inline: some View {
    Group {
      if let s = today, let score = s.score {
        Text("Recovery \(score) · \(s.today.title)")
      } else {
        Text("Lactic: open to read last night")
      }
    }
    .containerBackground(for: .widget) { Color.clear }
  }
}

// MARK: - The widget

struct RecoveryWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "LacticRecovery", provider: Provider()) { entry in
      WidgetView(entry: entry)
    }
    .configurationDisplayName("Recovery")
    .description("Last night's recovery and today's ride.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

@main
struct LacticWidgets: WidgetBundle {
  var body: some Widget {
    RecoveryWidget()
  }
}
