// Lactic's home and lock screen widgets on the iPhone. Four to pick from in the widget gallery:
// Today (recovery and the ride together, like the Today tab), Recovery (last night only), Ride
// (today's workout, tomorrow and the week) and Fields (the numbers the rider picks, Fields.swift).
// The app words everything (web/lib/widget-snapshot.ts) and
// writes it to the App Group after each Health read and sync (plugins/lactic-phone/ios/Sources/Widgets.swift);
// this only lays it out, with the snapshot, timeline and ring from Shared.swift. Built as an app
// extension added to the generated Xcode project by .github/scripts/ios-project.sh.

import SwiftUI
import UIKit
import WidgetKit

// MARK: - Pieces

/// The snapshot, when it's for this entry's day; and what to say when it isn't.
extension Entry {
  var today: Snapshot? { current ? snapshot : nil }
  var waitingForNight: String { snapshot == nil ? Store.problem() : "Open Lactic to read last night" }
  var waitingForRide: String { snapshot == nil ? Store.problem() : "Open Lactic for today's ride" }
}

extension Snapshot.Today {
  /// "70 min · 82 TSS" for a planned workout; the app's own line otherwise.
  var line: String? {
    if state == "planned", let stress, let length = detail?.components(separatedBy: " · ").first {
      return "\(length) · \(Int(stress.rounded())) TSS"
    }
    return detail
  }

  /// A zone square for a workout; none for rest days, events and rides already done.
  var showsZone: Bool { state == "planned" && step != nil }
}

struct ZoneMark: View {
  let step: Int?
  var size: CGFloat = 8

  var body: some View {
    RoundedRectangle(cornerRadius: size / 4).fill(ZoneColor.of(step)).frame(width: size, height: size).widgetAccentable()
  }
}

/// "Today" or "Tomorrow" over the workout's name and its length.
struct RideLines: View {
  let label: String
  let day: Snapshot.Today
  var big = false

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(label).font(.caption2).foregroundStyle(.secondary)
      HStack(spacing: 5) {
        if day.showsZone { ZoneMark(step: day.step, size: big ? 9 : 8) }
        Text(day.title).font(big ? .subheadline.weight(.semibold) : .caption.weight(.medium)).lineLimit(1).minimumScaleFactor(0.8)
      }
      if let line = day.line { Text(line).font(.caption2).foregroundStyle(.secondary).monospacedDigit().lineLimit(1) }
    }
  }
}

/// The week, Monday to Sunday: filled for ridden, half for ridden short, dashed for rest, ringed for today.
struct WeekDots: View {
  let week: Snapshot.Week
  var size: CGFloat = 16
  var letters = true

  var body: some View {
    HStack(spacing: size * 0.4) {
      ForEach(Array(week.days.enumerated()), id: \.offset) { _, d in
        VStack(spacing: 3) {
          dot(d)
          if letters { Text(d.label).font(.system(size: 10)).foregroundStyle(.secondary) }
        }
      }
    }
  }

  @ViewBuilder func dot(_ d: Snapshot.Week.Day) -> some View {
    let ring = d.today ? Palette.accent : Color.secondary.opacity(0.35)
    let line: CGFloat = d.today ? 2.5 : 1.5
    switch d.state {
    case "done":
      Circle().fill(Palette.accent).frame(width: size, height: size).widgetAccentable()
    case "partial":
      ZStack {
        Circle().stroke(Palette.accent, lineWidth: 1.5)
        Circle().trim(from: 0, to: 0.5).fill(Palette.accent).rotationEffect(.degrees(90)).widgetAccentable()
      }
      .frame(width: size, height: size)
    case "missed":
      Circle().stroke(Palette.warning.opacity(0.7), lineWidth: 1.5).frame(width: size, height: size)
    case "rest":
      Circle().stroke(ring, style: StrokeStyle(lineWidth: line, dash: [2, 2])).frame(width: size, height: size)
    default:
      Circle().stroke(ring, lineWidth: line).frame(width: size, height: size)
    }
  }
}

/// Last night's score for each of the last 7 mornings, the latest in full color.
struct MorningBars: View {
  let week: [Double?]

