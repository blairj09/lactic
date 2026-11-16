// Keeps the lock screen's Live Activity up to date during a ride on the paired computer. A locked
// iPhone runs no web view and hears nothing from the computer, so the activity used to stick on the
// interval it last saw. Now the computer's ride page also shows up as a small Bluetooth LE
// accessory (app/src-tauri/src/beacon.rs) that this stays connected to; iOS wakes Lactic for each
// of its nudges (bluetooth-central background mode), even locked. On a nudge this asks the computer
// for the ride over the usual encrypted link and hands iOS the Live Activity the computer worked
// out (src/ride/remote.ts `remoteActivity`). The nudge itself carries nothing.
//
// While Lactic is open on screen the web view keeps the activity current, so nudges are ignored
// then. A ride on this iPhone itself is never touched.

import CoreBluetooth
import Foundation
import UIKit

#if canImport(ActivityKit) && os(iOS)
import ActivityKit
#endif

final class RideBeacon: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  static let shared = RideBeacon()
  /// Must match beacon.rs.
  static let service = CBUUID(string: "D44E2015-D4BF-414E-AB02-E1A4C6ECA1DF")
  static let nudge = CBUUID(string: "A7AF9720-6D30-4445-8F6E-B895B2F87166")
  static let restoreId = "fit.lactic.ride-beacon"

  private var central: CBCentralManager?
  private var computer: CBPeripheral?
  private var fetching = false
  private var again = false
  /// The phase last shown from a wake, so a workout that was done lingers on the lock screen.
  private var lastPhase: String?

  /// Starts looking for the computer's beacon. At launch only once Bluetooth was allowed (so this
  /// never asks by itself at launch), and when the remote first shows the computer's ride.
  func start(askingAllowed: Bool) {
    DispatchQueue.main.async {
      guard self.central == nil, PairingStore.load() != nil else { return }
      if !askingAllowed, CBManager.authorization != .allowedAlways { return }
      self.central = CBCentralManager(delegate: self, queue: nil, options: [
        CBCentralManagerOptionRestoreIdentifierKey: Self.restoreId,
        CBCentralManagerOptionShowPowerAlertKey: false,
      ])
    }
  }

  /// Unpaired: stop listening.
  func stop() {
    DispatchQueue.main.async {
      if let c = self.central {
        c.stopScan()
        if let p = self.computer { c.cancelPeripheralConnection(p) }
      }
      self.computer = nil
      self.central = nil
    }
  }

  private func look(_ c: CBCentralManager) {
    guard c.state == .poweredOn, PairingStore.load() != nil else { return }
    if let p = computer, p.state == .connected || p.state == .connecting { return }
    // Already connected through iOS (a relaunch): pick it up; otherwise scan for it.
    if let p = c.retrieveConnectedPeripherals(withServices: [Self.service]).first {
      use(p, c)
      return
    }
    c.scanForPeripherals(withServices: [Self.service], options: nil)
  }

  private func use(_ p: CBPeripheral, _ c: CBCentralManager) {
    computer = p
    p.delegate = self
    c.stopScan()
    if p.state == .connected { p.discoverServices([Self.service]) } else { c.connect(p, options: nil) }
  }

  // MARK: CBCentralManagerDelegate

  func centralManagerDidUpdateState(_ c: CBCentralManager) {
    look(c)
  }

  func centralManager(_ c: CBCentralManager, willRestoreState dict: [String: Any]) {
    if let p = (dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral])?.first {
      computer = p
      p.delegate = self
    }
  }

  func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
    use(p, c)
  }

  func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
    p.discoverServices([Self.service])
  }

  func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
    computer = nil
    look(c)
  }

  func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
    // The computer's ride page closed (or it went out of range): one last look, so a ride that
    // ended doesn't stay on the lock screen, then wait for the beacon to come back.
    computer = nil
    refresh()
    look(c)
  }

  // MARK: CBPeripheralDelegate

  func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
    guard let s = p.services?.first(where: { $0.uuid == Self.service }) else { return }
    p.discoverCharacteristics([Self.nudge], for: s)
  }

  func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
    guard let ch = s.characteristics?.first(where: { $0.uuid == Self.nudge }) else { return }
    p.setNotifyValue(true, for: ch)
    refresh()
  }

  func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
    refresh()
  }

  // MARK: The Live Activity

  /// Asks the computer for its ride and shows it. One request at a time; a nudge that lands
  /// during one asks again straight after.
  func refresh() {
    DispatchQueue.main.async {
      // Open on screen: the web view's remote keeps the activity current.
      if UIApplication.shared.applicationState == .active { return }
      if self.fetching {
        self.again = true
        return
      }
      self.fetching = true
      self.again = false
      var task: UIBackgroundTaskIdentifier = .invalid
      task = UIApplication.shared.beginBackgroundTask(withName: "lactic.ride-activity") {
        UIApplication.shared.endBackgroundTask(task)
        task = .invalid
      }
      Task {
        await self.fetchAndShow()
        DispatchQueue.main.async {
          self.fetching = false
          if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
          if self.again { self.refresh() }
        }
      }
    }
  }

  private func fetchAndShow() async {
    #if canImport(ActivityKit) && os(iOS)
    guard #available(iOS 16.2, *) else { return }
    // A ride on this iPhone (its activity has no place): that's the phone's own, leave it be.
    if let mine = Activity<LacticRideAttributes>.activities.first, mine.content.state.place == nil { return }
    guard var pairing = PairingStore.load() else { return }
    let reply: JSONValue
    do {
      reply = try await Link.send(&pairing, kind: "ride", body: .object([:]), timeout: 4)
      PairingStore.save(pairing)
    } catch {
      return  // Out of reach: the countdowns keep ticking on what's there.
    }
    let ride = reply["ride"]
    guard case .object(var activity)? = reply["activity"] else {
      // No ride page any more, or the ride ended: take the activity away (a done workout lingers).
      var ended = false
      if case .object? = ride { ended = true }
      await RideActivity.end(linger: ended || lastPhase == "done")
      lastPhase = nil
      return
    }
    activity["place"] = .string("On \(pairing.computer)")
    guard let data = try? JSONEncoder().encode(JSONValue.object(activity)), let json = String(data: data, encoding: .utf8) else { return }
    lastPhase = activity["phase"]?.text
    try? await RideActivity.show(json)
    #endif
  }
}
