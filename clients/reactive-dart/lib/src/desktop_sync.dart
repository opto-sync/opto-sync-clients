import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'background_sync.dart';

enum DesktopWakeReason {
  processStart,
  localMutation,
  remoteChange,
  connectivity,
  resume,
  appUpdate,
  manual,
}

enum DesktopRuntime { node, electron, flutter, rustNative, wasmWebView }

enum DesktopExecutionClass {
  persistentNativeRunner,
  serviceWorkerEvents,
  foregroundOnly,
}

enum DesktopTcpCapability { native, hostBridge, unsupported }

final class DesktopCapabilityInput {
  const DesktopCapabilityInput({
    required this.runtime,
    this.serviceWorkerAvailable = false,
    this.nativeHostBridgeAvailable = false,
    this.persistentNativeRunnerAvailable = false,
    this.tcpAvailable = false,
  });

  final DesktopRuntime runtime;
  final bool serviceWorkerAvailable;
  final bool nativeHostBridgeAvailable;
  final bool persistentNativeRunnerAvailable;
  final bool tcpAvailable;
}

final class DesktopSyncCapability {
  const DesktopSyncCapability({
    required this.runtime,
    required this.executionClass,
    required this.websocketLivesForHostProcess,
    required this.tcp,
    required this.survivesWindowClosure,
    required this.survivesHostTermination,
  });

  final DesktopRuntime runtime;
  final DesktopExecutionClass executionClass;
  final bool http = true;
  final bool websocketLivesForHostProcess;
  final DesktopTcpCapability tcp;
  final bool survivesWindowClosure;
  final bool survivesHostTermination;
  final bool exactIntervalsGuaranteed = false;
}

/// Resolve desktop capabilities without presenting WASM as an OS daemon.
DesktopSyncCapability resolveDesktopSyncCapability(
  DesktopCapabilityInput input,
) {
  if (input.runtime == DesktopRuntime.wasmWebView &&
      input.persistentNativeRunnerAvailable &&
      !input.nativeHostBridgeAvailable) {
    throw StateError(
      'a WASM webview needs a native host bridge to claim a persistent runner',
    );
  }

  final executionClass = input.persistentNativeRunnerAvailable
      ? DesktopExecutionClass.persistentNativeRunner
      : input.serviceWorkerAvailable
      ? DesktopExecutionClass.serviceWorkerEvents
      : DesktopExecutionClass.foregroundOnly;
  final tcp = !input.tcpAvailable
      ? DesktopTcpCapability.unsupported
      : input.runtime == DesktopRuntime.wasmWebView
      ? input.nativeHostBridgeAvailable
            ? DesktopTcpCapability.hostBridge
            : DesktopTcpCapability.unsupported
      : DesktopTcpCapability.native;

  return DesktopSyncCapability(
    runtime: input.runtime,
    executionClass: executionClass,
    websocketLivesForHostProcess:
        executionClass == DesktopExecutionClass.persistentNativeRunner,
    tcp: tcp,
    survivesWindowClosure:
        executionClass == DesktopExecutionClass.persistentNativeRunner ||
        input.serviceWorkerAvailable,
    survivesHostTermination:
        executionClass == DesktopExecutionClass.persistentNativeRunner,
  );
}

final class DesktopLeaseRequest {
  const DesktopLeaseRequest({
    required this.key,
    required this.ownerId,
    required this.token,
    required this.now,
    required this.expiresAt,
  });

  final String key;
  final String ownerId;
  final String token;
  final DateTime now;
  final DateTime expiresAt;
}

final class DesktopLeaseGrant {
  const DesktopLeaseGrant({
    required this.key,
    required this.ownerId,
    required this.token,
    required this.fence,
    required this.expiresAt,
  });

  final String key;
  final String ownerId;
  final String token;

  /// Monotonic, lossless fencing identity assigned atomically by the store.
  final String fence;
  final DateTime expiresAt;
}

/// Durable cross-process compare-and-swap boundary.
///
/// [tryAcquire] must increment the fence when replacing an absent or expired
/// lease. [release] must compare token plus fence and never delete a newer
/// owner's lease.
abstract interface class DesktopLeaseStore {
  Future<DesktopLeaseGrant?> tryAcquire(DesktopLeaseRequest request);
  Future<void> release(DesktopLeaseGrant grant);
}

final class DesktopSyncCycleContext {
  const DesktopSyncCycleContext({
    required this.cancellation,
    required this.reasons,
    required this.ownerId,
    required this.leaseKey,
    required this.fence,
  });

  final BackgroundSyncContext cancellation;
  final List<DesktopWakeReason> reasons;
  final String ownerId;
  final String leaseKey;
  final String fence;
  DateTime get deadline => cancellation.deadline;
}

typedef DesktopSyncCycle<R> =
    Future<R> Function(DesktopSyncCycleContext context);

