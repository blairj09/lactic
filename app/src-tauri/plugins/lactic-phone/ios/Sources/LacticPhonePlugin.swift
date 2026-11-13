// Lactic on the iPhone: Apple Health, and the link to the rider's computer.
//
// Health: reads sleep, HRV, resting heart rate, breathing, wrist temperature, heart rate, active
// energy, steps and VO2 max, and hands them over in the same column format the Lactic Shortcut
// saves (sleepStart / sleepEnd / sleepValue, hrvDate / hrvValue, ...), so the engine's
// health-import reads both the same way. Observer queries with background delivery wake the app
// when new sleep, HRV or resting heart rate lands; each wake reads the last few days, sends them
// straight to the computer when it can, and otherwise queues them for the app to import next
// time it opens. Rides go the other way, as cycling workouts.
//
// The computer: pairing stores the key from the computer's QR code in the iOS keychain. Every
// request is JSON sealed with AES-256-GCM under that key (nonce + ciphertext + tag, which is
// CryptoKit's combined layout and what the computer's phone.rs expects), posted over the local
// network, and the answer comes back sealed the same way.
//
// The end of a ride on the computer: a local notification with Extend and End buttons, scheduled
// by the remote for the workout's end (see RideEnd below). The buttons run in the background, so
// they work from the lock screen and an Apple Watch without opening the app.

import CryptoKit
import Foundation
import HealthKit
import Security
import SwiftRs
import Tauri
import UIKit
import UserNotifications
import WebKit

// MARK: - Arguments and answers

struct ReadArgs: Decodable {
  var days: Int?
}

struct AckArgs: Decodable {
  var ids: [String]
}

struct PairArgs: Decodable {
  let url: String
}

struct SendArgs: Decodable {
  let kind: String
  let body: JSONValue
  var timeout: Double?
}

struct RideEndArgs: Decodable {
  let key: String
  let inSeconds: Double
  let title: String
  let body: String
  let extendLabel: String
  let extendSeconds: Double
  let computer: String
  let workoutName: String
  let duration: Double
}

struct WorkoutArgs: Decodable {
  let id: String
  let name: String?
  /// Unix seconds.
  let start: Double
  let end: Double
  let indoor: Bool
  let kcal: Double?
  let distanceMeters: Double?
  /// [seconds from start, value] pairs.
  let heartRate: [[Double]]?
  let power: [[Double]]?
  let cadence: [[Double]]?
}

struct Status: Encodable {
  let healthAvailable: Bool
  let healthAsked: Bool
  let pending: Int
  let paired: PairedInfo?
}

struct PairedInfo: Encodable {
  let computer: String
  let deviceId: String
  let lastSentAt: Double?
}

struct Pending: Encodable {
  let id: String
  let body: JSONValue
}

struct WeighInArgs: Decodable {
  let id: String
  /// Unix seconds.
  let at: Double
  let kg: Double
  /// 0 to 100.
  let fatPercent: Double?
}

struct Saved: Encodable {
  let saved: Bool
  let reason: String?
}

struct Removed: Encodable {
  let removed: Int
}

struct HealthEvent: Encodable {
  let pending: String
}

struct Granted: Encodable {
  let granted: Bool
}

struct PairedAnswer: Encodable {
  let computer: String
}

extension JSONValue {
  subscript(_ key: String) -> JSONValue? {
    if case .object(let o) = self { return o[key] }
    return nil
  }
  var number: Double? {
    if case .number(let n) = self { return n }
    return nil
  }
  var flag: Bool? {
    if case .bool(let b) = self { return b }
    return nil
  }
  var text: String? {
    if case .string(let s) = self { return s }
    return nil
  }
}

// MARK: - Pairing, kept in the keychain

struct Pairing: Codable {
  var deviceId: String
  var key: String
  var hosts: [String]
  var port: Int
  var computer: String
  var lastHost: String?
  var lastSentAt: Double?
}

enum PairingStore {
  static let service = "fit.lactic.phone"
  static let account = "pairing"

  static func load() -> Pairing? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return try? JSONDecoder().decode(Pairing.self, from: data)
  }

  static func save(_ p: Pairing) {
    guard let data = try? JSONEncoder().encode(p) else { return }
    let base: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    let update: [String: Any] = [
      kSecValueData as String: data,
      // Background wakes come after the phone has been unlocked once.
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    if SecItemUpdate(base as CFDictionary, update as CFDictionary) == errSecItemNotFound {
      SecItemAdd(base.merging(update) { $1 } as CFDictionary, nil)
    }
  }

  static func clear() {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    SecItemDelete(query as CFDictionary)
  }
}

// MARK: - The link to the computer

enum Link {
  static func b64url(_ data: Data) -> String { Wire.b64url(data) }
  static func fromB64url(_ text: String) -> Data? { Wire.fromB64url(text) }

