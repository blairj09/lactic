// Lactic's Smart Stack widgets and complications on the Apple Watch: last night's recovery score and
// today's ride, and today's exertion against its target, from the snapshot the Watch app keeps in its
// App Group (App.swift). Uses the snapshot, timeline and ring from Shared.swift. Nothing is worked
// out here: the numbers and words are the iPhone app's.

import SwiftUI
import WidgetKit

struct WatchWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: Entry

  var today: Snapshot? { entry.current ? entry.snapshot : nil }

  var body: some View {
    Group {
      switch family {
      case .accessoryCircular: circular
      case .accessoryCorner: corner
      case .accessoryInline: inline
      default: rectangular
      }
    }
    .containerBackground(for: .widget) { Color.clear }
  }

  var circular: some View {
    Group {
      if let score = today?.score {
        Gauge(value: Double(score), in: 0...100) {
          Text("REC")
        } currentValueLabel: {
          Text("\(score)").monospacedDigit()
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .tint(Palette.ring(score))
      } else {
        ZStack {
          AccessoryWidgetBackground()
          Text("–").font(.title3)
        }
      }
    }
  }

  var corner: some View {
    Text(today?.score.map(String.init) ?? "–")
      .font(.title2.weight(.semibold))
      .monospacedDigit()
      .widgetLabel {
        Text(today?.recovery?.word ?? "Recovery")
      }
  }

  var inline: some View {
    Group {
      if let s = today, let score = s.score {
        Text("Recovery \(score) · \(s.today.title)")
      } else {
        Text("Recovery –")
      }
    }
  }

  var rectangular: some View {
    HStack(spacing: 8) {
      Ring(score: today?.score, size: 40)
      VStack(alignment: .leading, spacing: 0) {
        if let s = today {
          Text(s.recovery?.word ?? "Recovery").font(.headline).lineLimit(1).widgetAccentable()
          Text(s.signal ?? s.recovery?.reason ?? "").font(.caption2).lineLimit(1).foregroundStyle(s.signal != nil ? Palette.warning : .secondary)
          Text(s.today.title).font(.caption2).lineLimit(1)
        } else {
          Text("Recovery").font(.headline).widgetAccentable()
          Text("Open Lactic on your iPhone").font(.caption2).lineLimit(2)
        }
      }
      Spacer(minLength: 0)
    }
  }
}

struct WatchRecoveryWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "LacticRecovery", provider: Provider()) { entry in
      WatchWidgetView(entry: entry)
    }
    .configurationDisplayName("Recovery")
    .description("Last night's recovery and today's ride.")
    .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
  }
}

/// Today's exertion so far, out of 10, against today's target.
struct ExertionWatchView: View {
  @Environment(\.widgetFamily) var family
  let entry: Entry

  /// Today's exertion, once there's heart rate today to count.
  var exertion: Snapshot.Exertion? {
    guard entry.current, let e = entry.snapshot?.exertion, e.soFar != nil else { return nil }
    return e
  }

  var over: Bool { exertion?.over ?? false }
  var number: String { exertion?.soFar.map(Self.one) ?? "–" }
  var color: Color { over ? Palette.warning : Palette.accent }

  static func one(_ v: Double) -> String { String(format: "%.1f", v) }

  /// "Target 5.0–7.0", or "Target 5–7" where room is short.
  func target(short: Bool = false) -> String? {
    guard let low = exertion?.low, let high = exertion?.high else { return nil }
    let f = { (v: Double) in short && v == v.rounded() ? String(Int(v)) : Self.one(v) }
    return "Target \(f(low))–\(f(high))"
  }

  var body: some View {
    Group {
      switch family {
      case .accessoryCircular: circular
      case .accessoryCorner: corner
      case .accessoryInline: inline
      default: rectangular
      }
    }
    .containerBackground(for: .widget) { Color.clear }
  }

