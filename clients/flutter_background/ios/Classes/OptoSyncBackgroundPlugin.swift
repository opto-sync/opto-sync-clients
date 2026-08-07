import BackgroundTasks
import Flutter
import Foundation
import UIKit

/// BGTaskScheduler-backed background draining plus a UI-agnostic connectivity
/// event stream. Applications own presentation; the plugin emits data only.
///
/// Host app requirements (see README):
/// - Info.plist `BGTaskSchedulerPermittedIdentifiers` must list
///   `dev.optosync.background.refresh` and `dev.optosync.background.processing`.
/// - Info.plist `UIBackgroundModes` must include `fetch` and `processing`.
/// - `OptoSyncBackgroundPlugin.registerTasks()` must be called from
///   `application(_:didFinishLaunchingWithOptions:)` before launch returns.
public class OptoSyncBackgroundPlugin: NSObject, FlutterPlugin, FlutterStreamHandler {
  static let refreshTaskIdentifier = "dev.optosync.background.refresh"
  static let processingTaskIdentifier = "dev.optosync.background.processing"
  static let defaultsSuite = "dev.optosync.background"
  static let callbackKey = "callbackHandle"
  static let dispatcherKey = "dispatcherHandle"
  static let frequencyKey = "frequencySeconds"
  static let periodicRegisteredKey = "periodicRegistered"
  static let totalOfflineKey = "totalOffline"
  static let minimumPeriodicFrequency: Double = 15 * 60
  private static let registrationLock = NSLock()
  private static var didAttemptTaskRegistration = false

  private let connectivity = OptoSyncConnectivityWatcher.shared
  private var connectivityToken: UUID?
  private var connectivitySink: FlutterEventSink?

  public static func register(with registrar: FlutterPluginRegistrar) {
    let methodChannel = FlutterMethodChannel(
      name: "dev.optosync.background/methods",
      binaryMessenger: registrar.messenger())
    let eventChannel = FlutterEventChannel(
      name: "dev.optosync.background/connectivity",
      binaryMessenger: registrar.messenger())
    let instance = OptoSyncBackgroundPlugin()
    registrar.addMethodCallDelegate(instance, channel: methodChannel)
    eventChannel.setStreamHandler(instance)

    let defaults = UserDefaults(suiteName: defaultsSuite) ?? .standard
    instance.connectivity.setTotalOffline(defaults.bool(forKey: totalOfflineKey))
    instance.connectivity.start()
  }

  /// Must run during application launch. Safe to call more than once.
  @objc public static func registerTasks() {
    // Apple permits each identifier to be registered only once per process;
    // a second registration can terminate the host app.
    registrationLock.lock()
    guard !didAttemptTaskRegistration else {
      registrationLock.unlock()
      return
    }
    didAttemptTaskRegistration = true
    registrationLock.unlock()

    BGTaskScheduler.shared.register(
      forTaskWithIdentifier: refreshTaskIdentifier, using: nil
    ) { task in
      handle(task: task, reschedule: true)
    }
    BGTaskScheduler.shared.register(
      forTaskWithIdentifier: processingTaskIdentifier, using: nil
    ) { task in
      handle(task: task, reschedule: false)
    }
  }

  public func onListen(
    withArguments arguments: Any?,
    eventSink events: @escaping FlutterEventSink
  ) -> FlutterError? {
    if let connectivityToken { connectivity.removeListener(connectivityToken) }
    connectivitySink = events
    connectivityToken = connectivity.addListener { [weak self] current, _ in
      DispatchQueue.main.async {
        self?.connectivitySink?(current.dictionary)
      }
    }
    return nil
  }