  /// The QR code's link: https://lactic.fit/pair#v=1&d=<device>&k=<key>&p=<port>&h=<host,host>&n=<name>
  static func parse(_ url: String) throws -> Pairing {
    guard let hash = url.split(separator: "#", maxSplits: 1).last, url.contains("#") else { throw LacticError("That isn't a Lactic pairing code") }
    var fields: [String: String] = [:]
    for part in hash.split(separator: "&") {
      let kv = part.split(separator: "=", maxSplits: 1).map(String.init)
      if kv.count == 2 { fields[kv[0]] = kv[1].removingPercentEncoding ?? kv[1] }
    }
    guard let d = fields["d"], let k = fields["k"], fromB64url(k)?.count == 32, let p = fields["p"].flatMap(Int.init) else {
      throw LacticError("That isn't a Lactic pairing code")
    }
    let hosts = (fields["h"] ?? "").split(separator: ",").map { String($0).removingPercentEncoding ?? String($0) }
    return Pairing(deviceId: d, key: k, hosts: hosts, port: p, computer: fields["n"] ?? "your computer", lastHost: nil, lastSentAt: nil)
  }

  /// The computer answered `{ok: false, error}`: it was reached, so the request ends there.
  struct ComputerSaid: Error {
    let message: String
  }

  /// Seals `kind` + `body`, sends it to the computer by the first way that works, and opens the reply.
  static func send(_ pairing: inout Pairing, kind: String, body: JSONValue, timeout: Double = 30) async throws -> JSONValue {
    guard let keyData = fromB64url(pairing.key) else { throw LacticError("The pairing key is damaged. Pair again.") }
    let key = SymmetricKey(data: keyData)
    let sealed = try Wire.request(kind: kind, body: body, key: key)

    let computer = pairing.computer
    /// The computer's answer, or a LacticError that ends the request (a wrong key, a refusal).
    func answer(status: Int, data: Data) throws -> JSONValue {
      if status == 401 { throw LacticError("\(computer) doesn't know this iPhone anymore. Pair again from Lactic's Settings on the computer.") }
      guard status == 200 else { throw LacticError("\(computer) answered \(status)") }
      let reply = try Wire.reply(data, key: key)
      if case .bool(true) = reply["ok"] ?? .null { return reply["body"] ?? .null }
      if case .string(let e) = reply["error"] ?? .null { throw ComputerSaid(message: e) }
      throw ComputerSaid(message: "\(computer) couldn't do that")
    }
    func overNetwork(_ host: String, timeout: Double) async throws -> JSONValue {
      let h = host.contains(":") ? "[\(host)]" : host
      guard let url = URL(string: "http://\(h):\(pairing.port)/lactic/phone") else { throw URLError(.badURL) }
      var req = URLRequest(url: url)
      req.httpMethod = "POST"
      req.httpBody = sealed
      req.timeoutInterval = timeout
      req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
      req.setValue(pairing.deviceId, forHTTPHeaderField: "X-Lactic-Device")
      let (data, response) = try await URLSession.shared.data(for: req)
      return try answer(status: (response as? HTTPURLResponse)?.statusCode ?? 0, data: data)
    }
    let headers = ["Content-Type": "application/octet-stream", "X-Lactic-Device": pairing.deviceId]

    var lastError: Error = LacticError("Can't reach \(computer). Is Lactic open on it, nearby?")
    // 1. Where it answered last time, quickly.
    if let last = pairing.lastHost, last != Direct.tag, pairing.hosts.contains(last) {
      do {
        let v = try await overNetwork(last, timeout: min(timeout, 4))
        pairing.lastSentAt = Date().timeIntervalSince1970 * 1000
        return v
      } catch let e as ComputerSaid { pairing.lastSentAt = Date().timeIntervalSince1970 * 1000; throw LacticError(e.message) }
      catch let e as LacticError { throw e }
      catch { lastError = error }
    }
    // 2. Directly, found by Bonjour: over the network when they share one, otherwise over
    //    peer-to-peer Wi-Fi the way AirDrop works. A computer that doesn't know this iPhone (401)
    //    is someone else's: try the next.
    let found = await Direct.candidates(within: 2)
    for endpoint in found {
      do {
        let (status, data) = try await Direct.post(to: endpoint, path: "/lactic/phone", body: sealed, headers: headers, timeout: timeout)
        if status == 401 { lastError = LacticError("\(computer) doesn't know this iPhone anymore. Pair again from Lactic's Settings on the computer."); continue }
        let v = try answer(status: status, data: data)
        Direct.remember(endpoint)
        pairing.lastHost = Direct.tag
        pairing.lastSentAt = Date().timeIntervalSince1970 * 1000
        return v
      } catch let e as ComputerSaid {
        Direct.remember(endpoint)
        pairing.lastHost = Direct.tag
        throw LacticError(e.message)
      } catch let e as LacticError {
        lastError = e
      } catch {
        continue  // Not reachable this way: the next, then the listed addresses.
      }
    }
    // 3. Every address the pairing code listed.
    for host in pairing.hosts where host != pairing.lastHost {
      do {
        let v = try await overNetwork(host, timeout: timeout)
        pairing.lastHost = host
        pairing.lastSentAt = Date().timeIntervalSince1970 * 1000
        return v
      } catch let e as ComputerSaid {
        pairing.lastHost = host
        throw LacticError(e.message)
      } catch let e as LacticError {
        throw e
      } catch {
        lastError = error  // Not at this address: try the next.
      }
    }
    // 4. Through iCloud: only sync, which is safe to answer late or twice.
    if kind == "sync" {
      if let data = try await Mailbox.exchange(device: pairing.deviceId, sealed: sealed, wait: min(timeout, 45)) {
        pairing.lastSentAt = Date().timeIntervalSince1970 * 1000
        do { return try answer(status: 200, data: data) } catch let e as ComputerSaid { throw LacticError(e.message) }
      }
      if Mailbox.folder(device: pairing.deviceId) != nil {
        throw LacticError("Can't reach \(computer) directly, so this sync went through iCloud. It finishes when Lactic is open on \(computer).")
      }
    }
    // Nothing answered anywhere: say where it looked, which is what checking the network needs.
    if lastError is URLError {
      let tried = pairing.hosts.joined(separator: ", ")
      if let mine = wifiNetwork(), !pairing.hosts.contains(where: { mine.holds($0) }), pairing.hosts.contains(where: { ipv4($0) != nil }) {
        throw LacticError("This iPhone and \(pairing.computer) are on different networks: the iPhone is \(mine.address), the computer is \(tried). Join the iPhone to the same Wi-Fi as the computer (often two routers each make their own network), then try again.")
      }
      throw LacticError("Can't reach \(pairing.computer) (tried \(tried), port \(pairing.port), and nearby). Check that Lactic is open on it, Wi-Fi is on for both, and the computer's firewall lets Lactic accept connections.")
    }
    throw lastError
  }
}

