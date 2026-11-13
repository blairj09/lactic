// The ride's Live Activity on the lock screen and in the Dynamic Island, for a ride on the iPhone
// or the computer's ride seen from it. The app words it (web/lib/ride/live-activity.ts) and hands it
// over through the lactic-phone plugin; this lays it out. Countdowns are moments, so they keep
// ticking without updates. A computer ride's numbers only arrive while the phone is unlocked, so
// once they're stale (no update for a while) power and heart rate step aside for the countdowns.
// LacticRideAttributes is in plugins/lactic-phone/ios/Sources/RideActivityAttributes.swift, copied
// in beside this file by ios-project.sh.

import ActivityKit
import SwiftUI
import WidgetKit

typealias RideState = LacticRideAttributes.ContentState

private let good = Color(red: 0x7E / 255, green: 0xE0 / 255, blue: 0xA0 / 255)
private let amber = Color(red: 0xE5 / 255, green: 0xA9 / 255, blue: 0x3B / 255)
private let over = Color(red: 0xFF / 255, green: 0x8A / 255, blue: 0x80 / 255)
private let dim = Color.white.opacity(0.62)
private let brand = Color(red: 0x2B / 255, green: 0x55 / 255, blue: 0xD6 / 255)

extension RideState {
  var riding: Bool { phase == "riding" }
  var free: Bool { interval == nil && counter == nil }
  var toneColor: Color {
    switch tone {
    case "on": return good
    case "under": return amber
    case "over": return over
    default: return .white
    }
  }

  static func date(_ s: Double?) -> Date? { s.map { Date(timeIntervalSince1970: $0) } }
  var intervalEndDate: Date? { Self.date(intervalEnd) }
  var rideEndDate: Date? { Self.date(rideEnd) }
  var startedDate: Date? { Self.date(started) }
}

func clock(_ seconds: Double) -> String {
  let s = max(0, Int(seconds))
  return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
}

/// A countdown to `end` while riding, or the seconds left standing still.
struct Countdown: View {
  let end: Date?
  let left: Double

  var body: some View {
    if let end, end > Date() {
      Text(timerInterval: Date()...end, countsDown: true).monospacedDigit()
    } else {
      Text(clock(end == nil ? left : 0)).monospacedDigit()
    }
  }
}

/// Free ERG's clock, counting up from the ride's start.
struct Elapsed: View {
  let state: RideState

  var body: some View {
    if let start = state.startedDate {
      Text(timerInterval: start...Date.distantFuture, countsDown: false).monospacedDigit()
    } else {
      Text(clock(state.elapsed)).monospacedDigit()
    }
  }
}

struct ZoneSquare: View {
  let step: Int?
  var size: CGFloat = 10

  var body: some View {
    RoundedRectangle(cornerRadius: size / 3.5).fill(ZoneColor.of(step)).frame(width: size, height: size)
  }
}

/// The whole workout in zone colors, with a mark where you are.
struct WorkoutBar: View {
  let state: RideState
  var height: CGFloat = 12

  var body: some View {
    GeometryReader { g in
      let gaps = CGFloat(max(state.bar.count - 1, 0))
      let width = max(g.size.width - gaps, 0)
      ZStack(alignment: .leading) {
        HStack(spacing: 1) {
          ForEach(Array(state.bar.enumerated()), id: \.offset) { _, b in
            Rectangle().fill(b.step == 0 ? Color.white.opacity(0.2) : ZoneColor.of(b.step)).frame(width: max(width * b.share, 1))
          }
        }
        .clipShape(RoundedRectangle(cornerRadius: 3))
        RoundedRectangle(cornerRadius: 1)
          .fill(Color.white)
          .frame(width: 2, height: height + 6)
          .offset(x: min(max(g.size.width * state.at - 1, 0), g.size.width - 2))
      }
      .frame(height: height + 6)
    }
    .frame(height: height + 6)
  }
}

struct Brand: View {
  let title: String

  var body: some View {
    HStack(spacing: 6) {
      Text("L").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
        .frame(width: 16, height: 16).background(brand, in: RoundedRectangle(cornerRadius: 4))
      Text(title).font(.caption).foregroundStyle(.white.opacity(0.85)).lineLimit(1)
    }
  }
}

/// Power against target, heart rate and cadence; nothing once a computer ride's numbers are stale.
struct LiveNumbers: View {
  let state: RideState
  let stale: Bool

  var body: some View {
    if state.riding, !stale {
      HStack(spacing: 12) {
        if let hr = state.heartRate { Label("\(hr)", systemImage: "heart.fill").labelStyle(Tight()) }
        if let rpm = state.cadence { Text("\(rpm) rpm") }
      }
      .font(.footnote).monospacedDigit().foregroundStyle(.white.opacity(0.85))
    }
  }
}

struct Tight: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 3) { configuration.icon.font(.caption2); configuration.title }
  }
}

// MARK: - Lock screen

struct RideLockScreen: View {
  let state: RideState
  let stale: Bool

