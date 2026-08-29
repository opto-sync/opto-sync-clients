import 'dart:async';
import 'dart:math';

typedef ProtocolJson = Map<String, dynamic>;

/// Durable protocol queue operations required by [ProtocolSyncLoop].
///
/// [OptoSyncClient] implements this interface. Applications may implement it
/// over another SQLite schema when authoritative rows and checkpoint metadata
/// need to share one transaction.
abstract interface class ProtocolQueueAdapter {
  Future<ProtocolJson> protocolPushRequest({int limit = 100});
  Future<int> acknowledgePush(ProtocolJson response, ProtocolJson request);
  Future<String> pullCheckpoint();
  Future<void> setPullCheckpoint(String checkpoint);
  Future<void> installSnapshot(
    ProtocolJson snapshot,
    Future<void> Function(List<ProtocolJson> records) replaceAuthoritative,
  );
}

/// Cooperative cancellation exposed to application transports.
///
/// Dart HTTP stacks use different cancellation primitives, so the SDK does not
/// select one. A transport should check this token around network operations
/// and bridge it to its client's cancellation facility when one exists.
class ProtocolCancellationToken {
  bool _cancelled = false;

  bool get isCancelled => _cancelled;

  void throwIfCancelled() {
    if (_cancelled) throw const ProtocolSyncCancelled();
  }

  void _cancel() => _cancelled = true;
}

class ProtocolSyncCancelled implements Exception {
  const ProtocolSyncCancelled();

  @override
  String toString() => 'ProtocolSyncCancelled';
}

/// Application-owned network boundary.
///
/// Implementations own URLs, authentication, token refresh, and HTTP status
/// mapping. Return a `RESET_REQUIRED` body from [pull] unchanged. Throw
/// [SyncTransportException] with `retryable: false` for permanent failures.
abstract interface class ProtocolTransport {
  Future<ProtocolJson> push(
    ProtocolJson request,
    ProtocolCancellationToken cancellation,
  );

  Future<ProtocolJson> pull(
    String checkpoint,
    int limit,
    ProtocolCancellationToken cancellation,
  );

  Future<ProtocolJson> snapshot(
    ProtocolCancellationToken cancellation, [
    ProtocolJson? reset,
  ]);
}

abstract interface class ProtocolSyncCallbacks {
  /// Apply a pull page idempotently.
  ///
  /// The checkpoint advances only after this completes. If the two stores
  /// cannot share a transaction, a crash between them replays this page.
  Future<void> applyChanges(List<ProtocolJson> changes);

  /// Atomically replace the authoritative store during retention reset.
  Future<void> replaceAuthoritative(List<ProtocolJson> records);
}

/// Optional callbacks for authoritative rows and checkpoint metadata that
/// share one transactional store.
///
/// The loop verifies [ProtocolQueueAdapter.pullCheckpoint] after each callback
/// and fails permanently if the callback returned without persisting it.
abstract interface class AtomicProtocolSyncCallbacks
    implements ProtocolSyncCallbacks {
  Future<void> applyChangesAndCheckpoint(
    List<ProtocolJson> changes,
    String checkpoint,
  );

  Future<void> replaceAuthoritativeAndCheckpoint(
    List<ProtocolJson> records,
    String checkpoint,
  );
}

enum ProtocolSyncStatus { stopped, idle, syncing, offline, backoff, error }

class ProtocolSyncState {
  final ProtocolSyncStatus status;
  final int consecutiveFailures;
  final DateTime? nextRetryAt;
  final String? lastError;

  const ProtocolSyncState({
    required this.status,
    this.consecutiveFailures = 0,
    this.nextRetryAt,
    this.lastError,
  });

  ProtocolSyncState copyWith({
    ProtocolSyncStatus? status,
    int? consecutiveFailures,
    DateTime? nextRetryAt,
    bool clearNextRetryAt = false,
    String? lastError,
    bool clearLastError = false,
  }) => ProtocolSyncState(
    status: status ?? this.status,
    consecutiveFailures: consecutiveFailures ?? this.consecutiveFailures,
    nextRetryAt: clearNextRetryAt ? null : nextRetryAt ?? this.nextRetryAt,
    lastError: clearLastError ? null : lastError ?? this.lastError,
  );
}

class ProtocolSyncCycleResult {
  final int pushedMutations;
  final int acknowledgedMutations;
  final int pulledChanges;
  final int installedSnapshots;
  final String checkpoint;
  final bool hasMorePending;

