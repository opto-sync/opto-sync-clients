import 'dart:async';

import '../protocol_sync_loop.dart';

final RegExp _canonicalCheckpoint = RegExp(r'^(?:0|[1-9]\d*)$');

class AuthoritativeCheckpointTarget {
  final int protocolVersion;
  final String checkpoint;
  final String? generation;

  const AuthoritativeCheckpointTarget({
    this.protocolVersion = 1,
    required this.checkpoint,
    this.generation,
  });

  factory AuthoritativeCheckpointTarget.fromJson(Map<String, dynamic> json) {
    return AuthoritativeCheckpointTarget(
      protocolVersion: json['protocolVersion'] as int? ?? 0,
      checkpoint: json['checkpoint'] as String? ?? '',
      generation: json['generation'] as String?,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
    'protocolVersion': protocolVersion,
    'checkpoint': checkpoint,
    if (generation != null) 'generation': generation,
  };
}

abstract interface class AuthoritativeCheckpointRequester {
  Future<AuthoritativeCheckpointTarget> requestCheckpoint(
    CaughtUpCancellationToken cancellation,
  );
}

class CaughtUpCancellationToken {
  bool _cancelled = false;
  final Completer<void> _cancelledCompleter = Completer<void>();

  bool get isCancelled => _cancelled;
  Future<void> get whenCancelled => _cancelledCompleter.future;

  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    _cancelledCompleter.complete();
  }
}

enum CaughtUpBarrierErrorCode {
  invalidTarget,
  invalidLocalCheckpoint,
  invalidated,
  timeout,
  cancelled,
  offline,
}

enum CaughtUpFailureKind { barrier, sync, request }

class CaughtUpFailure {
  final CaughtUpFailureKind kind;
  final CaughtUpBarrierErrorCode? code;
  final String message;
  final String? targetCheckpoint;
  final String? localCheckpoint;
  final Object? cause;

  const CaughtUpFailure({
    required this.kind,
    required this.message,
    this.code,
    this.targetCheckpoint,
    this.localCheckpoint,
    this.cause,
  });
}

class CaughtUpResult {
  final String targetCheckpoint;
  final String checkpoint;
  final String? generation;
  final Duration elapsed;
  final int cycles;
  final bool alreadyCaughtUp;

  const CaughtUpResult({
    required this.targetCheckpoint,
    required this.checkpoint,
    required this.generation,
    required this.elapsed,
    required this.cycles,
    required this.alreadyCaughtUp,
  });
}

sealed class CaughtUpOutcome<T> {
  const CaughtUpOutcome();
}

final class CaughtUpSuccess<T> extends CaughtUpOutcome<T> {
  final T value;
  const CaughtUpSuccess(this.value);
}

final class CaughtUpFailed<T> extends CaughtUpOutcome<T> {
  final CaughtUpFailure error;
  const CaughtUpFailed(this.error);
}

CaughtUpFailure _barrierFailure(
  CaughtUpBarrierErrorCode code,
  String message, {
  String? target,
  String? local,
}) {
  return CaughtUpFailure(
    kind: CaughtUpFailureKind.barrier,
    code: code,
    message: message,
    targetCheckpoint: target,
    localCheckpoint: local,
  );
}

CaughtUpFailure? _checkpointFailure(String checkpoint, {required bool local}) {
  if (_canonicalCheckpoint.hasMatch(checkpoint)) return null;
  return _barrierFailure(
    local
        ? CaughtUpBarrierErrorCode.invalidLocalCheckpoint
        : CaughtUpBarrierErrorCode.invalidTarget,
    '${local ? 'local' : 'target'} checkpoint must be a canonical unsigned decimal string',
    target: local ? null : checkpoint,
    local: local ? checkpoint : null,
  );
}

CaughtUpOutcome<bool> checkpointReached(String local, String target) {
  final localError = _checkpointFailure(local, local: true);
  if (localError != null) return CaughtUpFailed<bool>(localError);
  final targetError = _checkpointFailure(target, local: false);
  if (targetError != null) return CaughtUpFailed<bool>(targetError);
  return CaughtUpSuccess<bool>(BigInt.parse(local) >= BigInt.parse(target));
}