  var corner: String {
    switch state.phase {
    case "ready": return state.place ?? "Ready"
    case "paused": return "Paused"
    case "done": return "Done"
    default: return state.counter.map { s in state.place.map { "\(s) · \($0)" } ?? s } ?? (state.place ?? "")
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Brand(title: state.title)
        Spacer(minLength: 8)
        Text(corner).font(.caption).foregroundStyle(state.phase == "paused" ? amber : dim).lineLimit(1)
      }
      switch state.phase {
      case "ready": ready
      case "done": done
      default: state.free ? AnyView(freeErg) : AnyView(workout)
      }
    }
    .foregroundStyle(.white)
    .padding(16)
  }

  var ready: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text("Pedal to start").font(.headline)
      if let note = state.note { Text(note).font(.footnote).foregroundStyle(dim).monospacedDigit() }
    }
  }

  var done: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text("Workout done").font(.headline)
      Text([state.note, "Tap to extend or end"].compactMap { $0 }.joined(separator: " · ")).font(.footnote).foregroundStyle(dim).monospacedDigit()
    }
  }

  var workout: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .bottom) {
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 6) {
            ZoneSquare(step: state.step)
            Text(state.interval ?? "").font(.subheadline.weight(.semibold)).lineLimit(1)
          }
          Countdown(end: state.intervalEndDate, left: state.intervalLeft)
            .font(.system(size: 40, weight: .semibold)).opacity(state.riding ? 1 : 0.6)
          Text(state.riding ? "left in interval" : "Pedal to carry on").font(.caption).foregroundStyle(dim)
        }
        Spacer(minLength: 8)
        VStack(alignment: .trailing, spacing: 3) {
          if state.riding, !stale, let power = state.power {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
              Text("\(power)").font(.system(size: 30, weight: .semibold)).monospacedDigit().foregroundStyle(state.toneColor)
              Text("W").font(.subheadline.weight(.medium)).foregroundStyle(dim)
            }
          }
          if let target = state.target { Text(target.hasSuffix("W") ? "target \(target)" : target).font(.caption).foregroundStyle(dim) }
          LiveNumbers(state: state, stale: stale)
        }
      }
      if !state.bar.isEmpty { WorkoutBar(state: state) }
      HStack {
        Text(state.next.map { "Next: \($0)" } ?? "Last interval").lineLimit(1)
        Spacer(minLength: 8)
        HStack(spacing: 3) {
          Countdown(end: state.rideEndDate, left: state.rideLeft)
          Text("left")
        }
      }
      .font(.caption).foregroundStyle(.white.opacity(0.8)).monospacedDigit()
    }
  }

  var freeErg: some View {
    HStack(alignment: .bottom) {
      VStack(alignment: .leading, spacing: 2) {
        Text(state.target ?? "").font(.system(size: 40, weight: .semibold)).monospacedDigit()
        HStack(spacing: 4) {
          Text("target ·")
          Elapsed(state: state)
        }
        .font(.caption).foregroundStyle(dim)
      }
      Spacer(minLength: 8)
      VStack(alignment: .trailing, spacing: 3) {
        if state.riding, !stale, let power = state.power {
          HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text("\(power)").font(.system(size: 30, weight: .semibold)).monospacedDigit().foregroundStyle(state.toneColor)
            Text("W").font(.subheadline.weight(.medium)).foregroundStyle(dim)
          }
        }
        LiveNumbers(state: state, stale: stale)
      }
    }
  }
}

// MARK: - Dynamic Island

/// The compact island's left side: the zone and power (or the phase when there's no power to show).
struct CompactLeading: View {
  let state: RideState
  let stale: Bool

  var body: some View {
    HStack(spacing: 5) {
      ZoneSquare(step: state.step, size: 9)
      if state.riding, !stale, let power = state.power {
        Text("\(power) W").foregroundStyle(state.toneColor)
      } else if state.phase != "riding" {
        Text(state.phase == "done" ? "Done" : state.phase == "paused" ? "Paused" : "Ready").foregroundStyle(state.phase == "paused" ? amber : .white)
      }
    }
    .font(.caption.weight(.semibold)).monospacedDigit()
  }
}

/// The countdown the island keeps: the interval's, or free ERG's clock.
struct IslandClock: View {
  let state: RideState

  var body: some View {
    if state.phase == "done" {
      Image(systemName: "flag.checkered")
    } else if state.free {
      Elapsed(state: state)
    } else {
      Countdown(end: state.intervalEndDate, left: state.intervalLeft)
    }
  }
}

struct RideLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: LacticRideAttributes.self) { context in
      RideLockScreen(state: context.state, stale: context.isStale)
        .activityBackgroundTint(Color(white: 0.1).opacity(0.82))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      let state = context.state
      let stale = context.isStale
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 6) {
            ZoneSquare(step: state.step)
            Text(state.interval ?? state.title).font(.subheadline.weight(.semibold)).lineLimit(1)
          }
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          IslandClock(state: state).font(.title3.weight(.semibold)).monospacedDigit()
            .frame(maxWidth: 90, alignment: .trailing).padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
              if state.riding, !stale, let power = state.power {
                Text("\(power) W").font(.title3.weight(.semibold)).foregroundStyle(state.toneColor)
              }
              if let target = state.target { Text(state.riding && !stale && state.power != nil ? "/ \(target)" : target).font(.subheadline).foregroundStyle(dim) }
              Spacer(minLength: 8)
              LiveNumbers(state: state, stale: stale)
            }
            .monospacedDigit()
            if !state.bar.isEmpty { WorkoutBar(state: state, height: 6) }
            HStack {
              Text(state.phase == "done" ? "Workout done · tap to extend or end" : state.next.map { "Next: \($0)" } ?? state.note ?? "").lineLimit(1)
              Spacer(minLength: 8)
              if !state.free, state.phase != "done" {
                HStack(spacing: 3) {
                  Countdown(end: state.rideEndDate, left: state.rideLeft)
                  Text("left")
                }
              }
            }
            .font(.caption).foregroundStyle(.white.opacity(0.8)).monospacedDigit()
          }
          .padding(.horizontal, 4)
        }
      } compactLeading: {
        CompactLeading(state: state, stale: stale)
      } compactTrailing: {
        IslandClock(state: state).font(.caption.weight(.semibold)).monospacedDigit().frame(maxWidth: 52)
      } minimal: {
        IslandClock(state: state).font(.system(size: 11, weight: .bold)).monospacedDigit().minimumScaleFactor(0.6)
      }
      .keylineTint(ZoneColor.of(state.step))
    }
  }
}