// MARK: - Apple Health

enum Health {
  static let store = HKHealthStore()

  static let readTypes: Set<HKObjectType> = {
    var t: Set<HKObjectType> = [
      HKCategoryType(.sleepAnalysis),
      HKQuantityType(.heartRateVariabilitySDNN),
      HKQuantityType(.restingHeartRate),
      HKQuantityType(.respiratoryRate),
      HKQuantityType(.appleSleepingWristTemperature),
      HKQuantityType(.heartRate),
      HKQuantityType(.activeEnergyBurned),
      HKQuantityType(.stepCount),
      HKQuantityType(.vo2Max),
      HKQuantityType(.bodyMass),
      HKQuantityType(.bodyFatPercentage),
      HKObjectType.workoutType(),
    ]
    t.insert(HKQuantityType(.distanceCycling))
    return t
  }()

  static let writeTypes: Set<HKSampleType> = {
    var t: Set<HKSampleType> = [
      HKObjectType.workoutType(),
      HKQuantityType(.activeEnergyBurned),
      HKQuantityType(.distanceCycling),
      HKQuantityType(.heartRate),
      HKQuantityType(.bodyMass),
      HKQuantityType(.bodyFatPercentage),
    ]
    if #available(iOS 17.0, *) {
      t.insert(HKQuantityType(.cyclingPower))
      t.insert(HKQuantityType(.cyclingCadence))
    }
    return t
  }()

  /// Types whose arrival wakes the app: the ones a recovery score needs.
  static let wakeTypes: [HKSampleType] = [HKCategoryType(.sleepAnalysis), HKQuantityType(.heartRateVariabilitySDNN), HKQuantityType(.restingHeartRate)]

  static let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    f.timeZone = .current
    return f
  }()

  static func samples(_ type: HKSampleType, since: Date) async throws -> [HKSample] {
    try await withCheckedThrowingContinuation { cont in
      let predicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: [])
      let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
      let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, results, error in
        if let error = error as? HKError, error.code == .errorNoData { cont.resume(returning: []) }
        else if let error { cont.resume(throwing: error) }
        else { cont.resume(returning: results ?? []) }
      }
      store.execute(q)
    }
  }

  /// One total per local day (active energy, steps).
  static func dailySums(_ type: HKQuantityType, unit: HKUnit, since: Date) async throws -> [(Date, Double)] {
    try await withCheckedThrowingContinuation { cont in
      let start = Calendar.current.startOfDay(for: since)
      let q = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: nil), options: .cumulativeSum, anchorDate: start, intervalComponents: DateComponents(day: 1))
      q.initialResultsHandler = { _, collection, error in
        if let error = error as? HKError, error.code == .errorNoData { return cont.resume(returning: []) }
        if let error { return cont.resume(throwing: error) }
        var out: [(Date, Double)] = []
        collection?.enumerateStatistics(from: start, to: Date()) { s, _ in
          if let sum = s.sumQuantity() { out.append((s.startDate, sum.doubleValue(for: unit))) }
        }
        cont.resume(returning: out)
      }
      store.execute(q)
    }
  }

  static func sleepValue(_ v: Int) -> String {
    switch v {
    case 0: return "In Bed"
    case 2: return "Awake"
    case 3: return "Core"
    case 4: return "Deep"
    case 5: return "REM"
    default: return "Asleep"
    }
  }

  /// The last `days` days, as the Shortcut's columns. Heart rate (a lot of samples) is capped at 14 days.
  /// Starts at noon the day before, never partway through a night: a read that began at, say, 7am
  /// three days back saw only the last minutes of that night, and that slice read as a short night.
  static func read(days: Int) async throws -> JSONValue {
    let cal = Calendar.current
    let since = cal.date(byAdding: .hour, value: -12, to: cal.startOfDay(for: Date().addingTimeInterval(-Double(days) * 86_400)))!
    let hrSince = Date().addingTimeInterval(-Double(min(days, 14)) * 86_400)
    var body: [String: JSONValue] = ["hrvKind": .string("sdnn"), "source": .string("healthkit")]
    func put(_ key: String, _ values: [String]) { body[key] = .array(values.map { .string($0) }) }
    func quantities(_ id: HKQuantityTypeIdentifier, _ unit: HKUnit, from: Date, date: String, value: String, end: String? = nil) async throws {
      let list = try await samples(HKQuantityType(id), since: from).compactMap { $0 as? HKQuantitySample }
      put(date, list.map { iso.string(from: $0.startDate) })
      if let end { put(end, list.map { iso.string(from: $0.endDate) }) }
      put(value, list.map { String($0.quantity.doubleValue(for: unit)) })
    }

    let sleep = try await samples(HKCategoryType(.sleepAnalysis), since: since).compactMap { $0 as? HKCategorySample }
    put("sleepStart", sleep.map { iso.string(from: $0.startDate) })
    put("sleepEnd", sleep.map { iso.string(from: $0.endDate) })
    put("sleepValue", sleep.map { sleepValue($0.value) })
    let perMinute = HKUnit.count().unitDivided(by: .minute())
    try await quantities(.heartRateVariabilitySDNN, .secondUnit(with: .milli), from: since, date: "hrvDate", value: "hrvValue")
    try await quantities(.restingHeartRate, perMinute, from: since, date: "restingHrDate", value: "restingHrValue")
    try await quantities(.respiratoryRate, perMinute, from: since, date: "respRateDate", value: "respRateValue")
    try await quantities(.appleSleepingWristTemperature, .degreeCelsius(), from: since, date: "wristTempStart", value: "wristTempValue", end: "wristTempEnd")
    try await quantities(.heartRate, perMinute, from: hrSince, date: "heartRateDate", value: "heartRateValue")
    try await quantities(.vo2Max, HKUnit(from: "ml/kg*min"), from: since, date: "vo2maxDate", value: "vo2maxValue")
    // Weigh-ins from other scales and apps; Lactic's own (written below) are left out so they don't come back.
    func others(_ id: HKQuantityTypeIdentifier, _ unit: HKUnit, date: String, value: String) async throws {
      let list = try await samples(HKQuantityType(id), since: since).compactMap { $0 as? HKQuantitySample }.filter { !fromLactic($0) }
      put(date, list.map { iso.string(from: $0.startDate) })
      put(value, list.map { String($0.quantity.doubleValue(for: unit)) })
    }
    try await others(.bodyMass, .gramUnit(with: .kilo), date: "weightDate", value: "weightValue")
    try await others(.bodyFatPercentage, .percent(), date: "bodyFatDate", value: "bodyFatValue")
    let energy = try await dailySums(HKQuantityType(.activeEnergyBurned), unit: .kilocalorie(), since: since)
    put("activeEnergyDate", energy.map { iso.string(from: $0.0) })
    put("activeEnergyValue", energy.map { String($0.1) })
    let steps = try await dailySums(HKQuantityType(.stepCount), unit: .count(), since: since)
    put("stepsDate", steps.map { iso.string(from: $0.0) })
    put("stepsValue", steps.map { String($0.1) })
    return .object(body)
  }

  /// Written by this app (a weigh-in made in Lactic).
  static func fromLactic(_ sample: HKSample) -> Bool {
    if sample.sourceRevision.source.bundleIdentifier == Bundle.main.bundleIdentifier { return true }
    return (sample.metadata?[HKMetadataKeyExternalUUID] as? String)?.hasPrefix("lactic:") ?? false
  }

  // MARK: Weigh-ins into Health

  static func saveWeighIn(_ w: WeighInArgs) async throws -> Saved {
    let at = Date(timeIntervalSince1970: w.at)
    let uuid = "lactic:\(w.id)"
    let near = try await samples(HKQuantityType(.bodyMass), since: at.addingTimeInterval(-3600))
      .compactMap { $0 as? HKQuantitySample }
      .filter { abs($0.startDate.timeIntervalSince(at)) < 3600 }
    if near.contains(where: { ($0.metadata?[HKMetadataKeyExternalUUID] as? String) == uuid }) {
      return Saved(saved: false, reason: "already saved")
    }
    // The scale wrote it to Health itself (or another app did): within ten minutes is the same weigh-in.
    if let other = near.first(where: { abs($0.startDate.timeIntervalSince(at)) < 600 }) {
      return Saved(saved: false, reason: "already in Health from \(other.sourceRevision.source.name)")
    }
    let metadata: [String: Any] = [HKMetadataKeyExternalUUID: uuid]
    var list: [HKSample] = [HKQuantitySample(type: HKQuantityType(.bodyMass), quantity: HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: w.kg), start: at, end: at, metadata: metadata)]
    if let fat = w.fatPercent, fat > 0, fat < 80 {
      list.append(HKQuantitySample(type: HKQuantityType(.bodyFatPercentage), quantity: HKQuantity(unit: .percent(), doubleValue: fat / 100), start: at, end: at, metadata: metadata))
    }
    try await store.save(list)
    return Saved(saved: true, reason: nil)
  }

  // MARK: Rides into Health

  private static let saveLock = NSLock()
  private static var lastSave: Task<Saved, Error>?

  /// Saves one workout at a time, so the "already in Health?" check always sees the one before.
  /// Two saves of the same ride side by side both found nothing and both wrote it.
  static func lastSaveDone() async {
    saveLock.lock()
    let last = lastSave
    saveLock.unlock()
    _ = await last?.result
  }

  static func saveInTurn(_ w: WorkoutArgs) async throws -> Saved {
    saveLock.lock()
    let before = lastSave
    let task = Task { () throws -> Saved in
      _ = await before?.result
      return try await save(w)
    }
    lastSave = task
    saveLock.unlock()
    return try await task.value
  }

  /// Deletes the extra copies of rides Lactic saved more than once (two saves used to race), with
  /// the heart rate, power and other samples saved with each copy. Keeps one copy of each ride and
  /// only ever touches workouts this app wrote that carry a Lactic ride id.
  static func removeDuplicates(days: Double) async throws -> Removed {
    let since = Date().addingTimeInterval(-days * 86_400)
    let mine = try await samples(HKObjectType.workoutType(), since: since)
      .compactMap { $0 as? HKWorkout }
      .filter { $0.sourceRevision.source.bundleIdentifier == HKSource.default().bundleIdentifier }
    var seen = Set<String>()
    var extra: [HKWorkout] = []
    for w in mine {
      guard let id = w.metadata?[HKMetadataKeyExternalUUID] as? String else { continue }
      if seen.contains(id) { extra.append(w) } else { seen.insert(id) }
    }
    if extra.isEmpty { return Removed(removed: 0) }
    var types: [HKSampleType] = [
      HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned), HKQuantityType(.distanceCycling),
    ]
    if #available(iOS 17.0, *) {
      types += [HKQuantityType(.cyclingPower), HKQuantityType(.cyclingCadence)]
    }
    for w in extra {
      for type in types {
        _ = try await store.deleteObjects(of: type, predicate: HKQuery.predicateForObjects(from: w))
      }
      try await store.delete(w)
    }
    return Removed(removed: extra.count)
  }

  static func save(_ w: WorkoutArgs) async throws -> Saved {
    let start = Date(timeIntervalSince1970: w.start)
    let end = Date(timeIntervalSince1970: w.end)
    // Already there: written by Lactic before, or by Zwift, a bike computer or a watch.
    let overlapping = try await samples(HKObjectType.workoutType(), since: start.addingTimeInterval(-6 * 3600))
      .compactMap { $0 as? HKWorkout }
      .filter { $0.startDate < end && $0.endDate > start }
    if overlapping.contains(where: { ($0.metadata?[HKMetadataKeyExternalUUID] as? String) == w.id }) {
      return Saved(saved: false, reason: "already saved")
    }
    let span = end.timeIntervalSince(start)
    if let other = overlapping.first(where: { min($0.endDate, end).timeIntervalSince(max($0.startDate, start)) > span * 0.5 }) {
      return Saved(saved: false, reason: "already in Health from \(other.sourceRevision.source.name)")
    }

    let config = HKWorkoutConfiguration()
    config.activityType = .cycling
    config.locationType = w.indoor ? .indoor : .outdoor
    let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())
    try await builder.beginCollection(at: start)
    var samples: [HKSample] = []
    if let kcal = w.kcal, kcal > 0 {
      samples.append(HKQuantitySample(type: HKQuantityType(.activeEnergyBurned), quantity: HKQuantity(unit: .kilocalorie(), doubleValue: kcal), start: start, end: end))
    }
    if let m = w.distanceMeters, m > 0 {
      samples.append(HKQuantitySample(type: HKQuantityType(.distanceCycling), quantity: HKQuantity(unit: .meter(), doubleValue: m), start: start, end: end))
    }
    func points(_ list: [[Double]]?, _ type: HKQuantityType, _ unit: HKUnit) {
      for p in list ?? [] where p.count == 2 && p[1] > 0 {
        let at = start.addingTimeInterval(p[0])
        if at > end { break }
        samples.append(HKQuantitySample(type: type, quantity: HKQuantity(unit: unit, doubleValue: p[1]), start: at, end: at))
      }
    }
    points(w.heartRate, HKQuantityType(.heartRate), HKUnit.count().unitDivided(by: .minute()))
    if #available(iOS 17.0, *) {
      points(w.power, HKQuantityType(.cyclingPower), .watt())
      points(w.cadence, HKQuantityType(.cyclingCadence), HKUnit.count().unitDivided(by: .minute()))
    }
    if !samples.isEmpty { try await builder.addSamples(samples) }
    var metadata: [String: Any] = [HKMetadataKeyExternalUUID: w.id, HKMetadataKeyIndoorWorkout: w.indoor]
    if let name = w.name, !name.isEmpty { metadata["LacticName"] = name }
    try await builder.addMetadata(metadata)
    try await builder.endCollection(at: end)
    _ = try await builder.finishWorkout()
    return Saved(saved: true, reason: nil)
  }
}

