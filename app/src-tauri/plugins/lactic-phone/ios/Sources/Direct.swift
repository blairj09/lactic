// The direct link to the computer, the way AirDrop works: the iPhone finds Lactic on a Mac nearby
// by Bonjour (`_lactic._tcp`) and connects over the network when the two share one, or otherwise
// straight over peer-to-peer Wi-Fi, so two routers, a guest network or no network at all don't
// stop it. The Mac side is phone.rs's `direct` module. Plain HTTP/1.1, one request a connection;
// what's inside is sealed exactly as over the network (Wire.swift).

import Foundation
import Network

enum Direct {
  static let service = "_lactic._tcp"
  /// What Pairing.lastHost holds when the direct link answered last.
  static let tag = "direct"

  private static let lock = NSLock()
  private static var last: NWEndpoint?

  static func remember(_ endpoint: NWEndpoint) {
    lock.lock()
    last = endpoint
    lock.unlock()
  }

  /// The computer that answered last first (no wait), then whatever Bonjour finds within `seconds`.
  static func candidates(within seconds: Double) async -> [NWEndpoint] {
    lock.lock()
    let known = last
    lock.unlock()
    var out: [NWEndpoint] = known.map { [$0] } ?? []
    for e in await browse(within: seconds) where !out.contains(e) {
      out.append(e)
    }
    return out
  }

  private static func parameters() -> NWParameters {
    let p = NWParameters.tcp
    p.includePeerToPeer = true
    return p
  }

  /// Lactic computers nearby. Returns as soon as Bonjour reports any, or empty after `seconds`.
  static func browse(within seconds: Double) async -> [NWEndpoint] {
    let browser = NWBrowser(for: .bonjour(type: service, domain: nil), using: parameters())
    let once = Once<[NWEndpoint]>()
    return await withCheckedContinuation { (cont: CheckedContinuation<[NWEndpoint], Never>) in
      once.set { found in
        browser.cancel()
        cont.resume(returning: found)
      }
      browser.browseResultsChangedHandler = { results, _ in
        if !results.isEmpty { once.fire(results.map { $0.endpoint }) }
      }
      browser.stateUpdateHandler = { state in
        if case .failed = state { once.fire([]) }
      }
      browser.start(queue: .global())
      DispatchQueue.global().asyncAfter(deadline: .now() + seconds) { once.fire([]) }
    }
  }

  /// One POST, closed after the answer. Returns the status and the body.
  static func post(to endpoint: NWEndpoint, path: String, body: Data, headers: [String: String], timeout: Double) async throws -> (Int, Data) {
    let conn = NWConnection(to: endpoint, using: parameters())
    var head = "POST \(path) HTTP/1.1\r\nHost: lactic\r\nConnection: close\r\nContent-Length: \(body.count)\r\n"
    for (k, v) in headers { head += "\(k): \(v)\r\n" }
    head += "\r\n"
    var request = Data(head.utf8)
    request.append(body)

    let once = Once<Result<(Int, Data), Error>>()
    return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<(Int, Data), Error>) in
      once.set { result in
        conn.cancel()
        cont.resume(with: result)
      }
      let received = Buffer()
      func receive() {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { data, _, isComplete, error in
          if let data { received.data.append(data) }
          if let answer = parse(received.data, complete: isComplete) { return once.fire(.success(answer)) }
          if let error { return once.fire(.failure(error)) }
          if isComplete { return once.fire(.failure(URLError(.networkConnectionLost))) }
          receive()
        }
      }
      conn.stateUpdateHandler = { state in
        switch state {
        case .ready:
          conn.send(content: request, completion: .contentProcessed { error in
            if let error { once.fire(.failure(error)) } else { receive() }
          })
        case .failed(let e), .waiting(let e):
          once.fire(.failure(e))
        default:
          break
        }
      }
      conn.start(queue: .global())
      DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { once.fire(.failure(URLError(.timedOut))) }
    }
  }

  /// A whole HTTP response: its status and body, or nil while more is on the way.
  static func parse(_ data: Data, complete: Bool) -> (Int, Data)? {
    guard let end = data.range(of: Data("\r\n\r\n".utf8)) else { return nil }
    guard let head = String(data: data[data.startIndex..<end.lowerBound], encoding: .utf8) else { return nil }
    let lines = head.components(separatedBy: "\r\n")
    let parts = lines.first?.split(separator: " ") ?? []
    guard parts.count >= 2, let status = Int(parts[1]) else { return nil }
    let body = Data(data[end.upperBound...])
    let length = lines.dropFirst().compactMap { line -> Int? in
      let kv = line.split(separator: ":", maxSplits: 1)
      guard kv.count == 2, kv[0].trimmingCharacters(in: .whitespaces).lowercased() == "content-length" else { return nil }
      return Int(kv[1].trimmingCharacters(in: .whitespaces))
    }.first
    if let length { return body.count >= length ? (status, Data(body.prefix(length))) : nil }
    return complete ? (status, body) : nil
  }
}

/// Bytes gathered across receive callbacks (which run one after another).
private final class Buffer {
  var data = Data()
}

/// Calls its handler with the first value fired, and ignores the rest (a timeout racing an answer).
private final class Once<T> {
  private let lock = NSLock()
  private var handler: ((T) -> Void)?
  private var fired = false

  func set(_ h: @escaping (T) -> Void) {
    lock.lock()
    handler = h
    lock.unlock()
  }

  func fire(_ value: T) {
    lock.lock()
    if fired {
      lock.unlock()
      return
    }
    fired = true
    let h = handler
    handler = nil
    lock.unlock()
    h?(value)
  }
}
