import BackgroundTasks
import Flutter
import Foundation

/// Reference iOS integration for a bounded opto-sync HTTP push/pull cycle.
/// Register once during application launch; scheduling remains discretionary.
public final class OptoSyncBackgroundScheduler {
  public static let methodChannelName = "opto-sync/background"

  private let identifier: String
  private let engineFactory: () -> FlutterEngine
  private let budgetMilliseconds: Int

  public init(
    identifier: String,
    budgetMilliseconds: Int = 25_000,
    engineFactory: @escaping () -> FlutterEngine
  ) {
    precondition(!identifier.isEmpty)
    precondition((1_000...600_000).contains(budgetMilliseconds))
    self.identifier = identifier
    self.engineFactory = engineFactory
    self.budgetMilliseconds = budgetMilliseconds
  }

  /// Call exactly once before application launch finishes.
  @discardableResult
  public func register() -> Bool {
    BGTaskScheduler.shared.register(
      forTaskWithIdentifier: identifier,
      using: nil
    ) { [weak self] task in
      guard
        let self,
        let processingTask = task as? BGProcessingTask
      else {
        task.setTaskCompleted(success: false)
        return
      }
      self.handle(processingTask)
    }
  }

  public func schedule(earliestBeginDate: Date? = nil) throws {
    let request = BGProcessingTaskRequest(identifier: identifier)
    request.requiresNetworkConnectivity = true
    request.requiresExternalPower = false
    request.earliestBeginDate = earliestBeginDate
    try BGTaskScheduler.shared.submit(request)
  }

  private func handle(_ task: BGProcessingTask) {
    let engine = engineFactory()
    let channel = FlutterMethodChannel(
      name: Self.methodChannelName,
      binaryMessenger: engine.binaryMessenger
    )
    let stateLock = NSLock()
    var completed = false
    var runStarted = false

    func complete(_ success: Bool) {
      stateLock.lock()
      guard !completed else {
        stateLock.unlock()
        return
      }
      completed = true
      stateLock.unlock()
      DispatchQueue.main.async {
        channel.setMethodCallHandler(nil)
        task.setTaskCompleted(success: success)
        engine.destroyContext()
      }
    }

    func beginRunAfterDartIsReady() {
      stateLock.lock()
      guard !completed && !runStarted else {
        stateLock.unlock()
        return
      }
      runStarted = true
      stateLock.unlock()
      channel.invokeMethod(
        "runOnce",
        arguments: ["budgetMilliseconds": budgetMilliseconds]
      ) { result in
        complete(!(result is FlutterError))
      }
    }

    channel.setMethodCallHandler { call, result in
      guard call.method == "ready" else {
        result(FlutterMethodNotImplemented)
        return
      }
      result(nil)
      beginRunAfterDartIsReady()
    }

    task.expirationHandler = {
      channel.invokeMethod("cancel", arguments: nil)
      complete(false)
    }

    guard engine.run(withEntrypoint: "optoSyncBackgroundMain") else {
      complete(false)
      return
    }
  }
}
