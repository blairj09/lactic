// Lactic's home and lock screen widgets on the iPhone: last night's recovery and today's ride. The
// app words everything (web/lib/widget-snapshot.ts) and writes it to the App Group after each Health
// read and sync (plugins/lactic-phone/ios/Sources/Widgets.swift); this only lays it out, with the
// snapshot, timeline and ring from Shared.swift. Built as an app extension added to the generated
// Xcode project by .github/scripts/ios-project.sh.

import SwiftUI
import UIKit
import WidgetKit

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

  var waiting: String { entry.snapshot == nil ? Store.problem() : "Open Lactic to read last night" }

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
