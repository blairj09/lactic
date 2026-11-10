// Lactic on the Apple Watch: last night's recovery and today's ride, as the iPhone app worded them.
// The iPhone sends each new snapshot over WatchConnectivity (plugins/lactic-phone/ios/Sources/
// Widgets.swift); this keeps it in the Watch's App Group for its Smart Stack widget and complications
// (Widgets.swift) and shows it. Nothing is worked out here.

import SwiftUI
import WatchConnectivity
import WatchKit
import WidgetKit

@main
struct LacticWatchApp: App {
  @WKApplicationDelegateAdaptor private var delegate: WatchDelegate
  @StateObject private var model = WatchModel.shared

  var body: some Scene {
    WindowGroup {
      RecoveryView(entry: model.entry)
    }
  }
}

/// Starts listening to the iPhone on every launch, including the background ones iOS makes to
/// deliver a new snapshot for the complications.
final class WatchDelegate: NSObject, WKApplicationDelegate {
  func applicationDidFinishLaunching() {
    _ = WatchModel.shared
  }

  func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
    for task in backgroundTasks {
      if let wc = task as? WKWatchConnectivityRefreshBackgroundTask {
        WatchModel.shared.hold(wc)
      } else {
        task.setTaskCompletedWithSnapshot(false)
      }
    }
  }
}

/// Receives snapshots from the iPhone and keeps the latest.
final class WatchModel: NSObject, ObservableObject, WCSessionDelegate {
  static let shared = WatchModel()
  @Published private(set) var entry: Entry

  override init() {
    let snapshot = Store.load()
    entry = Entry(date: Date(), snapshot: snapshot, current: snapshot.map { $0.day == Store.day(Date()) } ?? false)
    super.init()
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    }
  }

  func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
    if state == .activated { take(session.receivedApplicationContext) }
  }

  func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
    take(context)
  }

  /// The complication transfer, which wakes the Watch app in the background.
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
    take(userInfo)
  }

  private var held: [WKWatchConnectivityRefreshBackgroundTask] = []

  /// Keeps a background wake open until the snapshot it brought is in (or a few seconds pass).
  func hold(_ task: WKWatchConnectivityRefreshBackgroundTask) {
    DispatchQueue.main.async {
      self.held.append(task)
      DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.release(force: true) }
    }
  }

  private func release(force: Bool = false) {
    guard force || !WCSession.default.hasContentPending else { return }
    held.forEach { $0.setTaskCompletedWithSnapshot(false) }
    held.removeAll()
  }

  private func take(_ context: [String: Any]) {
    guard let json = context["widget"] as? String, let data = json.data(using: .utf8),
          let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data)
    else { return }
    if let url = Store.url { try? data.write(to: url, options: .atomic) }
    WidgetCenter.shared.reloadAllTimelines()
    let entry = Entry(date: Date(), snapshot: snapshot, current: snapshot.day == Store.day(Date()))
    DispatchQueue.main.async {
      self.entry = entry
      self.release()
    }
  }
}

struct RecoveryView: View {
  let entry: Entry

  var body: some View {
    let s = entry.current ? entry.snapshot : nil
    ScrollView {
      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 10) {
          Ring(score: s?.score, size: 56)
          VStack(alignment: .leading, spacing: 1) {
            Text("Recovery").font(.caption2).foregroundStyle(.secondary)
            Text(s?.recovery?.word ?? "–").font(.headline).lineLimit(1).minimumScaleFactor(0.7)
          }
        }
        if let s {
          if let signal = s.signal {
            Text(signal).font(.footnote).foregroundStyle(Palette.warning)
          } else if let reason = s.recovery?.reason {
            Text(reason).font(.footnote).foregroundStyle(.secondary)
          }
          ForEach(s.metrics) { m in
            HStack {
              Text(m.label).foregroundStyle(.secondary)
              Spacer()
              if m.concern { Circle().fill(Palette.warning).frame(width: 5, height: 5) }
              Text(m.value).monospacedDigit()
            }
            .font(.footnote)
          }
          Divider()
          VStack(alignment: .leading, spacing: 1) {
            Text(s.today.title).font(.footnote.weight(.semibold))
            if let detail = s.today.detail { Text(detail).font(.caption2).foregroundStyle(.secondary) }
          }
          if let exertion = s.exertion { ExertionBar(exertion: exertion) }
        } else {
          Text(entry.snapshot == nil ? "Open Lactic on your iPhone to set up recovery." : "Open Lactic on your iPhone to read last night.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}