  public func onCancel(withArguments arguments: Any?) -> FlutterError? {
    connectivity.removeListener(connectivityToken)
    connectivityToken = nil
    connectivitySink = nil
    return nil
  }

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let defaults = UserDefaults(suiteName: Self.defaultsSuite) ?? .standard
    switch call.method {
    case "configureConnectivity":
      let arguments = call.arguments as? [String: Any]
      let urlString = arguments?["probeUrl"] as? String
      let timeout = Self.int(arguments?["probeTimeoutMilliseconds"]) ?? 4_000
      connectivity.configureProbe(
        urlString: urlString,
        timeoutMilliseconds: timeout)
      result(connectivity.snapshot().dictionary)

    case "setConnectivityOffline":
      let arguments = call.arguments as? [String: Any]
      guard let enabled = arguments?["enabled"] as? Bool else {
        result(FlutterError(code: "BAD_ARGS", message: "enabled required", details: nil))
        return
      }
      defaults.set(enabled, forKey: Self.totalOfflineKey)
      connectivity.setTotalOffline(enabled)
      if enabled {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshTaskIdentifier)
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingTaskIdentifier)
        result(connectivity.snapshot().dictionary)
        return
      }
      guard defaults.bool(forKey: Self.periodicRegisteredKey) else {
        result(connectivity.snapshot().dictionary)
        return
      }
      let frequency = defaults.double(forKey: Self.frequencyKey)
      do {
        try Self.scheduleRefresh(
          after: frequency >= Self.minimumPeriodicFrequency ? frequency : 3_600)
        result(connectivity.snapshot().dictionary)
      } catch {
        result(FlutterError(
          code: "SCHEDULE_FAILED",
          message: "periodic work was not restored after offline mode",
          details: connectivity.snapshot().dictionary))
      }

    case "refreshConnectivity":
      connectivity.refresh()
      result(connectivity.snapshot().dictionary)

    case "initialize":
      let arguments = call.arguments as? [String: Any]
      guard let callback = Self.int64(arguments?["callbackHandle"]), callback != 0,
        let dispatcher = Self.int64(arguments?["dispatcherHandle"]), dispatcher != 0
      else {
        result(FlutterError(code: "BAD_ARGS", message: "handles required", details: nil))
        return
      }
      defaults.set(callback, forKey: Self.callbackKey)
      defaults.set(dispatcher, forKey: Self.dispatcherKey)
      result(nil)

    case "registerPeriodic":
      let arguments = call.arguments as? [String: Any]
      guard Self.isInitialized(defaults) else {
        result(FlutterError(
          code: "NOT_INITIALIZED",
          message: "call OptoSyncBackground.initialize before scheduling work",
          details: nil))
        return
      }
      let requested = Self.double(arguments?["frequencySeconds"]) ?? 3_600
      guard requested.isFinite, requested > 0 else {
        result(FlutterError(code: "BAD_ARGS", message: "invalid frequency", details: nil))
        return
      }
      let frequency = max(requested, Self.minimumPeriodicFrequency)
      defaults.set(frequency, forKey: Self.frequencyKey)
      defaults.set(true, forKey: Self.periodicRegisteredKey)
      if defaults.bool(forKey: Self.totalOfflineKey) {
        result(nil)
        return
      }
      do {
        try Self.scheduleRefresh(after: frequency)
        result(nil)
      } catch {
        result(FlutterError(
          code: "SCHEDULE_FAILED",
          message: "periodic work was not scheduled",
          details: nil))
      }

    case "scheduleExpedited":
      guard Self.isInitialized(defaults) else {
        result(FlutterError(
          code: "NOT_INITIALIZED",
          message: "call OptoSyncBackground.initialize before scheduling work",
          details: nil))
        return
      }
      if defaults.bool(forKey: Self.totalOfflineKey) {
        result(nil)
        return
      }
      do {
        // Keep the periodic refresh request intact. The processing lane is the
        // one-shot, network-bound wake for a newly committed mutation.
        try Self.scheduleProcessing()
        result(nil)
      } catch {
        result(FlutterError(
          code: "SCHEDULE_FAILED",
          message: "expedited work was not scheduled",
          details: nil))
      }

    case "cancelAll":
      defaults.set(false, forKey: Self.periodicRegisteredKey)
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshTaskIdentifier)
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingTaskIdentifier)
      result(nil)

    default:
      result(FlutterMethodNotImplemented)
    }
  }

  static func scheduleRefresh(after seconds: Double) throws {
    let request = BGAppRefreshTaskRequest(identifier: refreshTaskIdentifier)
    if seconds > 0 {
      request.earliestBeginDate = Date(timeIntervalSinceNow: seconds)
    }
    try BGTaskScheduler.shared.submit(request)
  }

  static func scheduleProcessing() throws {
    let request = BGProcessingTaskRequest(identifier: processingTaskIdentifier)
    request.requiresNetworkConnectivity = true
    request.requiresExternalPower = false
    try BGTaskScheduler.shared.submit(request)
  }

  static func handle(task: BGTask, reschedule: Bool) {
    let defaults = UserDefaults(suiteName: defaultsSuite) ?? .standard
    if defaults.bool(forKey: totalOfflineKey) {
      task.setTaskCompleted(success: true)
      return
    }

    // Keep the refresh chain alive first: iOS grants no second chance if the
    // process exits mid-drain without having scheduled the next slot.
    if reschedule {
      let frequency = defaults.double(forKey: frequencyKey)
      try? scheduleRefresh(
        after: frequency >= minimumPeriodicFrequency ? frequency : 3_600)
    }

    let callback = defaults.object(forKey: callbackKey) as? NSNumber
    let dispatcher = defaults.object(forKey: dispatcherKey) as? NSNumber
    guard let callbackHandle = callback?.int64Value, callbackHandle != 0,
      let dispatcherHandle = dispatcher?.int64Value, dispatcherHandle != 0,
      let dispatcherInfo = FlutterCallbackCache.lookupCallbackInformation(dispatcherHandle)
    else {
      task.setTaskCompleted(success: false)
      return
    }

    let engine = FlutterEngine(
      name: "opto-sync-background", project: nil, allowHeadlessExecution: true)
    let channel = FlutterMethodChannel(
      name: "dev.optosync.background/background",
      binaryMessenger: engine.binaryMessenger)

    let finishLock = NSLock()
    var finished = false
    let finish: (Bool) -> Void = { success in
      finishLock.lock()
      guard !finished else {
        finishLock.unlock()
        return
      }
      finished = true
      finishLock.unlock()

      let complete = {
        engine.destroyContext()
        task.setTaskCompleted(success: success)
      }
      if Thread.isMainThread {
        complete()
      } else {
        DispatchQueue.main.async(execute: complete)
      }
    }

    task.expirationHandler = {
      // Destroying the headless engine cooperatively terminates the Dart
      // isolate; durable queue rows remain for the next wake.
      finish(false)
    }

    channel.setMethodCallHandler { call, result in
      guard call.method == "backgroundChannelReady" else {
        result(FlutterMethodNotImplemented)
        return
      }
      result(nil)
      channel.invokeMethod("runDrain", arguments: ["callbackHandle": callbackHandle]) { value in
        finish((value as? Bool) == true)
      }
    }

    guard engine.run(
      withEntrypoint: dispatcherInfo.callbackName,
      libraryURI: dispatcherInfo.callbackLibraryPath)
    else {
      finish(false)
      return
    }
  }

  private static func isInitialized(_ defaults: UserDefaults) -> Bool {
    defaults.object(forKey: callbackKey) != nil
      && defaults.object(forKey: dispatcherKey) != nil
  }

  private static func int64(_ value: Any?) -> Int64? {
    if let number = value as? NSNumber { return number.int64Value }
    return value as? Int64
  }

  private static func int(_ value: Any?) -> Int? {
    if let number = value as? NSNumber { return number.intValue }
    return value as? Int
  }

  private static func double(_ value: Any?) -> Double? {
    if let number = value as? NSNumber { return number.doubleValue }
    return value as? Double
  }

  deinit {
    connectivity.removeListener(connectivityToken)
  }
}