  var rectangular: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack {
        Text("Exertion")
        Spacer(minLength: 4)
        if let t = target() { Text(t).monospacedDigit() }
      }
      .font(.caption2)
      .foregroundStyle(.secondary)
      .lineLimit(1)
      if let e = exertion {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
          Text(number).font(.title2.weight(.semibold)).monospacedDigit().foregroundStyle(over ? Palette.warning : .primary)
          Text("/ 10").font(.caption2).foregroundStyle(.secondary)
        }
        ExertionTrack(exertion: e, color: color).frame(height: 5)
        if let status = e.status {
          Text(status).font(.caption2).foregroundStyle(over ? Palette.warning : .secondary).lineLimit(1)
        }
      } else {
        Text(entry.current ? "No heart rate yet today" : "Open Lactic on your iPhone")
          .font(.footnote)
          .lineLimit(2)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  var circular: some View {
    ZStack {
      AccessoryWidgetBackground()
      ExertionRing(exertion: exertion, color: color)
        .padding(4)
      VStack(spacing: 0) {
        Text(number).font(.system(size: 15, weight: .semibold, design: .rounded)).monospacedDigit()
        Text("EXR").font(.system(size: 7, weight: .medium)).foregroundStyle(.secondary)
      }
    }
  }

  var corner: some View {
    Text(number)
      .font(.title3.weight(.semibold))
      .monospacedDigit()
      .foregroundStyle(over ? Palette.warning : .primary)
      .widgetLabel {
        Text(target(short: true) ?? "Exertion")
      }
  }

  var inline: some View {
    Group {
      if let e = exertion {
        Text(e.status.map { "Exertion \(number) · \($0)" } ?? "Exertion \(number)")
      } else {
        Text("Exertion –")
      }
    }
  }
}

/// The bar: 0 to 10, today's target shaded, filled to today's exertion so far.
struct ExertionTrack: View {
  let exertion: Snapshot.Exertion
  let color: Color

  var body: some View {
    GeometryReader { g in
      let x = { (v: Double) in g.size.width * CGFloat(min(max(v, 0), 10) / 10) }
      ZStack(alignment: .leading) {
        Capsule().fill(Color.secondary.opacity(0.3))
        if let low = exertion.low, let high = exertion.high {
          Rectangle().fill(Palette.accentSoft).frame(width: max(2, x(high) - x(low))).offset(x: x(low))
        }
        Capsule().fill(color).frame(width: max(3, x(exertion.soFar ?? 0))).widgetAccentable()
      }
    }
  }
}

/// The circle: an open ring from 0 (lower left) round to 10 (lower right), target shaded.
struct ExertionRing: View {
  let exertion: Snapshot.Exertion?
  let color: Color

  /// The ring leaves a quarter open at the bottom.
  static let sweep = 0.75

  func arc(_ from: Double, _ to: Double) -> some Shape {
    Circle()
      .trim(from: min(max(from, 0), 10) / 10 * Self.sweep, to: min(max(to, 0), 10) / 10 * Self.sweep)
      .rotation(.degrees(135))
  }

  var body: some View {
    GeometryReader { g in
      let line = min(g.size.width, g.size.height) * 0.1
      ZStack {
        arc(0, 10).stroke(Color.secondary.opacity(0.3), style: StrokeStyle(lineWidth: line, lineCap: .round))
        if let low = exertion?.low, let high = exertion?.high {
          arc(low, high).stroke(Palette.accentSoft, style: StrokeStyle(lineWidth: line))
        }
        if let soFar = exertion?.soFar, soFar > 0 {
          arc(0, soFar).stroke(color, style: StrokeStyle(lineWidth: line, lineCap: .round)).widgetAccentable()
        }
      }
    }
  }
}

struct WatchExertionWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "LacticExertion", provider: Provider()) { entry in
      ExertionWatchView(entry: entry)
    }
    .configurationDisplayName("Exertion")
    .description("Today's exertion against today's target.")
    .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
  }
}

@main
struct LacticWatchWidgets: WidgetBundle {
  var body: some Widget {
    WatchRecoveryWidget()
    WatchExertionWidget()
  }
}