  var body: some View {
    HStack(alignment: .bottom, spacing: 4) {
      ForEach(Array(week.enumerated()), id: \.offset) { i, score in
        RoundedRectangle(cornerRadius: 3)
          .fill(i == week.count - 1 ? Palette.accent : Palette.accentSoft)
          .frame(width: 13, height: 6 + CGFloat((score ?? 0) / 100) * 20)
      }
    }
    .frame(height: 26, alignment: .bottom)
  }
}

struct MetricRows: View {
  let snapshot: Snapshot

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      ForEach(snapshot.metrics) { m in
        HStack(spacing: 4) {
          Text(m.label).foregroundStyle(.secondary)
          Spacer(minLength: 4)
          if m.concern { Circle().fill(Palette.warning).frame(width: 5, height: 5) }
          Text(m.value).monospacedDigit()
        }
        .font(.caption)
      }
    }
  }
}

/// The one line under the score: a warning sign first, else the main reason.
struct ReasonLine: View {
  let snapshot: Snapshot
  var lines = 2

  var body: some View {
    Text(snapshot.signal ?? snapshot.recovery?.reason ?? "")
      .font(.caption2)
      .foregroundStyle(snapshot.signal != nil ? Palette.warning : .secondary)
      .lineLimit(lines)
  }
}

struct WeekSummary: View {
  let week: Snapshot.Week

  var body: some View {
    VStack(alignment: .trailing, spacing: 0) {
      Text("\(week.rides.done) of \(week.rides.planned) rides").font(.caption).monospacedDigit()
      Text("\(week.time.done) of \(week.time.planned)").font(.caption2).foregroundStyle(.secondary).monospacedDigit()
    }
  }
}

private let homeBackground = Color(uiColor: .systemBackground)

// MARK: - Ride widget

struct RideView: View {
  @Environment(\.widgetFamily) var family
  let entry: Entry

  var body: some View {
    switch family {
    case .accessoryCircular: RideCircular(entry: entry)
    case .accessoryRectangular: RideRectangular(entry: entry)
    case .accessoryInline: RideInline(entry: entry)
    case .systemMedium: medium.containerBackground(for: .widget) { homeBackground }
    case .systemLarge: RideLarge(entry: entry).containerBackground(for: .widget) { homeBackground }
    default: small.containerBackground(for: .widget) { homeBackground }
    }
  }

  var small: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let s = entry.today {
        RideLines(label: "Today", day: s.today, big: true)
        Spacer(minLength: 4)
        if s.today.state == "planned", let week = s.week {
          WeekDots(week: week, size: 13, letters: false)
          Text("\(week.rides.done) of \(week.rides.planned) rides this week").font(.caption2).foregroundStyle(.secondary).padding(.top, 4)
        } else if let tomorrow = s.tomorrow {
          RideLines(label: "Tomorrow", day: tomorrow)
        }
      } else {
        Text("Today").font(.caption2).foregroundStyle(.secondary)
        Spacer()
        Text(entry.waitingForRide).font(.caption2).foregroundStyle(.secondary).lineLimit(3)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  var medium: some View {
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading, spacing: 0) {
        if let s = entry.today {
          RideLines(label: "Today", day: s.today, big: true)
          Spacer(minLength: 4)
          if let tomorrow = s.tomorrow { RideLines(label: "Tomorrow", day: tomorrow) }
        } else {
          Text("Today").font(.caption2).foregroundStyle(.secondary)
          Spacer()
          Text(entry.waitingForRide).font(.caption2).foregroundStyle(.secondary).lineLimit(3)
        }
      }
      .frame(width: 150, alignment: .leading)
      .frame(maxHeight: .infinity, alignment: .topLeading)

      VStack(alignment: .leading, spacing: 6) {
        if let week = entry.today?.week {
          Text(week.label.map { "This week · \($0.replacingOccurrences(of: " week", with: ""))" } ?? "This week").font(.caption2).foregroundStyle(.secondary)
          WeekDots(week: week)
          Spacer(minLength: 2)
          HStack { Text("Rides").foregroundStyle(.secondary); Spacer(); Text("\(week.rides.done) of \(week.rides.planned)").monospacedDigit() }.font(.caption)
          HStack { Text("Time").foregroundStyle(.secondary); Spacer(); Text("\(week.time.done) of \(week.time.planned)").monospacedDigit() }.font(.caption)
          ProgressBar(share: week.time.share)
        } else {
          Spacer()
        }
      }
      .frame(maxHeight: .infinity, alignment: .topLeading)
    }
  }
}