  const ProtocolSyncCycleResult({
    required this.pushedMutations,
    required this.acknowledgedMutations,
    required this.pulledChanges,
    required this.installedSnapshots,
    required this.checkpoint,
    required this.hasMorePending,
  });
}

class SyncTransportException implements Exception {
  final String message;
  final bool retryable;
  final Duration? retryAfter;
  final String code;

  const SyncTransportException(
    this.message, {
    this.retryable = true,
    this.retryAfter,
    this.code = 'SYNC_TRANSPORT_ERROR',
  });

  @override
  String toString() => 'SyncTransportException($code): $message';
}

Duration computeProtocolRetryDelay(
  int consecutiveFailure, {
  Duration base = const Duration(milliseconds: 500),
  Duration maximum = const Duration(seconds: 30),
  double Function()? random,
  Duration retryAfter = Duration.zero,
}) {
  if (consecutiveFailure < 1 ||
      base <= Duration.zero ||
      maximum < base ||
      retryAfter < Duration.zero) {
    throw RangeError('invalid retry policy');
  }
  final sample = (random ?? Random().nextDouble)();
  if (!sample.isFinite || sample < 0 || sample > 1) {
    throw RangeError.range(sample, 0, 1, 'random()');
  }
  final exponent = min(consecutiveFailure - 1, 30);
  final exponential = base.inMilliseconds * pow(2, exponent);
  final ceiling = min(maximum.inMilliseconds, exponential).toInt();
  final jittered = (ceiling * sample).ceil();
  return Duration(milliseconds: max(jittered, retryAfter.inMilliseconds));
}

final RegExp _canonicalDecimal = RegExp(r'^(?:0|[1-9]\d*)$');
final RegExp _positiveDecimal = RegExp(r'^[1-9]\d*$');

bool _isObject(Object? value) =>
    value is Map && value.keys.every((key) => key is String);

ProtocolJson _asProtocolObject(Object? value, String message) {
  if (!_isObject(value)) {
    throw SyncTransportException(message, retryable: false);
  }
  return Map<String, dynamic>.from(value as Map);
}

void _validateSnapshot(ProtocolJson snapshot, String priorCheckpoint) {
  final checkpoint = snapshot['checkpoint'];
  final records = snapshot['records'];
  if (snapshot['protocolVersion'] != 1 ||
      checkpoint is! String ||
      !_canonicalDecimal.hasMatch(checkpoint) ||
      BigInt.parse(checkpoint) < BigInt.parse(priorCheckpoint) ||
      records is! List) {
    throw const SyncTransportException(
      'invalid protocol snapshot response',
      retryable: false,
    );
  }
  for (final raw in records) {
    final record = _asProtocolObject(raw, 'invalid protocol snapshot record');
    if (record['table'] is! String ||
        (record['table'] as String).isEmpty ||
        record['recordId'] is! String ||
        (record['recordId'] as String).isEmpty ||
        !_isObject(record['record']) ||
        record['revision'] is! String ||
        !_positiveDecimal.hasMatch(record['revision'] as String)) {
      throw const SyncTransportException(
        'invalid protocol snapshot record',
        retryable: false,
      );
    }
  }
}

List<ProtocolJson> _validatePullPage(
  ProtocolJson pulled,
  String priorCheckpoint,
) {
  final checkpoint = pulled['checkpoint'];
  final rawChanges = pulled['changes'];
  if (pulled['protocolVersion'] != 1 ||
      checkpoint is! String ||
      !_canonicalDecimal.hasMatch(checkpoint) ||
      BigInt.parse(checkpoint) < BigInt.parse(priorCheckpoint) ||
      pulled['hasMore'] is! bool ||
      rawChanges is! List) {
    throw const SyncTransportException(
      'invalid protocol pull response',
      retryable: false,
    );
  }

  var last = BigInt.parse(priorCheckpoint);
  final pageCheckpoint = BigInt.parse(checkpoint);
  final changes = <ProtocolJson>[];
  for (final raw in rawChanges) {
    final change = _asProtocolObject(raw, 'invalid protocol pull change');
    final changeCheckpoint = change['checkpoint'];
    final operation = change['operation'];
    final source = change['source'];
    if (changeCheckpoint is! String ||
        !_positiveDecimal.hasMatch(changeCheckpoint) ||
        BigInt.parse(changeCheckpoint) <= last ||
        BigInt.parse(changeCheckpoint) > pageCheckpoint ||
        change['table'] is! String ||
        (change['table'] as String).isEmpty ||
        change['recordId'] is! String ||
        (change['recordId'] as String).isEmpty ||
        (operation != 'upsert' && operation != 'delete') ||
        (operation == 'upsert'
            ? !_isObject(change['record'])
            : change['record'] != null) ||
        change['revision'] is! String ||
        !_positiveDecimal.hasMatch(change['revision'] as String) ||
        (source != null &&
            (!_isObject(source) ||
                source['clientId'] is! String ||
                (source['clientId'] as String).isEmpty ||
                source['mutationId'] is! String ||
                !_positiveDecimal.hasMatch(source['mutationId'] as String)))) {
      throw const SyncTransportException(
        'invalid protocol pull change',
        retryable: false,
      );
    }
    last = BigInt.parse(changeCheckpoint);
    changes.add(change);
  }
  return changes;
}

