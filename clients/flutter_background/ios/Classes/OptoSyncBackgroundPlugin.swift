import BackgroundTasks
import Flutter
import UIKit

/// BGTaskScheduler-backed background draining plus a UI-agnostic connectivity
/// event stream. Applications own presentation; the plugin emits data only.
public class OptoSyncBackgroundPlugin: NSObject, FlutterPlugin, FlutterStreamHandler {
  static let refreshTaskIdentifier = "dev.optosync.background.refresh"
  static let processingTaskIdentifier = "dev.optosync.background.processing"
  static let defaultsSuite = "dev.optosync.background"
  static let callbackKey = "callbackHandle"
  static let dispatcherKey = "dispatcherHandle"
  static let frequencyKey = "frequencySeconds"
  static let periodicRegisteredKey = "periodicRegistered"
  static let totalOfflineKey = "totalOffline"

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
      let timeout = (arguments?["probeTimeoutMilliseconds"] as? NSNumber)?.intValue ?? 4_000
      connectivity.configureProbe(
        urlString: urlString,
        timeoutMilliseconds: timeout)
      result(connectivity.snapshot().dictionary)
    case "setConnectivityOffline":
      guard let arguments = call.arguments as? [String: Any],
        let enabled = arguments["enabled"] as? Bool
      else {
        result(FlutterError(code: "BAD_ARGS", message: "enabled required", details: nil))
        return
      }
      defaults.set(enabled, forKey: Self.totalOfflineKey)
      connectivity.setTotalOffline(enabled)
      if enabled {
        BGTaskScheduler.shared.cancel(
          taskRequestWithIdentifier: Self.refreshTaskIdentifier)
        BGTaskScheduler.shared.cancel(
          taskRequestWithIdentifier: Self.processingTaskIdentifier)
      } else if defaults.bool(forKey: Self.periodicRegisteredKey) {
        let frequency = defaults.double(forKey: Self.frequencyKey)
        Self.scheduleRefresh(after: frequency > 0 ? frequency : 3_600)
      }
      result(connectivity.snapshot().dictionary)
    case "refreshConnectivity":
      connectivity.refresh()
      result(connectivity.snapshot().dictionary)
    case "initialize":
      guard let arguments = call.arguments as? [String: Any],
        let callback = arguments["callbackHandle"] as? Int64,
        let dispatcher = arguments["dispatcherHandle"] as? Int64
      else {
        result(FlutterError(code: "BAD_ARGS", message: "handles required", details: nil))
        return
      }
      defaults.set(callback, forKey: Self.callbackKey)
      defaults.set(dispatcher, forKey: Self.dispatcherKey)
      result(nil)
    case "registerPeriodic":
      let arguments = call.arguments as? [String: Any]
      let frequency = (arguments?["frequencySeconds"] as? NSNumber)?.doubleValue ?? 3_600
      defaults.set(frequency, forKey: Self.frequencyKey)
      defaults.set(true, forKey: Self.periodicRegisteredKey)
      if !defaults.bool(forKey: Self.totalOfflineKey) {
        Self.scheduleRefresh(after: frequency)
      }
      result(nil)
    case "scheduleExpedited":
      if !defaults.bool(forKey: Self.totalOfflineKey) {
        Self.scheduleRefresh(after: 0)
      }
      result(nil)
    case "cancelAll":
      defaults.set(false, forKey: Self.periodicRegisteredKey)
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshTaskIdentifier)
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingTaskIdentifier)
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  static func scheduleRefresh(after seconds: Double) {
    let request = BGAppRefreshTaskRequest(identifier: refreshTaskIdentifier)
    if seconds > 0 {
      request.earliestBeginDate = Date(timeIntervalSinceNow: seconds)
    }
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      // The next launch, save wake, or periodic registration re-submits.
    }
  }

  static func handle(task: BGTask, reschedule: Bool) {
    let defaults = UserDefaults(suiteName: defaultsSuite) ?? .standard
    if defaults.bool(forKey: totalOfflineKey) {
      task.setTaskCompleted(success: true)
      return
    }

    if reschedule {
      let frequency = defaults.double(forKey: frequencyKey)
      scheduleRefresh(after: frequency > 0 ? frequency : 3_600)
    }

    let callback = defaults.object(forKey: callbackKey) as? Int64 ?? 0
    let dispatcher = defaults.object(forKey: dispatcherKey) as? Int64 ?? 0
    guard callback != 0, dispatcher != 0,
      let dispatcherInfo = FlutterCallbackCache.lookupCallbackInformation(dispatcher)
    else {
      task.setTaskCompleted(success: false)
      return
    }

    let engine = FlutterEngine(
      name: "opto-sync-background",
      project: nil,
      allowHeadlessExecution: true)
    let channel = FlutterMethodChannel(
      name: "dev.optosync.background/background",
      binaryMessenger: engine.binaryMessenger)

    var finished = false
    let finish: (Bool) -> Void = { success in
      guard !finished else { return }
      finished = true
      engine.destroyContext()
      task.setTaskCompleted(success: success)
    }

    task.expirationHandler = {
      finish(false)
    }

    channel.setMethodCallHandler { call, result in
      guard call.method == "backgroundChannelReady" else {
        result(FlutterMethodNotImplemented)
        return
      }
      result(nil)
      channel.invokeMethod("runDrain", arguments: ["callbackHandle": callback]) { value in
        finish((value as? Bool) == true)
      }
    }

    engine.run(
      withEntrypoint: dispatcherInfo.callbackName,
      libraryURI: dispatcherInfo.callbackLibraryPath)
  }

  deinit {
    connectivity.removeListener(connectivityToken)
  }
}
