import BackgroundTasks
import Flutter
import Foundation
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
  static let minimumPeriodicFrequency: Double = 15 * 60
  private static let registrationLock = NSLock()
  private static var didAttemptTaskRegistration = false

  public static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(
      name: "dev.optosync.background/methods",
      binaryMessenger: registrar.messenger())
    let instance = OptoSyncBackgroundPlugin()
    registrar.addMethodCallDelegate(instance, channel: channel)
  }

  /// Must run during application launch. Safe to call more than once.
  @objc public static func registerTasks() {
    // Apple permits each identifier to be registered only once per process;
    // a second registration can terminate the host app. Keep the public host
    // hook idempotent even if two integration paths invoke it at launch.
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

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let defaults = UserDefaults(suiteName: Self.defaultsSuite) ?? .standard
    switch call.method {
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
      guard defaults.object(forKey: Self.callbackKey) != nil,
        defaults.object(forKey: Self.dispatcherKey) != nil
      else {
        result(FlutterError(
          code: "NOT_INITIALIZED",
          message: "call OptoSyncBackground.initialize before scheduling work",
          details: nil))
        return
      }
      let requested = Self.double(arguments?["frequencySeconds"]) ?? 3600
      guard requested.isFinite, requested > 0 else {
        result(FlutterError(code: "BAD_ARGS", message: "invalid frequency", details: nil))
        return
      }
      let frequency = max(requested, Self.minimumPeriodicFrequency)
      defaults.set(frequency, forKey: Self.frequencyKey)
      do {
        try Self.scheduleRefresh(after: frequency)
        result(nil)
      } catch {
        result(FlutterError(
          code: "SCHEDULE_FAILED", message: "periodic work was not scheduled", details: nil))
      }
    case "scheduleExpedited":
      guard defaults.object(forKey: Self.callbackKey) != nil,
        defaults.object(forKey: Self.dispatcherKey) != nil
      else {
        result(FlutterError(
          code: "NOT_INITIALIZED",
          message: "call OptoSyncBackground.initialize before scheduling work",
          details: nil))
        return
      }
      do {
        // Keep the periodic BGAppRefresh request intact. The registered
        // processing lane is the one-shot, network-bound wake for a newly
        // committed durable mutation.
        try Self.scheduleProcessing()
        result(nil)
      } catch {
        result(FlutterError(
          code: "SCHEDULE_FAILED", message: "expedited work was not scheduled", details: nil))
      }
    case "cancelAll":
      // Never cancel another plugin's or the host application's BGTask work.
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
    // Keep the refresh chain alive first: iOS grants no second chance if we
    // crash mid-drain without having scheduled the next slot.
    let defaults = UserDefaults(suiteName: defaultsSuite) ?? .standard
    if reschedule {
      let frequency = defaults.double(forKey: frequencyKey)
      try? scheduleRefresh(
        after: frequency >= minimumPeriodicFrequency ? frequency : 3600)
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

  private static func int64(_ value: Any?) -> Int64? {
    if let number = value as? NSNumber { return number.int64Value }
    return value as? Int64
  }

  private static func double(_ value: Any?) -> Double? {
    if let number = value as? NSNumber { return number.doubleValue }
    return value as? Double
  }
}
