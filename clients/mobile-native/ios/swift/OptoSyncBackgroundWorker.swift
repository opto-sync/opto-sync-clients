import BackgroundTasks
import Foundation

@available(iOS 13.0, *)
public final class OptoSyncCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false

    public init() {}

    public var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    public func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }
}

@available(iOS 13.0, *)
private final class OptoSyncCompletionGate: @unchecked Sendable {
    private let lock = NSLock()
    private var completed = false

    func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !completed else { return false }
        completed = true
        return true
    }
}

@available(iOS 13.0, *)
public protocol OptoSyncBackgroundDelegate: Sendable {
    /**
     Reopen the session-scoped SQLite store, resolve fresh credentials, and run
     bounded pull/push/pull cycles. Return false for retryable incomplete work.
     */
    func run(cancellation: OptoSyncCancellation) async throws -> Bool
}

@available(iOS 13.0, *)
public final class OptoSyncBackgroundWorker: @unchecked Sendable {
    public let refreshIdentifier: String
    public let processingIdentifier: String

    private let delegate: any OptoSyncBackgroundDelegate
    private let scheduler: BGTaskScheduler
    private let refreshInterval: TimeInterval

    public init(
        refreshIdentifier: String,
        processingIdentifier: String,
        delegate: any OptoSyncBackgroundDelegate,
        scheduler: BGTaskScheduler = .shared,
        refreshInterval: TimeInterval = 15 * 60
    ) {
        precondition(refreshInterval >= 15 * 60)
        self.refreshIdentifier = refreshIdentifier
        self.processingIdentifier = processingIdentifier
        self.delegate = delegate
        self.scheduler = scheduler
        self.refreshInterval = refreshInterval
    }

    /**
     Register during application launch, before the launch sequence completes.
     Add both identifiers to BGTaskSchedulerPermittedIdentifiers and enable
     Background Fetch plus Background Processing capabilities.
     */
    @discardableResult
    public func register() -> Bool {
        let refreshRegistered = scheduler.register(
            forTaskWithIdentifier: refreshIdentifier,
            using: nil
        ) { [weak self] task in
            guard
                let self,
                let refreshTask = task as? BGAppRefreshTask
            else {
                task.setTaskCompleted(success: false)
                return
            }
            self.handle(refreshTask, reschedule: self.scheduleRefresh)
        }
        let processingRegistered = scheduler.register(
            forTaskWithIdentifier: processingIdentifier,
            using: nil
        ) { [weak self] task in
            guard
                let self,
                let processingTask = task as? BGProcessingTask
            else {
                task.setTaskCompleted(success: false)
                return
            }
            self.handle(processingTask, reschedule: self.scheduleProcessing)
        }
        return refreshRegistered && processingRegistered
    }

    public func scheduleRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: refreshInterval)
        submit(request)
    }

    public func scheduleProcessing() {
        let request = BGProcessingTaskRequest(identifier: processingIdentifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        submit(request)
    }

    public func cancelAll() {
        scheduler.cancel(taskRequestWithIdentifier: refreshIdentifier)
        scheduler.cancel(taskRequestWithIdentifier: processingIdentifier)
    }

    private func submit(_ request: BGTaskRequest) {
        do {
            try scheduler.submit(request)
        } catch {
            // Scheduling failure is observable through the application's own
            // telemetry callback. Never log session ids, URLs, or tokens here.
        }
    }

    private func handle(
        _ task: BGTask,
        reschedule: @escaping @Sendable () -> Void
    ) {
        reschedule()
        let cancellation = OptoSyncCancellation()
        let completion = OptoSyncCompletionGate()
        let complete = { (success: Bool) in
            guard completion.claim() else { return }
            task.setTaskCompleted(success: success && !cancellation.isCancelled)
        }
        let work = Task { [delegate] in
            do {
                let finished = try await delegate.run(cancellation: cancellation)
                complete(finished)
            } catch {
                complete(false)
            }
        }
        task.expirationHandler = {
            cancellation.cancel()
            work.cancel()
            complete(false)
        }
    }
}
