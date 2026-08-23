import Foundation
import Network

@objc public enum OptoSyncConnectivityState: Int {
  case unknown
  case offline
  case link
  case internet

  var wireName: String {
    switch self {
    case .unknown: return "unknown"
    case .offline: return "offline"
    case .link: return "link"
    case .internet: return "internet"
    }
  }
}

/// Immutable, UI-agnostic connectivity value exposed to Swift and Objective-C.
@objcMembers public final class OptoSyncConnectivitySnapshot: NSObject {
  public let state: OptoSyncConnectivityState
  public let totalOffline: Bool
  public let source: String
  public let changedAt: Int64
  public let verifiedAt: NSNumber?

  init(
    state: OptoSyncConnectivityState,
    totalOffline: Bool,
    source: String,
    changedAt: Int64,
    verifiedAt: Int64? = nil
  ) {
    self.state = state
    self.totalOffline = totalOffline
    self.source = source
    self.changedAt = changedAt
    self.verifiedAt = verifiedAt.map { NSNumber(value: $0) }
  }

  public var hasVerifiedInternet: Bool {
    !totalOffline && state == .internet
  }

  public var dictionary: [String: Any] {
    var value: [String: Any] = [
      "state": state.wireName,
      "mode": totalOffline ? "offline" : "automatic",
      "source": source,
      "changedAt": changedAt,
    ]
    if let verifiedAt { value["verifiedAt"] = verifiedAt }
    return value
  }
}

/// NWPathMonitor adapter with an optional bounded HTTP reachability probe.
///
/// A satisfied NWPath means `link`, not verified internet. The state becomes
/// `internet` only after a configured probe receives a response. Total-offline
/// mode cancels probes and remains authoritative over later path callbacks.
@objcMembers public final class OptoSyncConnectivityWatcher: NSObject {
  public static let shared = OptoSyncConnectivityWatcher()

  private typealias Listener = (
    OptoSyncConnectivitySnapshot,
    OptoSyncConnectivitySnapshot
  ) -> Void

  private let lock = NSLock()
  private let monitorQueue = DispatchQueue(
    label: "dev.optosync.background.connectivity"
  )
  private var monitor: NWPathMonitor?
  private var started = false
  private var listeners: [UUID: Listener] = [:]
  private var current = OptoSyncConnectivitySnapshot(
    state: .unknown,
    totalOffline: false,
    source: "initial",
    changedAt: OptoSyncConnectivityWatcher.now()
  )
  private var automatic = OptoSyncConnectivitySnapshot(
    state: .unknown,
    totalOffline: false,
    source: "initial",
    changedAt: OptoSyncConnectivityWatcher.now()
  )
  private var probeURL: URL?
  private var probeTimeout: TimeInterval = 4
  private var probeTask: URLSessionDataTask?
  private var probeGeneration: UInt64 = 0

  public func snapshot() -> OptoSyncConnectivitySnapshot {
    lock.optoWithLock { current }
  }

  public func start() {
    let newMonitor: NWPathMonitor? = lock.optoWithLock {
      guard !started else { return nil }
      started = true
      let value = NWPathMonitor()
      monitor = value
      return value
    }
    guard let newMonitor else { return }
    newMonitor.pathUpdateHandler = { [weak self] path in
      self?.handle(path: path)
    }
    newMonitor.start(queue: monitorQueue)
  }

  public func stop() {
    let oldMonitor: NWPathMonitor? = lock.optoWithLock {
      guard started else { return nil }
      started = false
      let value = monitor
      monitor = nil
      cancelProbeLocked()
      return value
    }
    oldMonitor?.cancel()
  }

  /// Configure an app/server reachability endpoint. Nil disables active probes.
  public func configureProbe(
    urlString: String?,
    timeoutMilliseconds: Int
  ) {
    let parsed: URL? = {
      guard let urlString, !urlString.isEmpty, let value = URL(string: urlString),
        value.scheme == "https" || value.scheme == "http",
        value.user == nil, value.password == nil
      else { return nil }
      return value
    }()
    lock.optoWithLock {
      probeURL = parsed
      probeTimeout = max(Double(timeoutMilliseconds) / 1_000, 0.1)
      cancelProbeLocked()
    }
    refresh()
  }

  public func setTotalOffline(_ enabled: Bool) {
    let decision: (changed: Bool, cached: OptoSyncConnectivitySnapshot?) =
      lock.optoWithLock {
        guard enabled != current.totalOffline else { return (false, nil) }
        if enabled {
          cancelProbeLocked()
          return (true, nil)
        }
        return (true, automatic)
      }
    guard decision.changed else { return }
    if enabled {
      transition(
        OptoSyncConnectivitySnapshot(
          state: .offline,
          totalOffline: true,
          source: "forced-offline",
          changedAt: Self.now()
        )
      )
    } else if let cached = decision.cached {
      transition(
        OptoSyncConnectivitySnapshot(
          state: cached.state,
          totalOffline: false,
          source: cached.source,
          changedAt: Self.now(),
          verifiedAt: cached.verifiedAt?.int64Value
        )
      )
      refresh()
    }
  }