enum DesktopSyncOutcomeStatus { completed, busy, failed }

enum DesktopSyncFailurePhase { acquire, cycle, release }

final class DesktopSyncOutcome<R> {
  const DesktopSyncOutcome({
    required this.status,
    required this.reasons,
    required this.startedAt,
    required this.finishedAt,
    this.fence,
    this.result,
    this.failurePhase,
    this.error,
    this.stackTrace,
  });

  final DesktopSyncOutcomeStatus status;
  final List<DesktopWakeReason> reasons;
  final DateTime startedAt;
  final DateTime finishedAt;
  final String? fence;
  final R? result;
  final DesktopSyncFailurePhase? failurePhase;
  final Object? error;
  final StackTrace? stackTrace;
}

final class DesktopSyncDrainResult<R> {
  const DesktopSyncDrainResult(this.outcomes);
  final List<DesktopSyncOutcome<R>> outcomes;
}

final Random _secureRandom = Random.secure();

String _secureToken() {
  final bytes = List<int>.generate(
    18,
    (_) => _secureRandom.nextInt(256),
    growable: false,
  );
  return base64Url.encode(bytes).replaceAll('=', '');
}

void _validateIdentifier(String name, String value) {
  if (value.isEmpty || value.length > 512) {
    throw ArgumentError.value(value, name, 'must be 1 through 512 characters');
  }
}

/// Serialize desktop wake bursts around one bounded, durably fenced cycle.
///
/// Wakes received during a cycle become one trailing cycle. The callback must
/// observe [DesktopSyncCycleContext.cancellation] and its deadline. This runner
/// never releases a lease while a non-cooperative callback is still executing.
final class DesktopSyncRunner<R> {
  DesktopSyncRunner({
    required DesktopLeaseStore leaseStore,
    required String leaseKey,
    required String ownerId,
    required DesktopSyncCycle<R> syncOnce,
    this.budget = const Duration(seconds: 25),
    Duration? leaseTtl,
    DateTime Function()? now,
    String Function()? tokenFactory,
  }) : _leaseStore = leaseStore,
       _leaseKey = leaseKey,
       _ownerId = ownerId,
       _syncOnce = syncOnce,
       leaseTtl = leaseTtl ?? budget + const Duration(seconds: 5),
       _now = now ?? DateTime.now,
       _tokenFactory = tokenFactory ?? _secureToken {
    _validateIdentifier('leaseKey', leaseKey);
    _validateIdentifier('ownerId', ownerId);
    if (budget < const Duration(seconds: 1) ||
        budget > const Duration(minutes: 10)) {
      throw ArgumentError.value(
        budget,
        'budget',
        'must be from one second through ten minutes',
      );
    }
    if (this.leaseTtl < budget + const Duration(seconds: 1) ||
        this.leaseTtl > const Duration(minutes: 15)) {
      throw ArgumentError.value(
        this.leaseTtl,
        'leaseTtl',
        'must cover budget plus one second and be at most fifteen minutes',
      );
    }
  }

  final DesktopLeaseStore _leaseStore;
  final String _leaseKey;
  final String _ownerId;
  final DesktopSyncCycle<R> _syncOnce;
  final DateTime Function() _now;
  final String Function() _tokenFactory;
  final Duration budget;
  final Duration leaseTtl;
  final Set<DesktopWakeReason> _pendingReasons = <DesktopWakeReason>{};
  Future<DesktopSyncDrainResult<R>>? _drain;
  BackgroundSyncContext? _activeContext;
  bool _closed = false;

  bool get isClosed => _closed;

  Future<DesktopSyncDrainResult<R>> wake([
    DesktopWakeReason reason = DesktopWakeReason.manual,
  ]) {
    if (_closed) {
      return Future<DesktopSyncDrainResult<R>>.error(
        StateError('desktop sync runner is closed'),
      );
    }
    _pendingReasons.add(reason);
    final current = _drain;
    if (current != null) return current;

    final running = _drainPending();
    _drain = running;
    unawaited(
      running.then<void>(
        (_) => _clearDrain(running),
        onError: (_, __) => _clearDrain(running),
      ),
    );
    return running;
  }

  Future<DesktopSyncDrainResult<R>> runNow() => wake();

  void close() {
    if (_closed) return;
    _closed = true;
    _pendingReasons.clear();
    _activeContext?.cancel('desktop sync runner closed');
  }

  void _clearDrain(Future<DesktopSyncDrainResult<R>> running) {
    if (identical(_drain, running)) _drain = null;
  }