struct ProgressBar: View {
  let share: Double

  var body: some View {
    GeometryReader { g in
      ZStack(alignment: .leading) {
        Capsule().fill(Color.secondary.opacity(0.18))
        Capsule().fill(Palette.accent).frame(width: max(3, g.size.width * CGFloat(min(max(share, 0), 1)))).widgetAccentable()
      }
    }
    .frame(height: 6)
  }
}

/// The large size, also what Today shows for a rider who doesn't track recovery.
struct RideLarge: View {
  let entry: Entry

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let s = entry.today {
        RideLines(label: "Today", day: s.today, big: true)
        if let exertion = s.exertion { ExertionBar(exertion: exertion) }
        if let tomorrow = s.tomorrow { RideLines(label: "Tomorrow", day: tomorrow) }
        Spacer(minLength: 0)
        if let week = s.week {
          Divider()
          Text(week.label ?? "This week").font(.caption2).foregroundStyle(.secondary)
          HStack(alignment: .bottom) {
            WeekDots(week: week, size: 18)
            Spacer()
            WeekSummary(week: week)
          }
          ProgressBar(share: week.time.share)
        }
      } else {
        Text("Today").font(.caption2).foregroundStyle(.secondary)
        Text(entry.waitingForRide).font(.caption).foregroundStyle(.secondary)
        Spacer()
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct RideCircular: View {
  let entry: Entry

  var body: some View {
    Group {
      if let week = entry.today?.week, week.rides.planned > 0 {
        Gauge(value: Double(min(week.rides.done, week.rides.planned)), in: 0...Double(week.rides.planned)) {
          Text("RIDES")
        } currentValueLabel: {
          Text("\(week.rides.done)/\(week.rides.planned)").monospacedDigit()
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
}

struct RideRectangular: View {
  let entry: Entry

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      if let s = entry.today {
        Text(s.today.title).font(.headline).widgetAccentable().lineLimit(1)
        if let line = s.today.line { Text(line).font(.caption).lineLimit(1) }
        if s.today.state != "planned", let tomorrow = s.tomorrow {
          Text("Tomorrow: \(tomorrow.title)").font(.caption).lineLimit(1)
        } else if let week = s.week {
          Text("\(week.rides.done) of \(week.rides.planned) rides this week").font(.caption).lineLimit(1)
        }
      } else {
        Text("Today's ride").font(.headline).widgetAccentable()
        Text(entry.waitingForRide).font(.caption).lineLimit(2)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .containerBackground(for: .widget) { Color.clear }
  }
}

struct RideInline: View {
  let entry: Entry

  var body: some View {
    Group {
      if let s = entry.today {
        Text(s.today.state == "planned" ? "Today: \(s.today.title)" : s.today.title)
      } else {
        Text("Lactic: open for today's ride")
      }
    }
    .containerBackground(for: .widget) { Color.clear }
  }
}

// MARK: - Recovery widget

struct RecoveryView: View {
  @Environment(\.widgetFamily) var family
  let entry: Entry

  var body: some View {
    switch family {
    case .accessoryCircular: RecoveryCircular(entry: entry)
    case .accessoryRectangular: rectangular
    case .accessoryInline: inline
    case .systemMedium: medium.containerBackground(for: .widget) { homeBackground }
    default: small.containerBackground(for: .widget) { homeBackground }
    }
  }

  /// Nothing to show: no snapshot, an old one, or a rider who doesn't track sleep.
  var waiting: String? {
    guard let s = entry.today else { return entry.waitingForNight }
    return s.tracksRecovery ? nil : "Turn on sleep and recovery in Lactic's Settings"
  }

  var small: some View {
    VStack(alignment: .leading, spacing: 4) {
      Ring(score: entry.today?.score, size: 64)
      Spacer(minLength: 0)
      if let note = waiting {
        Text(note).font(.caption2).foregroundStyle(.secondary).lineLimit(3)
      } else if let s = entry.today {
        Text(s.recovery?.word ?? "Recovery").font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
        ReasonLine(snapshot: s)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  var medium: some View {
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading, spacing: 6) {
        Ring(score: entry.today?.score, size: 60)
        if let note = waiting {
          Text(note).font(.caption2).foregroundStyle(.secondary).lineLimit(4)
        } else if let s = entry.today {
          Text(s.recovery?.word ?? "Recovery").font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
          ReasonLine(snapshot: s, lines: 3)
        }
      }
      .frame(width: 110, alignment: .leading)

      VStack(alignment: .leading, spacing: 4) {
        if waiting == nil, let s = entry.today {
          MetricRows(snapshot: s)
          if let sleep = s.sleepScore {
            HStack { Text("Sleep score").foregroundStyle(.secondary); Spacer(); Text("\(Int(sleep.rounded()))").monospacedDigit() }.font(.caption)
          }
          Spacer(minLength: 2)
          if let week = s.recovery?.week, !week.isEmpty {
            HStack(alignment: .bottom) {
              MorningBars(week: week)
              Spacer()
              Text("Last 7 mornings").font(.caption2).foregroundStyle(.secondary)
            }
          }
        } else {
          Spacer()
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  var rectangular: some View {
    VStack(alignment: .leading, spacing: 1) {
      if waiting == nil, let s = entry.today {
        Text(s.score.map { "Recovery \($0) · \(s.recovery?.word ?? "")" } ?? "Recovery").font(.headline).widgetAccentable().lineLimit(1)
        Text(s.signal ?? s.recovery?.reason ?? "").font(.caption).lineLimit(1)
        Text(s.metrics.prefix(2).map { "\($0.label) \($0.value)" }.joined(separator: " · ")).font(.caption).lineLimit(1)
      } else {
        Text("Recovery").font(.headline).widgetAccentable()
        Text(waiting ?? "").font(.caption).lineLimit(2)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .containerBackground(for: .widget) { Color.clear }
  }

  var inline: some View {
    Group {
      if waiting == nil, let s = entry.today, let score = s.score {
        Text("Recovery \(score) · \(s.recovery?.word ?? "")")
      } else {
        Text("Lactic: open to read last night")
      }
    }
    .containerBackground(for: .widget) { Color.clear }
  }
}

struct RecoveryCircular: View {
  let entry: Entry

  var body: some View {
    Group {
      if let s = entry.today, s.tracksRecovery, let score = s.score {
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
}

// MARK: - Today widget (recovery and the ride together)

struct TodayView: View {
  @Environment(\.widgetFamily) var family
  let entry: Entry

  /// A rider who doesn't track sleep gets the Ride widget's views instead of an empty ring.
  var rideOnly: Bool { entry.snapshot.map { !$0.tracksRecovery } ?? false }

  var body: some View {
    if rideOnly {
      RideView(entry: entry)
    } else {
      switch family {
      case .accessoryCircular: RecoveryCircular(entry: entry)
      case .accessoryRectangular: rectangular
      case .accessoryInline: inline
      case .systemMedium: medium.containerBackground(for: .widget) { homeBackground }
      case .systemLarge: large.containerBackground(for: .widget) { homeBackground }
      default: small.containerBackground(for: .widget) { homeBackground }
      }
    }
  }

  var small: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .center, spacing: 8) {
        Ring(score: entry.today?.score, size: 46)
        VStack(alignment: .leading, spacing: 1) {
          Text("Recovery").font(.caption2).foregroundStyle(.secondary)
          Text(entry.today?.recovery?.word ?? "–").font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
        }
      }
      Spacer(minLength: 0)
      if let s = entry.today {
        RideLines(label: "Today", day: s.today)
      } else {
        Text(entry.waitingForNight).font(.caption2).foregroundStyle(.secondary).lineLimit(3)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  var medium: some View {
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading, spacing: 6) {
        Ring(score: entry.today?.score, size: 60)
        Text(entry.today?.recovery?.word ?? "Recovery").font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
        if let s = entry.today {
          ReasonLine(snapshot: s, lines: 3)
        } else {
          Text(entry.waitingForNight).font(.caption2).foregroundStyle(.secondary).lineLimit(3)
        }
      }
      .frame(width: 110, alignment: .leading)

      VStack(alignment: .leading, spacing: 4) {
        if let s = entry.today {
          MetricRows(snapshot: s)
          Spacer(minLength: 2)
          HStack(spacing: 5) {
            if s.today.showsZone { ZoneMark(step: s.today.step) }
            Text(s.today.title).font(.caption.weight(.medium)).lineLimit(1)
          }
          if let line = s.today.line { Text(line).font(.caption2).foregroundStyle(.secondary).monospacedDigit().lineLimit(1) }
          if let exertion = s.exertion { ExertionBar(exertion: exertion) }
        } else {
          Spacer()
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  var large: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 12) {
        Ring(score: entry.today?.score, size: 64)
        VStack(alignment: .leading, spacing: 1) {
          Text(entry.today?.recovery?.word ?? "Recovery").font(.headline).lineLimit(1)
          if let s = entry.today {
            ReasonLine(snapshot: s)
          } else {
            Text(entry.waitingForNight).font(.caption).foregroundStyle(.secondary).lineLimit(2)
          }
        }
      }
      if let s = entry.today {
        HStack(alignment: .bottom) {
          if let week = s.recovery?.week, !week.isEmpty { MorningBars(week: week) }
          Spacer()
          MetricRows(snapshot: s).frame(width: 170)
        }
        Divider()
        RideLines(label: "Today", day: s.today, big: true)
        if let exertion = s.exertion { ExertionBar(exertion: exertion) }
        if let tomorrow = s.tomorrow { RideLines(label: "Tomorrow", day: tomorrow) }
        Spacer(minLength: 0)
        if let week = s.week {
          Divider()
          HStack(alignment: .bottom) {
            WeekDots(week: week)
            Spacer()
            WeekSummary(week: week)
          }
        }
      } else {
        Spacer()
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  var rectangular: some View {
    VStack(alignment: .leading, spacing: 1) {
      if let s = entry.today {
        Text(s.score.map { "Recovery \($0) · \(s.recovery?.word ?? "")" } ?? "Recovery").font(.headline).widgetAccentable().lineLimit(1)
        Text([s.today.title, s.today.detail.map { $0.components(separatedBy: " · ").first ?? $0 }].compactMap { $0 }.joined(separator: " · ")).font(.caption).lineLimit(1)
        if let week = s.week {
          Text("\(week.rides.done) of \(week.rides.planned) rides this week").font(.caption).lineLimit(1)
        } else {
          Text(s.signal ?? s.metrics.prefix(2).map { "\($0.label) \($0.value)" }.joined(separator: " · ")).font(.caption).lineLimit(1)
        }
      } else {
        Text("Recovery").font(.headline).widgetAccentable()
        Text(entry.waitingForNight).font(.caption).lineLimit(2)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .containerBackground(for: .widget) { Color.clear }
  }

  var inline: some View {
    Group {
      if let s = entry.today, let score = s.score {
        Text("\(score) \(s.recovery?.word ?? "") · \(s.today.title)")
      } else {
        Text("Lactic: open to read last night")
      }
    }
    .containerBackground(for: .widget) { Color.clear }
  }
}

// MARK: - The widgets

/// Keeps the first widget's kind, so widgets already on a home screen become this one.
struct TodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "LacticRecovery", provider: Provider()) { entry in
      TodayView(entry: entry)
    }
    .configurationDisplayName("Today")
    .description("Last night's recovery, today's ride and your week.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

struct RecoveryWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "LacticLastNight", provider: Provider()) { entry in
      RecoveryView(entry: entry)
    }
    .configurationDisplayName("Recovery")
    .description("Last night's recovery score, HRV, resting heart rate and sleep.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

struct RideWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "LacticRide", provider: Provider()) { entry in
      RideView(entry: entry)
    }
    .configurationDisplayName("Ride")
    .description("Today's workout, tomorrow's, and your week so far.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

@main
struct LacticWidgets: WidgetBundle {
  var body: some Widget {
    TodayWidget()
    RecoveryWidget()
    RideWidget()
    FieldsWidget()
  }
}