int _integerOption(
  int? value,
  int fallback,
  int minimum,
  int maximum,
  String name,
) {
  final resolved = value ?? fallback;
  if (resolved < minimum || resolved > maximum) {
    throw RangeError.range(resolved, minimum, maximum, name);
  }
  return resolved;
}

/// Cancellable timer handle owned by the protocol scheduler.
abstract interface class ProtocolSyncTimer {
  void cancel();
}

/// Injectable timer boundary for deterministic hosts and formal replay.
typedef ProtocolSyncTimerFactory =
    ProtocolSyncTimer Function(Duration delay, void Function() callback);

final class _SystemProtocolSyncTimer implements ProtocolSyncTimer {
  late final Timer _timer;

  _SystemProtocolSyncTimer(Duration delay, void Function() callback) {
    _timer = Timer(delay, callback);
  }

  @override
  void cancel() => _timer.cancel();
}

ProtocolSyncTimer _systemProtocolSyncTimer(
  Duration delay,
  void Function() callback,
) => _SystemProtocolSyncTimer(delay, callback);

/// Single-flight, transport-neutral protocol v1 synchronization.
///
/// A cycle catches up first, uploads immutable queue batches, then catches up
/// again. Realtime/WebSocket notifications call [hint]; the pull log remains
/// authoritative.
class ProtocolSyncLoop {
  final ProtocolQueueAdapter queue;
  final ProtocolTransport transport;
  final ProtocolSyncCallbacks callbacks;
  final int pushLimit;
  final int pullLimit;
  final int maxPushBatchesPerCycle;
  final int maxPullPagesPerPhase;
  final Duration retryBase;
  final Duration retryMaximum;
  final double Function()? random;
  final DateTime Function() now;
  final bool Function() isOnline;
  final ProtocolSyncTimerFactory timerFactory;
  final void Function(ProtocolSyncState state)? onStateChange;

  ProtocolSyncState _state = const ProtocolSyncState(
    status: ProtocolSyncStatus.stopped,
  );
  ProtocolSyncTimer? _timer;
  Future<ProtocolSyncCycleResult>? _inFlight;
  ProtocolCancellationToken? _cancellation;
  bool _started = false;
  bool _rerunRequested = false;
  int _generation = 0;

  ProtocolSyncLoop(
    this.queue,
    this.transport,
    this.callbacks, {
    int? pushLimit,
    int? pullLimit,
    int? maxPushBatchesPerCycle,
    int? maxPullPagesPerPhase,
    this.retryBase = const Duration(milliseconds: 500),
    this.retryMaximum = const Duration(seconds: 30),
    this.random,
    DateTime Function()? now,
    bool Function()? isOnline,
    ProtocolSyncTimerFactory? timerFactory,
    this.onStateChange,
  }) : pushLimit = _integerOption(pushLimit, 100, 1, 100, 'pushLimit'),
       pullLimit = _integerOption(pullLimit, 100, 1, 1000, 'pullLimit'),
       maxPushBatchesPerCycle = _integerOption(
         maxPushBatchesPerCycle,
         10,
         1,
         1000,
         'maxPushBatchesPerCycle',
       ),
       maxPullPagesPerPhase = _integerOption(
         maxPullPagesPerPhase,
         100,
         1,
         10000,
         'maxPullPagesPerPhase',
       ),
       now = now ?? DateTime.now,
       isOnline = isOnline ?? (() => true),
       timerFactory = timerFactory ?? _systemProtocolSyncTimer {
    computeProtocolRetryDelay(
      1,
      base: retryBase,
      maximum: retryMaximum,
      random: () => 0,
    );
  }

  ProtocolSyncState get state => _state;