// MARK: - Bodies waiting for the app

enum Queue {
  static var dir: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let d = base.appendingPathComponent("lactic-phone/pending", isDirectory: true)
    try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
    return d
  }

  static func add(_ body: JSONValue) -> String {
    let id = "\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8))"
    if let data = try? JSONEncoder().encode(body) {
      try? data.write(to: dir.appendingPathComponent("\(id).json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    // Only the newest few matter: each one holds the last three days.
    let all = list()
    for old in all.dropLast(20) { remove(old) }
    return id
  }

  static func list() -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter { $0.hasSuffix(".json") }.map { String($0.dropLast(5)) }.sorted()
  }

  static func read(_ id: String) -> JSONValue? {
    guard let data = try? Data(contentsOf: dir.appendingPathComponent("\(id).json")) else { return nil }
    return try? JSONDecoder().decode(JSONValue.self, from: data)
  }

  static func remove(_ id: String) {
    try? FileManager.default.removeItem(at: dir.appendingPathComponent("\(id).json"))
  }
}

// MARK: - The ride-end notification

/// The notification at the end of a workout running on the computer. One at a time: each schedule
/// replaces the last. UserDefaults keeps which end it's for and when it goes off, so the remote
/// seeing the finished workout after it went off doesn't send it twice.
final class RideEnd: NSObject, UNUserNotificationCenterDelegate {
  static let shared = RideEnd()
  static let id = "lactic.ride-end"
  static let category = "lactic.ride-end"
  static let extendAction = "extend"
  static let endAction = "end"
  static let keyPref = "lactic.rideEnd.key"
  static let atPref = "lactic.rideEnd.at"

  let center = UNUserNotificationCenter.current()

  /// Before the app finishes launching, so a button pressed while it wasn't running still lands here.
  func start() {
    center.delegate = self
  }

  func allowed() async -> Bool {
    let settings = await center.notificationSettings()
    switch settings.authorizationStatus {
    case .notDetermined: return (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
    case .authorized, .provisional, .ephemeral: return true
    default: return false
    }
  }

  func setCategory(extendLabel: String) {
    let extend = UNNotificationAction(identifier: Self.extendAction, title: extendLabel, options: [])
    let end = UNNotificationAction(identifier: Self.endAction, title: "End ride", options: [.destructive])
    center.setNotificationCategories([UNNotificationCategory(identifier: Self.category, actions: [extend, end], intentIdentifiers: [], options: [])])
  }

  func schedule(_ a: RideEndArgs) async {
    let now = Date().timeIntervalSince1970
    let at = now + max(0, a.inSeconds)
    let d = UserDefaults.standard
    if d.string(forKey: Self.keyPref) == a.key {
      let was = d.double(forKey: Self.atPref)
      // Already went off for this end, or still set for (about) the same moment.
      if was <= now || abs(was - at) < 2 { return }
    }
    guard await allowed() else { return }
    setCategory(extendLabel: a.extendLabel)
    let content = UNMutableNotificationContent()
    content.title = a.title
    content.body = a.body
    content.sound = .default
    content.categoryIdentifier = Self.category
    content.interruptionLevel = .active
    content.userInfo = [
      "title": a.title, "body": a.body, "extendLabel": a.extendLabel, "extendSeconds": a.extendSeconds,
      "computer": a.computer, "workoutName": a.workoutName, "duration": a.duration,
    ]
    let trigger = a.inSeconds >= 1 ? UNTimeIntervalNotificationTrigger(timeInterval: a.inSeconds, repeats: false) : nil
    do {
      try await center.add(UNNotificationRequest(identifier: Self.id, content: content, trigger: trigger))
      d.set(a.key, forKey: Self.keyPref)
      d.set(at, forKey: Self.atPref)
    } catch {}
  }

  /// No end to tell about (paused, ended, the computer's Ride page closed): drop it, and take an
  /// early one that went off while paused off the lock screen too.
  func cancel() {
    center.removePendingNotificationRequests(withIdentifiers: [Self.id])
    center.removeDeliveredNotifications(withIdentifiers: [Self.id])
    UserDefaults.standard.removeObject(forKey: Self.keyPref)
    UserDefaults.standard.removeObject(forKey: Self.atPref)
  }

  // Open: still show it, with its sound (the remote opens on the Extend panel as well).
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done(notification.request.identifier == Self.id ? [.banner, .list, .sound] : [.banner, .list])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
    let action = response.actionIdentifier
    guard action == Self.extendAction || action == Self.endAction else { return done() }
    let info = response.notification.request.content.userInfo
    Task {
      await self.press(action, info: info)
      done()
    }
  }

  /// Runs Extend or End on the computer, as the remote's buttons do. Extend only counts there if
  /// the workout really is at its end, and then the next end is scheduled from the answer.
  func press(_ action: String, info: [AnyHashable: Any]) async {
    let computer = info["computer"] as? String ?? "your computer"
    guard var pairing = PairingStore.load() else { return }
    let extend = action == Self.extendAction
    let control: JSONValue = .object(["name": .string(extend ? "onExtend" : "onEnd"), "args": .array([])])
    let reply: JSONValue
    do {
      reply = try await Link.send(&pairing, kind: "ride", body: .object(["control": control, "whenFinished": .bool(extend)]), timeout: 15)
      PairingStore.save(pairing)
    } catch {
      await failed(extend ? "Extend" : "End ride", computer: computer)
      return
    }
    cancel()
    guard extend, let data = reply["ride"]?["data"] else { return }
    let name = data["workout"]?["name"]?.text ?? info["workoutName"] as? String ?? "Workout"
    let duration = data["duration"]?.number ?? 0
    let position = data["position"]?.number ?? 0
    let extendSeconds = info["extendSeconds"] as? Double ?? 300
    let next: (key: String, inSeconds: Double)
    if data["running"]?.flag == true, duration > position {
      next = ("\(name)|\(Int(duration.rounded()))", duration - position)
    } else if data["finished"]?.flag == true {
      // Not under way yet in the answer: the longer workout ends about Extend's length from now.
      next = ("\(name)|\(Int((duration + extendSeconds).rounded()))", extendSeconds)
    } else {
      return
    }
    await schedule(RideEndArgs(
      key: next.key, inSeconds: next.inSeconds, title: info["title"] as? String ?? "Workout done",
      body: info["body"] as? String ?? "\(name) on \(computer). Extend it or end the ride.",
      extendLabel: info["extendLabel"] as? String ?? "Extend", extendSeconds: extendSeconds,
      computer: computer, workoutName: name, duration: duration))
  }

  func failed(_ what: String, computer: String) async {
    let content = UNMutableNotificationContent()
    content.title = "Couldn't reach \(computer)"
    content.body = "\(what) didn't go through. Open Lactic to try again, or use the controls on \(computer)."
    content.sound = .default
    try? await center.add(UNNotificationRequest(identifier: "lactic.ride-end.failed", content: content, trigger: nil))
  }
}

// MARK: - The plugin

class LacticPhonePlugin: Plugin {
  static let askedKey = "lactic.health.asked"
  var observers: [HKObserverQuery] = []

  override init() {
    super.init()
    RideEnd.shared.start()
    WatchLink.shared.start()
    // Every launch, including the ones iOS makes in the background for new Health data.
    if UserDefaults.standard.bool(forKey: Self.askedKey) { watch() }
  }

  func watch() {
    guard HKHealthStore.isHealthDataAvailable(), observers.isEmpty else { return }
    for type in Health.wakeTypes {
      let q = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, done, error in
        guard error == nil else { return done() }
        Task {
          await self?.woke()
          done()
        }
      }
      observers.append(q)
      Health.store.execute(q)
      Health.store.enableBackgroundDelivery(for: type, frequency: .immediate) { _, _ in }
    }
  }

  /// New Health data: read the last three days, send them to the computer, keep them for the app.
  func woke() async {
    guard let body = try? await Health.read(days: 3) else { return }
    let id = Queue.add(body)
    if var pairing = PairingStore.load(), (try? await Link.send(&pairing, kind: "health", body: body, timeout: 20)) != nil {
      PairingStore.save(pairing)
    }
    try? trigger("health", data: HealthEvent(pending: id))
  }

  @objc public func status(_ invoke: Invoke) throws {
    let p = PairingStore.load()
    invoke.resolve(Status(
      healthAvailable: HKHealthStore.isHealthDataAvailable(),
      healthAsked: UserDefaults.standard.bool(forKey: Self.askedKey),
      pending: Queue.list().count,
      paired: p.map { PairedInfo(computer: $0.computer, deviceId: $0.deviceId, lastSentAt: $0.lastSentAt) }))
  }

  @objc public func authorizeHealth(_ invoke: Invoke) throws {
    guard HKHealthStore.isHealthDataAvailable() else { return invoke.reject("Apple Health isn't available on this device") }
    Health.store.requestAuthorization(toShare: Health.writeTypes, read: Health.readTypes) { [weak self] ok, error in
      if let error { return invoke.reject(error.localizedDescription) }
      // iOS never says which types were allowed; reading shows what came through.
      UserDefaults.standard.set(true, forKey: Self.askedKey)
      DispatchQueue.main.async { self?.watch() }
      invoke.resolve(Granted(granted: ok))
    }
  }

  @objc public func readHealth(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ReadArgs.self)
    Task {
      do { invoke.resolve(try await Health.read(days: max(1, min(args.days ?? 3, 400)))) }
      catch { invoke.reject(error.localizedDescription) }
    }
  }

  @objc public func takePending(_ invoke: Invoke) throws {
    invoke.resolve(Queue.list().compactMap { id in Queue.read(id).map { Pending(id: id, body: $0) } })
  }

  @objc public func ackPending(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AckArgs.self)
    args.ids.forEach(Queue.remove)
    invoke.resolve()
  }

  @objc public func saveWorkout(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(WorkoutArgs.self)
    Task {
      do { invoke.resolve(try await Health.saveInTurn(args)) }
      catch { invoke.reject(error.localizedDescription) }
    }
  }

  @objc public func removeDuplicateWorkouts(_ invoke: Invoke) throws {
    Task {
      // After any save still finishing, so a ride part-way through saving isn't counted.
      _ = await Health.lastSaveDone()
      do { invoke.resolve(try await Health.removeDuplicates(days: 60)) }
      catch { invoke.reject(error.localizedDescription) }
    }
  }

  @objc public func saveWeighIn(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(WeighInArgs.self)
    Task {
      do { invoke.resolve(try await Health.saveWeighIn(args)) }
      catch { invoke.reject(error.localizedDescription) }
    }
  }

  @objc public func pair(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PairArgs.self)
    Task {
      do {
        var pairing = try Link.parse(args.url)
        // The code's key seals only this hello. With it goes a fresh public key; the computer
        // answers with its own and both keep the key they work out (Wire.pairingKey). An older
        // Lactic on the computer answers without one, and the code's key stays, as before.
        let mine = Curve25519.KeyAgreement.PrivateKey()
        let hello: JSONValue = .object(["name": .string(UIDevice.current.name), "pub": .string(Wire.b64url(mine.publicKey.rawRepresentation))])
        let reply = try await Link.send(&pairing, kind: "hello", body: hello, timeout: 8)
        if case .object(let o) = reply {
          if case .string(let name) = o["computer"] ?? .null { pairing.computer = name }
          if case .string(let theirs) = o["pub"] ?? .null {
            guard let theirKey = Wire.fromB64url(theirs), let code = Wire.fromB64url(pairing.key) else {
              throw LacticError("That code didn't work. Show a new one on the computer and scan again.")
            }
            pairing.key = Wire.b64url(try Wire.pairingKey(mine: mine, theirs: theirKey, code: code, deviceId: pairing.deviceId))
          }
        }
        PairingStore.save(pairing)
        invoke.resolve(PairedAnswer(computer: pairing.computer))
      } catch {
        invoke.reject(error.localizedDescription)
      }
    }
  }

  @objc public func unpair(_ invoke: Invoke) throws {
    PairingStore.clear()
    invoke.resolve()
  }

  @objc public func send(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SendArgs.self)
    Task {
      guard var pairing = PairingStore.load() else { return invoke.reject("This iPhone isn't paired with a computer yet") }
      do {
        let reply = try await Link.send(&pairing, kind: args.kind, body: args.body, timeout: args.timeout ?? 60)
        PairingStore.save(pairing)
        invoke.resolve(reply)
      } catch {
        invoke.reject(error.localizedDescription)
      }
    }
  }
}