  Future<DesktopSyncDrainResult<R>> _drainPending() async {
    final outcomes = <DesktopSyncOutcome<R>>[];
    while (!_closed && _pendingReasons.isNotEmpty) {
      final reasons = _pendingReasons.toList(growable: false)
        ..sort((left, right) => left.index.compareTo(right.index));
      _pendingReasons.clear();
      outcomes.add(await _runCycle(reasons));
    }
    return DesktopSyncDrainResult<R>(List.unmodifiable(outcomes));
  }

  Future<DesktopSyncOutcome<R>> _runCycle(
    List<DesktopWakeReason> reasons,
  ) async {
    final startedAt = _now();
    final token = _tokenFactory();
    _validateIdentifier('tokenFactory result', token);
    DesktopLeaseGrant? grant;
    try {
      grant = await _leaseStore.tryAcquire(
        DesktopLeaseRequest(
          key: _leaseKey,
          ownerId: _ownerId,
          token: token,
          now: startedAt,
          expiresAt: startedAt.add(leaseTtl),
        ),
      );
    } catch (error, stackTrace) {
      return DesktopSyncOutcome<R>(
        status: DesktopSyncOutcomeStatus.failed,
        reasons: reasons,
        startedAt: startedAt,
        finishedAt: _now(),
        failurePhase: DesktopSyncFailurePhase.acquire,
        error: error,
        stackTrace: stackTrace,
      );
    }
    if (grant == null) {
      return DesktopSyncOutcome<R>(
        status: DesktopSyncOutcomeStatus.busy,
        reasons: reasons,
        startedAt: startedAt,
        finishedAt: _now(),
      );
    }

    final cancellation = BackgroundSyncContext(budget);
    _activeContext = cancellation;
    Timer? deadline;
    R? result;
    Object? cycleError;
    StackTrace? cycleStackTrace;
    try {
      deadline = Timer(
        budget,
        () => cancellation.cancel('desktop sync deadline exceeded'),
      );
      result = await _syncOnce(
        DesktopSyncCycleContext(
          cancellation: cancellation,
          reasons: List.unmodifiable(reasons),
          ownerId: _ownerId,
          leaseKey: _leaseKey,
          fence: grant.fence,
        ),
      );
      cancellation.throwIfCancelled();
    } catch (error, stackTrace) {
      cycleError = error;
      cycleStackTrace = stackTrace;
    } finally {
      deadline?.cancel();
      if (identical(_activeContext, cancellation)) _activeContext = null;
    }

    Object? releaseError;
    StackTrace? releaseStackTrace;
    try {
      await _leaseStore.release(grant);
    } catch (error, stackTrace) {
      releaseError = error;
      releaseStackTrace = stackTrace;
    }

    if (cycleError != null) {
      return DesktopSyncOutcome<R>(
        status: DesktopSyncOutcomeStatus.failed,
        reasons: reasons,
        startedAt: startedAt,
        finishedAt: _now(),
        fence: grant.fence,
        failurePhase: DesktopSyncFailurePhase.cycle,
        error: cycleError,
        stackTrace: cycleStackTrace,
      );
    }
    if (releaseError != null) {
      return DesktopSyncOutcome<R>(
        status: DesktopSyncOutcomeStatus.failed,
        reasons: reasons,
        startedAt: startedAt,
        finishedAt: _now(),
        fence: grant.fence,
        result: result,
        failurePhase: DesktopSyncFailurePhase.release,
        error: releaseError,
        stackTrace: releaseStackTrace,
      );
    }
    return DesktopSyncOutcome<R>(
      status: DesktopSyncOutcomeStatus.completed,
      reasons: reasons,
      startedAt: startedAt,
      finishedAt: _now(),
      fence: grant.fence,
      result: result,
    );
  }
}

/// Deterministic lease store for tests and single-process demonstrations.
///
/// Production desktop hosts must persist the same contract in SQLite or another
/// store shared by every process that can drain the queue.
final class InMemoryDesktopLeaseStore implements DesktopLeaseStore {
  final Map<String, DesktopLeaseGrant> _leases = <String, DesktopLeaseGrant>{};
  final Map<String, BigInt> _fences = <String, BigInt>{};

  @override
  Future<DesktopLeaseGrant?> tryAcquire(DesktopLeaseRequest request) async {
    final current = _leases[request.key];
    if (current != null && current.expiresAt.isAfter(request.now)) return null;
    final fence = (_fences[request.key] ?? BigInt.zero) + BigInt.one;
    _fences[request.key] = fence;
    final grant = DesktopLeaseGrant(
      key: request.key,
      ownerId: request.ownerId,
      token: request.token,
      fence: fence.toString(),
      expiresAt: request.expiresAt,
    );
    _leases[request.key] = grant;
    return grant;
  }

  @override
  Future<void> release(DesktopLeaseGrant grant) async {
    final current = _leases[grant.key];
    if (current != null &&
        current.token == grant.token &&
        current.fence == grant.fence) {
      _leases.remove(grant.key);
    }
  }
}
