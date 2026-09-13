import 'dart:async';

import 'src/protocol_sync_loop.dart';

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

class CaughtUpBarrierException implements Exception {
  final CaughtUpBarrierErrorCode code;
  final String message;
  final String? targetCheckpoint;
  final String? localCheckpoint;

  const CaughtUpBarrierException(
    this.code,
    this.message, {
    this.targetCheckpoint,
    this.localCheckpoint,
  });

  @override
  String toString() => 'CaughtUpBarrierException($code): $message';
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

bool checkpointReached(String local, String target) {
  _assertCheckpoint(local, local: true);
  _assertCheckpoint(target, local: false);
  return BigInt.parse(local) >= BigInt.parse(target);
}

void validateAuthoritativeCheckpointTarget(
  AuthoritativeCheckpointTarget target, {
  String? expectedGeneration,
}) {
  if (target.protocolVersion != 1) {
    throw CaughtUpBarrierException(
      CaughtUpBarrierErrorCode.invalidTarget,
      'authoritative checkpoint target has unsupported protocolVersion',
      targetCheckpoint: target.checkpoint,
    );
  }
  _assertCheckpoint(target.checkpoint, local: false);
  if (target.generation != null && target.generation!.isEmpty) {
    throw CaughtUpBarrierException(
      CaughtUpBarrierErrorCode.invalidTarget,
      'authoritative checkpoint generation must be non-empty when present',
      targetCheckpoint: target.checkpoint,
    );
  }
  if (expectedGeneration != null && target.generation != expectedGeneration) {
    throw CaughtUpBarrierException(
      CaughtUpBarrierErrorCode.invalidated,
      'checkpoint generation does not match the expected generation',
      targetCheckpoint: target.checkpoint,
    );
  }
}

void _assertCheckpoint(String checkpoint, {required bool local}) {
  if (_canonicalCheckpoint.hasMatch(checkpoint)) return;
  throw CaughtUpBarrierException(
    local
        ? CaughtUpBarrierErrorCode.invalidLocalCheckpoint
        : CaughtUpBarrierErrorCode.invalidTarget,
    '${local ? 'local' : 'target'} checkpoint must be a canonical unsigned decimal string',
    targetCheckpoint: local ? null : checkpoint,
    localCheckpoint: local ? checkpoint : null,
  );
}

Future<T> _boundedForCaller<T>(
  Future<T> operation, {
  required Duration remaining,
  required String target,
  String? local,
  CaughtUpCancellationToken? cancellation,
}) async {
  if (cancellation?.isCancelled ?? false) {
    throw CaughtUpBarrierException(
      CaughtUpBarrierErrorCode.cancelled,
      'caught-up wait was cancelled',
      targetCheckpoint: target,
      localCheckpoint: local,
    );
  }
  if (remaining <= Duration.zero) {
    throw CaughtUpBarrierException(
      CaughtUpBarrierErrorCode.timeout,
      'caught-up wait timed out before the durable checkpoint reached the target',
      targetCheckpoint: target,
      localCheckpoint: local,
    );
  }

  final timeout = Future<T>.delayed(remaining, () {
    throw CaughtUpBarrierException(
      CaughtUpBarrierErrorCode.timeout,
      'caught-up wait timed out before the durable checkpoint reached the target',
      targetCheckpoint: target,
      localCheckpoint: local,
    );
  });
  if (cancellation == null) {
    return Future.any<T>(<Future<T>>[operation, timeout]);
  }
  final cancelled = cancellation.whenCancelled.then<T>((_) {
    throw CaughtUpBarrierException(
      CaughtUpBarrierErrorCode.cancelled,
      'caught-up wait was cancelled',
      targetCheckpoint: target,
      localCheckpoint: local,
    );
  });
  // Losing this race never cancels `operation`. In particular, a caller timing
  // out must not stop ProtocolSyncLoop.syncNow(), which may be shared by other
  // waiters or background synchronization.
  return Future.any<T>(<Future<T>>[operation, timeout, cancelled]);
}

Future<CaughtUpResult> awaitCaughtUp(
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
  if (timeout.isNegative || pollInterval.isNegative) {
    throw RangeError('timeout and pollInterval must be non-negative');
  }
  validateAuthoritativeCheckpointTarget(
    target,
    expectedGeneration: expectedGeneration,
  );
  final clock = now ?? DateTime.now;
  final online = isOnline ?? loop.isOnline;
  final startedAt = clock();
  final deadline = startedAt.add(timeout);
  var checkpoint = await queue.pullCheckpoint();
  _assertCheckpoint(checkpoint, local: true);

  if (checkpointReached(checkpoint, target.checkpoint)) {
    return CaughtUpResult(
      targetCheckpoint: target.checkpoint,
      checkpoint: checkpoint,
      generation: target.generation,
      elapsed: clock().difference(startedAt),
      cycles: 0,
      alreadyCaughtUp: true,
    );
  }

  var cycles = 0;
  while (true) {
    if (cancellation?.isCancelled ?? false) {
      throw CaughtUpBarrierException(
        CaughtUpBarrierErrorCode.cancelled,
        'caught-up wait was cancelled',
        targetCheckpoint: target.checkpoint,
        localCheckpoint: checkpoint,
      );
    }
    if (!online() || loop.state.status == ProtocolSyncStatus.offline) {
      throw CaughtUpBarrierException(
        CaughtUpBarrierErrorCode.offline,
        'cannot establish authoritative freshness while offline',
        targetCheckpoint: target.checkpoint,
        localCheckpoint: checkpoint,
      );
    }
    var remaining = deadline.difference(clock());
    if (remaining <= Duration.zero) {
      throw CaughtUpBarrierException(
        CaughtUpBarrierErrorCode.timeout,
        'caught-up wait timed out before the durable checkpoint reached the target',
        targetCheckpoint: target.checkpoint,
        localCheckpoint: checkpoint,
      );
    }

    final before = checkpoint;
    await _boundedForCaller<ProtocolSyncCycleResult>(
      loop.syncNow(),
      remaining: remaining,
      target: target.checkpoint,
      local: checkpoint,
      cancellation: cancellation,
    );
    cycles++;

    // Durable storage is the only freshness evidence; the in-memory cycle
    // result is intentionally ignored here.
    checkpoint = await queue.pullCheckpoint();
    _assertCheckpoint(checkpoint, local: true);
    if (checkpointReached(checkpoint, target.checkpoint)) {
      return CaughtUpResult(
        targetCheckpoint: target.checkpoint,
        checkpoint: checkpoint,
        generation: target.generation,
        elapsed: clock().difference(startedAt),
        cycles: cycles,
        alreadyCaughtUp: false,
      );
    }

    if (checkpoint == before && pollInterval > Duration.zero) {
      remaining = deadline.difference(clock());
      final delay = pollInterval < remaining ? pollInterval : remaining;
      await _boundedForCaller<void>(
        Future<void>.delayed(delay),
        remaining: remaining,
        target: target.checkpoint,
        local: checkpoint,
        cancellation: cancellation,
      );
    }
  }
}

Future<CaughtUpResult> requestAndAwaitCaughtUp(
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
  if (timeout.isNegative) throw RangeError('timeout must be non-negative');
  final clock = now ?? DateTime.now;
  final startedAt = clock();
  final requestCancellation = CaughtUpCancellationToken();
  StreamSubscription<void>? mirror;
  if (cancellation != null) {
    if (cancellation.isCancelled) {
      requestCancellation.cancel();
    } else {
      // A tiny stream bridge keeps request cancellation independent from the
      // later shared sync cycle.
      mirror = Stream<void>.fromFuture(cancellation.whenCancelled)
          .listen((_) => requestCancellation.cancel());
    }
  }
  try {
    final target = await _boundedForCaller<AuthoritativeCheckpointTarget>(
      requester.requestCheckpoint(requestCancellation),
      remaining: timeout,
      target: '0',
      cancellation: cancellation,
    );
    final elapsed = clock().difference(startedAt);
    final remaining = timeout - elapsed;
    return awaitCaughtUp(
      loop,
      queue,
      target,
      timeout: remaining.isNegative ? Duration.zero : remaining,
      pollInterval: pollInterval,
      cancellation: cancellation,
      expectedGeneration: expectedGeneration,
      isOnline: isOnline,
      now: clock,
    );
  } on CaughtUpBarrierException catch (error) {
    if (error.code == CaughtUpBarrierErrorCode.timeout ||
        error.code == CaughtUpBarrierErrorCode.cancelled) {
      requestCancellation.cancel();
    }
    rethrow;
  } finally {
    await mirror?.cancel();
  }
}