CaughtUpFailure? validateAuthoritativeCheckpointTarget(
  AuthoritativeCheckpointTarget target, {
  String? expectedGeneration,
}) {
  if (target.protocolVersion != 1) {
    return _barrierFailure(
      CaughtUpBarrierErrorCode.invalidTarget,
      'authoritative checkpoint target has unsupported protocolVersion',
      target: target.checkpoint,
    );
  }
  final checkpointError = _checkpointFailure(target.checkpoint, local: false);
  if (checkpointError != null) return checkpointError;
  final generation = target.generation;
  if (generation != null && generation.isEmpty) {
    return _barrierFailure(
      CaughtUpBarrierErrorCode.invalidTarget,
      'authoritative checkpoint generation must be non-empty when present',
      target: target.checkpoint,
    );
  }
  if (expectedGeneration != null && generation != expectedGeneration) {
    return _barrierFailure(
      CaughtUpBarrierErrorCode.invalidated,
      'checkpoint generation does not match the expected generation',
      target: target.checkpoint,
    );
  }
  return null;
}

Duration _normalizedDuration(Duration value, Duration fallback) {
  if (value.isNegative) return Duration.zero;
  return value;
}

sealed class _WaitResult<T> {
  const _WaitResult();
}

final class _WaitValue<T> extends _WaitResult<T> {
  final T value;
  const _WaitValue(this.value);
}

final class _WaitOperationError<T> extends _WaitResult<T> {
  final Object cause;
  const _WaitOperationError(this.cause);
}

final class _WaitTimeout<T> extends _WaitResult<T> {
  const _WaitTimeout();
}

final class _WaitCancelled<T> extends _WaitResult<T> {
  const _WaitCancelled();
}

Future<_WaitResult<T>> _boundedForCaller<T>(
  Future<T> operation, {
  required Duration remaining,
  CaughtUpCancellationToken? cancellation,
}) {
  if (cancellation?.isCancelled ?? false) {
    return Future<_WaitResult<T>>.value(const _WaitCancelled<T>());
  }
  if (remaining <= Duration.zero) {
    return Future<_WaitResult<T>>.value(const _WaitTimeout<T>());
  }
  final operationResult = operation.then<_WaitResult<T>>(
    _WaitValue<T>.new,
    onError: (Object error) => _WaitOperationError<T>(error),
  );
  final timeoutResult = Future<_WaitResult<T>>.delayed(
    remaining,
    () => const _WaitTimeout<T>(),
  );
  if (cancellation == null) {
    return Future.any<_WaitResult<T>>(<Future<_WaitResult<T>>>[
      operationResult,
      timeoutResult,
    ]);
  }
  final cancellationResult = cancellation.whenCancelled.then<_WaitResult<T>>(
    (_) => const _WaitCancelled<T>(),
  );
  return Future.any<_WaitResult<T>>(<Future<_WaitResult<T>>>[
    operationResult,
    timeoutResult,
    cancellationResult,
  ]);
}

CaughtUpFailed<T> _waitFailure<T>(
  _WaitResult<T> result,
  String target,
  String local,
  String syncMessage,
) {
  if (result is _WaitOperationError<T>) {
    return CaughtUpFailed<T>(
      CaughtUpFailure(
        kind: CaughtUpFailureKind.sync,
        message: syncMessage,
        targetCheckpoint: target,
        localCheckpoint: local,
        cause: result.cause,
      ),
    );
  }
  if (result is _WaitCancelled<T>) {
    return CaughtUpFailed<T>(
      _barrierFailure(
        CaughtUpBarrierErrorCode.cancelled,
        'caught-up wait was cancelled',
        target: target,
        local: local,
      ),
    );
  }
  return CaughtUpFailed<T>(
    _barrierFailure(
      CaughtUpBarrierErrorCode.timeout,
      'caught-up wait timed out before the durable checkpoint reached the target',
      target: target,
      local: local,
    ),
  );
}

