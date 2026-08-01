import BackgroundTasks
import Flutter
import UIKit

/// BGTaskScheduler-backed background draining (iOS 13+).
///
/// Host app requirements (see README):
/// - Info.plist `BGTaskSchedulerPermittedIdentifiers` must list
///   `dev.optosync.background.refresh` and `dev.optosync.background.processing`.
/// - Info.plist `UIBackgroundModes` must include `fetch` and `processing`.
/// - `OptoSyncBackgroundPlugin.registerTasks()` must be called from
///   `application(_:didFinishLaunchingWithOptions:)` BEFORE the launch method
///   returns (BGTaskScheduler requires registration at launch). Objective-C
///   hosts use `[OptoSyncBackgroundBridge registerTasks]`.
public class OptoSyncBackgroundPlugin: NSObject, FlutterPlugin {
  static let refreshTaskIdentifier = "dev.optosync.background.refresh"
  static let processingTaskIdentifier = "dev.optosync.background.processing"
  static let defaultsSuite = "dev.optosync.background"
  static let callbackKey = "callbackHandle"
  static let dispatcherKey = "dispatcherHandle"
  static let frequencyKey = "frequencySeconds"

  public static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(
      name: "dev.optosync.background/methods",
      binaryMessenger: registrar.messenger())
    let instance = OptoSyncBackgroundPlugin()
    registrar.addMethodCallDelegate(instance, channel: channel)
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

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let defaults = UserDefaults(suiteName: Self.defaultsSuite) ?? .standard
    switch call.method {
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
      let frequency = arguments?["frequencySeconds"] as? Double ?? 3600
      defaults.set(frequency, forKey: Self.frequencyKey)
      Self.scheduleRefresh(after: frequency)
      result(nil)
    case "scheduleExpedited":
      // BGTaskScheduler has no true "now": submit with no earliest date so
      // the system runs it at the next opportunity.
      Self.scheduleRefresh(after: 0)
      result(nil)
    case "cancelAll":
      BGTaskScheduler.shared.cancelAllTaskRequests()
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
      // Duplicate submissions and simulator limitations land here; the next
      // launch or periodic registration re-submits.
    }
  }

  static func handle(task: BGTask, reschedule: Bool) {
    // Keep the refresh chain alive first: iOS grants no second chance if we
    // crash mid-drain without having scheduled the next slot.
    let defaults = UserDefaults(suiteName: defaultsSuite) ?? .standard
    if reschedule {
      let frequency = defaults.double(forKey: frequencyKey)
      scheduleRefresh(after: frequency > 0 ? frequency : 3600)
    }

    let callback = defaults.object(forKey: callbackKey) as? Int64 ?? 0
    let dispatcher = defaults.object(forKey: dispatcherKey) as? Int64 ?? 0
    guard callback != 0, dispatcher != 0,
      let dispatcherInfo = FlutterCallbackCache.lookupCallbackInformation(dispatcher)
    else {
      task.setTaskCompleted(success: false)
      return
    }

    let engine = FlutterEngine(name: "opto-sync-background", project: nil, allowHeadlessExecution: true)
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
}