extension LacticPhonePlugin {
  @objc public func scheduleRideEnd(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(RideEndArgs.self)
    Task {
      await RideEnd.shared.schedule(args)
      invoke.resolve()
    }
  }

  @objc public func cancelRideEnd(_ invoke: Invoke) throws {
    RideEnd.shared.cancel()
    invoke.resolve()
  }

  /// A ride is showing: no auto-lock until it isn't (the web view turns it off again when the ride ends, the screen closes or the app goes to the background).
  @objc public func keepAwake(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(KeepAwakeArgs.self)
    DispatchQueue.main.async {
      UIApplication.shared.isIdleTimerDisabled = args.on
      invoke.resolve()
    }
  }
}

struct KeepAwakeArgs: Decodable {
  let on: Bool
}

@_cdecl("init_plugin_lactic_phone")
func initPlugin() -> Plugin {
  return LacticPhonePlugin()
}

/// The iPhone's own Wi-Fi IPv4 address and netmask, to tell "different network" apart from "not answering".
struct WifiNetwork {
  let address: String
  let ip: UInt32
  let mask: UInt32
  func holds(_ host: String) -> Bool {
    guard let h = ipv4(host) else { return false }
    return h & mask == ip & mask
  }
}

func ipv4(_ s: String) -> UInt32? {
  var a = in_addr()
  guard inet_pton(AF_INET, s, &a) == 1 else { return nil }
  return UInt32(bigEndian: a.s_addr)
}

func wifiNetwork() -> WifiNetwork? {
  var list: UnsafeMutablePointer<ifaddrs>?
  guard getifaddrs(&list) == 0, let first = list else { return nil }
  defer { freeifaddrs(list) }
  for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
    let i = p.pointee
    guard String(cString: i.ifa_name) == "en0", let addr = i.ifa_addr, let mask = i.ifa_netmask,
      addr.pointee.sa_family == UInt8(AF_INET)
    else { continue }
    let ip = addr.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
    let m = mask.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
    let text = "\(ip >> 24).\((ip >> 16) & 255).\((ip >> 8) & 255).\(ip & 255)"
    return WifiNetwork(address: text, ip: ip, mask: m)
  }
  return nil
}