  void start() {
    if (_started) return;
    _generation++;
    _started = true;
    if (!isOnline()) {
      _transition(
        _state.copyWith(
          status: ProtocolSyncStatus.offline,
          consecutiveFailures: 0,
          clearNextRetryAt: true,
        ),
      );
      return;
    }
    _transition(
      _state.copyWith(
        status: ProtocolSyncStatus.idle,
        consecutiveFailures: 0,
        clearNextRetryAt: true,
      ),
    );
    _schedule(Duration.zero);
  }

  void stop() {
    _generation++;
    _started = false;
    _rerunRequested = false;
    _timer?.cancel();
    _timer = null;
    _cancellation?._cancel();
    _transition(
      _state.copyWith(
        status: ProtocolSyncStatus.stopped,
        clearNextRetryAt: true,
      ),
    );
  }

  /// Wake after a durable local write, connectivity event, or live hint.
  void hint() {
    if (!_started) return;
    if (!isOnline()) {
      _enterOffline();
      return;
    }
    if (_state.status == ProtocolSyncStatus.offline) {
      _transition(
        _state.copyWith(
          status: ProtocolSyncStatus.idle,
          clearNextRetryAt: true,
        ),
      );
    }
    _rerunRequested = true;
    if (_inFlight != null) return;
    _timer?.cancel();
    _timer = null;
    _schedule(Duration.zero);
  }

  /// Run one cycle now. Concurrent callers receive the same future.
  Future<ProtocolSyncCycleResult> syncNow() {
    final existing = _inFlight;
    if (existing != null) {
      _rerunRequested = true;
      return existing;
    }
    final cancellation = ProtocolCancellationToken();
    final generation = _generation;
    _cancellation = cancellation;
    _transition(
      _state.copyWith(
        status: ProtocolSyncStatus.syncing,
        clearNextRetryAt: true,
        clearLastError: true,
      ),
    );
    late final Future<ProtocolSyncCycleResult> running;
    running = _performCycle(cancellation)
        .then((result) {
          if (generation != _generation) return result;
          _transition(
            ProtocolSyncState(
              status: _started
                  ? ProtocolSyncStatus.idle
                  : ProtocolSyncStatus.stopped,
            ),
          );
          return result;
        })
        .catchError((Object error, StackTrace stack) {
          if (generation == _generation) {
            _transition(
              _state.copyWith(
                status: _started
                    ? ProtocolSyncStatus.error
                    : ProtocolSyncStatus.stopped,
                lastError: _safeError(error),
                clearNextRetryAt: true,
              ),
            );
          }
          Error.throwWithStackTrace(error, stack);
        })
        .whenComplete(() {
          if (identical(_inFlight, running)) _inFlight = null;
          if (identical(_cancellation, cancellation)) _cancellation = null;
          if (generation != _generation &&
              _started &&
              isOnline() &&
              _rerunRequested) {
            _schedule(Duration.zero);
          }
        });
    _inFlight = running;
    return running;
  }