Future<CaughtUpOutcome<CaughtUpResult>> awaitCaughtUp(
  ProtocolSyncLoop loop,
  ProtocolQueueAdapter queue,
  AuthoritativeCheckpointTarget target, {
  Duration timeout = const Duration(seconds: 30),
  Duration pollInterval = const Duration(milliseconds: 50),
  CaughtUpCancellationToken? cancellation,
  String? expectedGeneration,
  bool Function()? isOnline,
  DateTime Function()? now,
}) async {
  final targetError = validateAuthoritativeCheckpointTarget(
    target,
    expectedGeneration: expectedGeneration,
  );
  if (targetError != null) return CaughtUpFailed<CaughtUpResult>(targetError);
  final clock = now ?? DateTime.now;
  final boundedTimeout = _normalizedDuration(timeout, const Duration(seconds: 30));
  final boundedPoll = _normalizedDuration(
    pollInterval,
    const Duration(milliseconds: 50),
  );
  final online = isOnline ?? loop.isOnline;
  final startedAt = clock();
  final deadline = startedAt.add(boundedTimeout);
  var checkpoint = await queue.pullCheckpoint();
  final initialCheckpointError = _checkpointFailure(checkpoint, local: true);
  if (initialCheckpointError != null) {
    return CaughtUpFailed<CaughtUpResult>(initialCheckpointError);
  }
  final initialReached = checkpointReached(checkpoint, target.checkpoint);
  if (initialReached is CaughtUpFailed<bool>) {
    return CaughtUpFailed<CaughtUpResult>(initialReached.error);
  }
  if ((initialReached as CaughtUpSuccess<bool>).value) {
    return CaughtUpSuccess<CaughtUpResult>(
      CaughtUpResult(
        targetCheckpoint: target.checkpoint,
        checkpoint: checkpoint,
        generation: target.generation,
        elapsed: clock().difference(startedAt),
        cycles: 0,
        alreadyCaughtUp: true,
      ),
    );
  }

  var cycles = 0;
  while (true) {
    if (cancellation?.isCancelled ?? false) {
      return CaughtUpFailed<CaughtUpResult>(
        _barrierFailure(
          CaughtUpBarrierErrorCode.cancelled,
          'caught-up wait was cancelled',
          target: target.checkpoint,
          local: checkpoint,
        ),
      );
    }
    if (!online() || loop.state.status == ProtocolSyncStatus.offline) {
      return CaughtUpFailed<CaughtUpResult>(
        _barrierFailure(
          CaughtUpBarrierErrorCode.offline,
          'cannot establish authoritative freshness while offline',
          target: target.checkpoint,
          local: checkpoint,
        ),
      );
    }
    final remaining = deadline.difference(clock());
    if (remaining <= Duration.zero) {
      return CaughtUpFailed<CaughtUpResult>(
        _barrierFailure(
          CaughtUpBarrierErrorCode.timeout,
          'caught-up wait timed out before the durable checkpoint reached the target',
          target: target.checkpoint,
          local: checkpoint,
        ),
      );
    }

    final before = checkpoint;
    final waited = await _boundedForCaller<ProtocolSyncCycleResult>(
      loop.syncNow(),
      remaining: remaining,
      cancellation: cancellation,
    );
    if (waited is! _WaitValue<ProtocolSyncCycleResult>) {
      return _waitFailure<ProtocolSyncCycleResult>(
        waited,
        target.checkpoint,
        checkpoint,
        'protocol sync failed before the caught-up target was reached',
      ) as CaughtUpFailed<CaughtUpResult>;
    }
    cycles++;

    checkpoint = await queue.pullCheckpoint();
    final checkpointError = _checkpointFailure(checkpoint, local: true);
    if (checkpointError != null) {
      return CaughtUpFailed<CaughtUpResult>(checkpointError);
    }
    final reached = checkpointReached(checkpoint, target.checkpoint);
    if (reached is CaughtUpFailed<bool>) {
      return CaughtUpFailed<CaughtUpResult>(reached.error);
    }
    if ((reached as CaughtUpSuccess<bool>).value) {
      return CaughtUpSuccess<CaughtUpResult>(
        CaughtUpResult(
          targetCheckpoint: target.checkpoint,
          checkpoint: checkpoint,
          generation: target.generation,
          elapsed: clock().difference(startedAt),
          cycles: cycles,
          alreadyCaughtUp: false,
        ),
      );
    }

    if (checkpoint == before && boundedPoll > Duration.zero) {
      final afterCycleRemaining = deadline.difference(clock());
      final delay = boundedPoll < afterCycleRemaining
          ? boundedPoll
          : afterCycleRemaining;
      final delayed = await _boundedForCaller<void>(
        Future<void>.delayed(delay),
        remaining: afterCycleRemaining,
        cancellation: cancellation,
      );
      if (delayed is! _WaitValue<void>) {
        final failure = _waitFailure<void>(
          delayed,
          target.checkpoint,
          checkpoint,
          'caught-up poll delay failed',
        );
        return CaughtUpFailed<CaughtUpResult>(failure.error);
      }
    }
  }
}