  public func refresh() {
    let path = lock.optoWithLock { monitor?.currentPath }
    guard let path else { return }
    handle(path: path)
  }

  @nonobjc @discardableResult
  public func addListener(
    emitCurrent: Bool = true,
    _ listener: @escaping (
      OptoSyncConnectivitySnapshot,
      OptoSyncConnectivitySnapshot
    ) -> Void
  ) -> UUID {
    let token = UUID()
    let snapshot = lock.optoWithLock { () -> OptoSyncConnectivitySnapshot in
      listeners[token] = listener
      return current
    }
    if emitCurrent { listener(snapshot, snapshot) }
    return token
  }

  @nonobjc public func removeListener(_ token: UUID?) {
    guard let token else { return }
    lock.optoWithLock { listeners.removeValue(forKey: token) }
  }

  private func handle(path: NWPath) {
    if path.status != .satisfied {
      publishAutomatic(
        OptoSyncConnectivitySnapshot(
          state: .offline,
          totalOffline: false,
          source: "platform",
          changedAt: Self.now()
        )
      )
      return
    }

    publishAutomatic(
      OptoSyncConnectivitySnapshot(
        state: .link,
        totalOffline: false,
        source: "platform",
        changedAt: Self.now()
      )
    )
    beginProbeIfConfigured()
  }

  private func beginProbeIfConfigured() {
    let configuration: (URL, TimeInterval, UInt64)? = lock.optoWithLock {
      guard !current.totalOffline, let probeURL else { return nil }
      cancelProbeLocked()
      probeGeneration &+= 1
      return (probeURL, probeTimeout, probeGeneration)
    }
    guard let (url, timeout, generation) = configuration else { return }

    var request = URLRequest(
      url: url,
      cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
      timeoutInterval: timeout
    )
    request.httpMethod = "HEAD"
    request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
    let task = URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
      guard let self else { return }
      let shouldAccept = self.lock.optoWithLock {
        generation == self.probeGeneration && !self.current.totalOffline
      }
      guard shouldAccept else { return }
      let now = Self.now()
      if error == nil, response != nil {
        self.publishAutomatic(
          OptoSyncConnectivitySnapshot(
            state: .internet,
            totalOffline: false,
            source: "probe",
            changedAt: now,
            verifiedAt: now
          )
        )
      } else {
        self.publishAutomatic(
          OptoSyncConnectivitySnapshot(
            state: .link,
            totalOffline: false,
            source: "probe",
            changedAt: now
          )
        )
      }
    }
    lock.optoWithLock { probeTask = task }
    task.resume()
  }

  private func publishAutomatic(_ candidate: OptoSyncConnectivitySnapshot) {
    let exposed: OptoSyncConnectivitySnapshot? = lock.optoWithLock {
      automatic = OptoSyncConnectivitySnapshot(
        state: candidate.state,
        totalOffline: false,
        source: candidate.source,
        changedAt: candidate.state == automatic.state
          ? automatic.changedAt : candidate.changedAt,
        verifiedAt: candidate.verifiedAt?.int64Value
      )
      return current.totalOffline ? nil : automatic
    }
    if let exposed { transition(exposed) }
  }

  private func transition(_ candidate: OptoSyncConnectivitySnapshot) {
    let delivery: (
      OptoSyncConnectivitySnapshot,
      OptoSyncConnectivitySnapshot,
      [Listener]
    )? = lock.optoWithLock {
      let previous = current
      let changed = previous.state != candidate.state ||
        previous.totalOffline != candidate.totalOffline
      current = OptoSyncConnectivitySnapshot(
        state: candidate.state,
        totalOffline: candidate.totalOffline,
        source: candidate.source,
        changedAt: changed ? candidate.changedAt : previous.changedAt,
        verifiedAt: candidate.verifiedAt?.int64Value
      )
      guard changed else { return nil }
      return (current, previous, Array(listeners.values))
    }
    guard let (next, previous, callbacks) = delivery else { return }
    callbacks.forEach { callback in callback(next, previous) }
    DispatchQueue.main.async {
      NotificationCenter.default.post(
        name: Notification.Name("OptoSyncConnectivityDidChangeNotification"),
        object: self,
        userInfo: next.dictionary
      )
    }
  }

  private func cancelProbeLocked() {
    probeGeneration &+= 1
    probeTask?.cancel()
    probeTask = nil
  }

  private static func now() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1_000)
  }
}

private extension NSLock {
  @discardableResult
  func optoWithLock<T>(_ body: () throws -> T) rethrows -> T {
    lock()
    defer { unlock() }
    return try body()
  }
}