  Future<ProtocolSyncCycleResult> _performCycle(
    ProtocolCancellationToken cancellation,
  ) async {
    cancellation.throwIfCancelled();
    var pushed = 0;
    var acknowledged = 0;
    var pulled = 0;
    var snapshots = 0;

    Future<void> pullToCurrent() async {
      for (var page = 0; page < maxPullPagesPerPhase; page++) {
        cancellation.throwIfCancelled();
        final checkpoint = await queue.pullCheckpoint();
        final response = await transport.pull(
          checkpoint,
          pullLimit,
          cancellation,
        );
        cancellation.throwIfCancelled();
        if (response['error'] == 'RESET_REQUIRED') {
          if (response['protocolVersion'] != 1) {
            throw const SyncTransportException(
              'invalid protocol reset response',
              retryable: false,
            );
          }
          final snapshot = await transport.snapshot(cancellation, response);
          _validateSnapshot(snapshot, checkpoint);
          final syncCallbacks = callbacks;
          if (syncCallbacks is AtomicProtocolSyncCallbacks) {
            await syncCallbacks.replaceAuthoritativeAndCheckpoint(
              (snapshot['records'] as List)
                  .map((record) => Map<String, dynamic>.from(record as Map))
                  .toList(growable: false),
              snapshot['checkpoint'] as String,
            );
            if (await queue.pullCheckpoint() != snapshot['checkpoint']) {
              throw const SyncTransportException(
                'atomic snapshot callback did not persist its checkpoint',
                retryable: false,
              );
            }
          } else {
            await queue.installSnapshot(
              snapshot,
              callbacks.replaceAuthoritative,
            );
          }
          snapshots++;
          continue;
        }

        final changes = _validatePullPage(response, checkpoint);
        final syncCallbacks = callbacks;
        if (syncCallbacks is AtomicProtocolSyncCallbacks) {
          await syncCallbacks.applyChangesAndCheckpoint(
            changes,
            response['checkpoint'] as String,
          );
          if (await queue.pullCheckpoint() != response['checkpoint']) {
            throw const SyncTransportException(
              'atomic pull callback did not persist its checkpoint',
              retryable: false,
            );
          }
        } else {
          if (changes.isNotEmpty) {
            await callbacks.applyChanges(changes);
          }
          await queue.setPullCheckpoint(response['checkpoint'] as String);
        }
        pulled += changes.length;
        if (response['hasMore'] != true) return;
        if (response['checkpoint'] == checkpoint) {
          throw const SyncTransportException(
            'pull response hasMore without checkpoint progress',
            retryable: false,
          );
        }
      }
      throw const SyncTransportException(
        'pull page safety limit exceeded',
        retryable: false,
      );
    }

    await pullToCurrent();
    for (var batch = 0; batch < maxPushBatchesPerCycle; batch++) {
      cancellation.throwIfCancelled();
      final request = await queue.protocolPushRequest(limit: pushLimit);
      final mutations = request['mutations'];
      if (mutations is! List) {
        throw const SyncTransportException(
          'queue produced an invalid push request',
          retryable: false,
        );
      }
      if (mutations.isEmpty) break;
      final response = await transport.push(request, cancellation);
      pushed += mutations.length;
      acknowledged += await queue.acknowledgePush(response, request);
    }
    final remaining = await queue.protocolPushRequest(limit: 1);
    final remainingMutations = remaining['mutations'];
    if (remainingMutations is! List) {
      throw const SyncTransportException(
        'queue produced an invalid push request',
        retryable: false,
      );
    }
    await pullToCurrent();
    return ProtocolSyncCycleResult(
      pushedMutations: pushed,
      acknowledgedMutations: acknowledged,
      pulledChanges: pulled,
      installedSnapshots: snapshots,
      checkpoint: await queue.pullCheckpoint(),
      hasMorePending: remainingMutations.isNotEmpty,
    );
  }

  void _schedule(Duration delay) {
    if (!_started || _timer != null) return;
    final generation = _generation;
    late final ProtocolSyncTimer scheduled;
    scheduled = timerFactory(delay, () {
      final isCurrent = identical(_timer, scheduled);
      if (isCurrent) _timer = null;
      if (!isCurrent || generation != _generation || !_started) return;
      unawaited(_drive(generation));
    });
    _timer = scheduled;
  }

  Future<void> _drive(int generation) async {
    if (!_started || generation != _generation) return;
    if (_inFlight != null) {
      _rerunRequested = true;
      return;
    }
    if (!isOnline()) {
      _enterOffline();
      return;
    }
    _rerunRequested = false;
    try {
      final result = await syncNow();
      if (generation != _generation) return;
      if (_started && (_rerunRequested || result.hasMorePending)) {
        _schedule(Duration.zero);
      }
    } catch (error) {
      if (!_started ||
          generation != _generation ||
          error is ProtocolSyncCancelled) {
        return;
      }
      if (error is SyncTransportException && !error.retryable) {
        _transition(
          _state.copyWith(
            status: ProtocolSyncStatus.error,
            clearNextRetryAt: true,
          ),
        );
        return;
      }
      final failures = min(_state.consecutiveFailures + 1, 31);
      final delay = computeProtocolRetryDelay(
        failures,
        base: retryBase,
        maximum: retryMaximum,
        random: random,
        retryAfter: error is SyncTransportException
            ? error.retryAfter ?? Duration.zero
            : Duration.zero,
      );
      _transition(
        ProtocolSyncState(
          status: ProtocolSyncStatus.backoff,
          consecutiveFailures: failures,
          nextRetryAt: now().add(delay),
          lastError: _safeError(error),
        ),
      );
      _schedule(delay);
    }
  }

  void _enterOffline() {
    if (!_started || _state.status == ProtocolSyncStatus.offline) return;
    _generation++;
    _rerunRequested = false;
    _timer?.cancel();
    _timer = null;
    _cancellation?._cancel();
    _transition(
      _state.copyWith(
        status: ProtocolSyncStatus.offline,
        clearNextRetryAt: true,
      ),
    );
  }

  void _transition(ProtocolSyncState next) {
    _state = next;
    try {
      onStateChange?.call(next);
    } catch (_) {
      // Observability callbacks must not stop synchronization.
    }
  }
}

String _safeError(Object error) {
  final message = '$error';
  return message.length <= 200 ? message : message.substring(0, 200);
}
