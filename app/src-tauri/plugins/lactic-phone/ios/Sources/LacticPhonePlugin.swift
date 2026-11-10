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

import CryptoKit
import Foundation
import HealthKit
import Security
import SwiftRs
import Tauri
import UIKit
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

struct Saved: Encodable {
  let saved: Bool
  let reason: String?
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

/// Any JSON, decoded from the web layer and passed through untouched.
enum JSONValue: Codable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() { self = .null }
    else if let b = try? c.decode(Bool.self) { self = .bool(b) }
    else if let n = try? c.decode(Double.self) { self = .number(n) }
    else if let s = try? c.decode(String.self) { self = .string(s) }
    else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
    else { self = .object(try c.decode([String: JSONValue].self)) }
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .bool(let b): try c.encode(b)
    case .number(let n): try c.encode(n)
    case .string(let s): try c.encode(s)
    case .array(let a): try c.encode(a)
    case .object(let o): try c.encode(o)
    }
  }
}

struct LacticError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
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
  static func b64url(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }

  static func fromB64url(_ text: String) -> Data? {
    var s = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while s.count % 4 != 0 { s += "=" }
    return Data(base64Encoded: s)
  }

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

  /// Seals `kind` + `body`, posts it to the first address that answers, and opens the reply.
  static func send(_ pairing: inout Pairing, kind: String, body: JSONValue, timeout: Double = 30) async throws -> JSONValue {
    guard let keyData = fromB64url(pairing.key) else { throw LacticError("The pairing key is damaged. Pair again.") }
    let key = SymmetricKey(data: keyData)
    let envelope: [String: JSONValue] = ["t": .number((Date().timeIntervalSince1970 * 1000).rounded()), "kind": .string(kind), "body": body]
    let plain = try JSONEncoder().encode(envelope)
    guard let sealed = try AES.GCM.seal(plain, using: key).combined else { throw LacticError("Couldn't seal the request") }

    var hosts = pairing.hosts
    if let last = pairing.lastHost, let i = hosts.firstIndex(of: last) {
      hosts.remove(at: i)
      hosts.insert(last, at: 0)
    }
    var lastError: Error = LacticError("Can't reach \(pairing.computer). Is Lactic open on it, on the same Wi-Fi?")
    for host in hosts {
      let h = host.contains(":") ? "[\(host)]" : host
      guard let url = URL(string: "http://\(h):\(pairing.port)/lactic/phone") else { continue }
      var req = URLRequest(url: url)
      req.httpMethod = "POST"
      req.httpBody = sealed
      req.timeoutInterval = timeout
      req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
      req.setValue(pairing.deviceId, forHTTPHeaderField: "X-Lactic-Device")
      do {
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw LacticError("\(pairing.computer) doesn't know this iPhone anymore. Pair again from Lactic's Settings on the computer.") }
        guard status == 200 else { throw LacticError("\(pairing.computer) answered \(status)") }
        let opened = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key)
        let reply = try JSONDecoder().decode([String: JSONValue].self, from: opened)
        pairing.lastHost = host
        pairing.lastSentAt = Date().timeIntervalSince1970 * 1000
        if case .bool(true) = reply["ok"] ?? .null { return reply["body"] ?? .null }
        if case .string(let e) = reply["error"] ?? .null { throw LacticError(e) }
        throw LacticError("\(pairing.computer) couldn't do that")
      } catch let e as LacticError {
        throw e
      } catch {
        lastError = error  // Not at this address: try the next.
      }
    }
    // Nothing answered anywhere: say where it looked, which is what checking the network needs.
    if lastError is URLError {
      let tried = pairing.hosts.joined(separator: ", ")
      if let mine = wifiNetwork(), !pairing.hosts.contains(where: { mine.holds($0) }), pairing.hosts.contains(where: { ipv4($0) != nil }) {
        throw LacticError("This iPhone and \(pairing.computer) are on different networks: the iPhone is \(mine.address), the computer is \(tried). Join the iPhone to the same Wi-Fi as the computer (often two routers each make their own network), then try again.")
      }
      throw LacticError("Can't reach \(pairing.computer) (tried \(tried), port \(pairing.port)). Check that Lactic is open on it, both are on the same Wi-Fi, and the computer's firewall lets Lactic accept connections.")
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
  static func read(days: Int) async throws -> JSONValue {
    let since = Date().addingTimeInterval(-Double(days) * 86_400)
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
    let energy = try await dailySums(HKQuantityType(.activeEnergyBurned), unit: .kilocalorie(), since: since)
    put("activeEnergyDate", energy.map { iso.string(from: $0.0) })
    put("activeEnergyValue", energy.map { String($0.1) })
    let steps = try await dailySums(HKQuantityType(.stepCount), unit: .count(), since: since)
    put("stepsDate", steps.map { iso.string(from: $0.0) })
    put("stepsValue", steps.map { String($0.1) })
    return .object(body)
  }

  // MARK: Rides into Health

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

// MARK: - The plugin

class LacticPhonePlugin: Plugin {
  static let askedKey = "lactic.health.asked"
  var observers: [HKObserverQuery] = []

  override init() {
    super.init()
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
      do { invoke.resolve(try await Health.save(args)) }
      catch { invoke.reject(error.localizedDescription) }
    }
  }

  @objc public func pair(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PairArgs.self)
    Task {
      do {
        var pairing = try Link.parse(args.url)
        let reply = try await Link.send(&pairing, kind: "hello", body: .object(["name": .string(UIDevice.current.name)]), timeout: 8)
        if case .object(let o) = reply, case .string(let name) = o["computer"] ?? .null { pairing.computer = name }
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
