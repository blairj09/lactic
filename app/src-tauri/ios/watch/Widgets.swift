// Lactic's Smart Stack widget and complications on the Apple Watch: last night's recovery score and
// today's ride, from the snapshot the Watch app keeps in its App Group (App.swift). Uses the
// snapshot, timeline and ring from Shared.swift.

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

@main
struct LacticWatchWidgets: WidgetBundle {
  var body: some Widget {
    WatchRecoveryWidget()
  }
}