Future<CaughtUpOutcome<CaughtUpResult>> requestAndAwaitCaughtUp(
  ProtocolSyncLoop loop,
  ProtocolQueueAdapter queue,
  AuthoritativeCheckpointRequester requester, {
  Duration timeout = const Duration(seconds: 30),
  Duration pollInterval = const Duration(milliseconds: 50),
  CaughtUpCancellationToken? cancellation,
  String? expectedGeneration,
  bool Function()? isOnline,
  DateTime Function()? now,
}) async {
  final clock = now ?? DateTime.now;
  final boundedTimeout = _normalizedDuration(timeout, const Duration(seconds: 30));
  final startedAt = clock();
  final requestCancellation = CaughtUpCancellationToken();
  final mirror = cancellation == null
      ? null
      : Stream<void>.fromFuture(cancellation.whenCancelled).listen(
          (_) => requestCancellation.cancel(),
        );
  if (cancellation?.isCancelled ?? false) requestCancellation.cancel();
  final requested = await _boundedForCaller<AuthoritativeCheckpointTarget>(
    requester.requestCheckpoint(requestCancellation),
    remaining: boundedTimeout,
    cancellation: cancellation,
  );
  await mirror?.cancel();
  if (requested is _WaitOperationError<AuthoritativeCheckpointTarget>) {
    return CaughtUpFailed<CaughtUpResult>(
      CaughtUpFailure(
        kind: CaughtUpFailureKind.request,
        message: 'authoritative checkpoint request failed',
        cause: requested.cause,
      ),
    );
  }
  if (requested is _WaitCancelled<AuthoritativeCheckpointTarget>) {
    requestCancellation.cancel();
    return CaughtUpFailed<CaughtUpResult>(
      _barrierFailure(
        CaughtUpBarrierErrorCode.cancelled,
        'caught-up wait was cancelled',
      ),
    );
  }
  if (requested is _WaitTimeout<AuthoritativeCheckpointTarget>) {
    requestCancellation.cancel();
    return CaughtUpFailed<CaughtUpResult>(
      _barrierFailure(
        CaughtUpBarrierErrorCode.timeout,
        'caught-up wait timed out while requesting the authoritative checkpoint',
      ),
    );
  }
  final target = (requested as _WaitValue<AuthoritativeCheckpointTarget>).value;
  final elapsed = clock().difference(startedAt);
  final remaining = boundedTimeout - elapsed;
  return await awaitCaughtUp(
    loop,
    queue,
    target,
    timeout: remaining.isNegative ? Duration.zero : remaining,
    pollInterval: boundedPollInterval(pollInterval),
    cancellation: cancellation,
    expectedGeneration: expectedGeneration,
    isOnline: isOnline,
    now: clock,
  );
}

Duration boundedPollInterval(Duration pollInterval) {
  return _normalizedDuration(pollInterval, const Duration(milliseconds: 50));
}
