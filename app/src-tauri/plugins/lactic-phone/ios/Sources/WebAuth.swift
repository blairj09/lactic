// Signing in to another service from the iPhone (Strava, for posting rides): its page opens in
// the system sign-in sheet, which shares Safari's cookies (so a rider already signed in to Strava
// just taps Authorize), and the sheet closes when the page sends the rider to the app's own
// address. The web layer reads the code from that address.
//
// A 127.0.0.1 listener, which the computer uses, can't do this here: iOS pauses the app, and the
// listener with it, while Safari is in front.

import AuthenticationServices
import Tauri
import UIKit

struct WebAuthArgs: Decodable {
  let url: String
  /// The scheme of the address the page comes back to, e.g. "lactic".
  let scheme: String
}

struct WebAuthAnswer: Encodable {
  let url: String
}

final class WebAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
  static let shared = WebAuth()
  /// Held while the sheet is up (ASWebAuthenticationSession is dropped otherwise).
  private var session: ASWebAuthenticationSession?

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first ?? ASPresentationAnchor()
  }

  func start(_ url: URL, scheme: String, done: @escaping (Result<URL, Error>) -> Void) {
    DispatchQueue.main.async {
      self.session?.cancel()
      let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] back, error in
        self?.session = nil
        if let back { return done(.success(back)) }
        if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
          return done(.failure(LacticError("Sign-in was closed before it finished.")))
        }
        done(.failure(error ?? LacticError("Sign-in didn't finish.")))
      }
      session.presentationContextProvider = self
      self.session = session
      if !session.start() {
        self.session = nil
        done(.failure(LacticError("Couldn't open the sign-in page.")))
      }
    }
  }
}

extension LacticPhonePlugin {
  @objc public func webAuth(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(WebAuthArgs.self)
    guard let url = URL(string: args.url), url.scheme == "https" else { return invoke.reject("That sign-in address isn't valid.") }
    WebAuth.shared.start(url, scheme: args.scheme) { result in
      switch result {
      case .success(let back): invoke.resolve(WebAuthAnswer(url: back.absoluteString))
      case .failure(let error): invoke.reject(error.localizedDescription)
      }
    }
  }
}
