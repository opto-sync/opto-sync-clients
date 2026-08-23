import 'dart:async';

/// UI-agnostic network state shared by opto-sync runtimes.
enum OptoSyncConnectivityState { unknown, offline, link, internet }

/// `offline` is an explicit user/application override, not a detector result.
enum OptoSyncConnectivityMode { automatic, offline }

enum OptoSyncConnectivitySource {
  initial,
  manual,
  platform,
  probe,
  forcedOffline,
}

final class OptoSyncConnectivitySnapshot {
  const OptoSyncConnectivitySnapshot({
    required this.state,
    required this.mode,
    required this.source,
    required this.changedAt,
    this.verifiedAt,
  });

  final OptoSyncConnectivityState state;
  final OptoSyncConnectivityMode mode;
  final OptoSyncConnectivitySource source;
  final DateTime changedAt;
  final DateTime? verifiedAt;

  bool get hasVerifiedInternet =>
      mode == OptoSyncConnectivityMode.automatic &&
      state == OptoSyncConnectivityState.internet;

  Map<String, Object?> toJson() => <String, Object?>{
    'state': state.name,
    'mode': mode.name,
    'source': source.name,
    'changedAt': changedAt.millisecondsSinceEpoch,
    if (verifiedAt case final value?)
      'verifiedAt': value.millisecondsSinceEpoch,
  };
}

abstract interface class OptoSyncConnectivityWatcher {
  OptoSyncConnectivitySnapshot get snapshot;
  Stream<OptoSyncConnectivitySnapshot> get changes;
  Stream<OptoSyncConnectivitySnapshot> snapshots({bool emitCurrent = true});
  void start();
  FutureOr<void> stop();
  void setMode(OptoSyncConnectivityMode mode);
  FutureOr<OptoSyncConnectivitySnapshot> refresh();
}

/// Push-driven watcher for Dart VM, tests, and Flutter/native bridges.
final class ManualOptoSyncConnectivityWatcher
    implements OptoSyncConnectivityWatcher {
  ManualOptoSyncConnectivityWatcher({
    OptoSyncConnectivityState initialState = OptoSyncConnectivityState.unknown,
    OptoSyncConnectivityMode initialMode = OptoSyncConnectivityMode.automatic,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now {
    final timestamp = _now();
    _automatic = OptoSyncConnectivitySnapshot(
      state: initialState,
      mode: OptoSyncConnectivityMode.automatic,
      source: OptoSyncConnectivitySource.initial,
      changedAt: timestamp,
    );
    _current = initialMode == OptoSyncConnectivityMode.offline
        ? OptoSyncConnectivitySnapshot(
            state: OptoSyncConnectivityState.offline,
            mode: OptoSyncConnectivityMode.offline,
            source: OptoSyncConnectivitySource.forcedOffline,
            changedAt: timestamp,
          )
        : _automatic;
  }

  final DateTime Function() _now;
  final StreamController<OptoSyncConnectivitySnapshot> _controller =
      StreamController<OptoSyncConnectivitySnapshot>.broadcast(sync: true);
  late OptoSyncConnectivitySnapshot _automatic;
  late OptoSyncConnectivitySnapshot _current;
  bool _closed = false;

  @override
  OptoSyncConnectivitySnapshot get snapshot => _current;

  @override
  Stream<OptoSyncConnectivitySnapshot> get changes => _controller.stream;

  @override
  Stream<OptoSyncConnectivitySnapshot> snapshots({
    bool emitCurrent = true,
  }) async* {
    if (emitCurrent) yield _current;
    yield* changes;
  }

  @override
  void start() {}

  @override
  Future<void> stop() async {}

  @override
  Future<OptoSyncConnectivitySnapshot> refresh() async => _current;

  @override
  void setMode(OptoSyncConnectivityMode mode) {
    if (_closed || mode == _current.mode) return;
    if (mode == OptoSyncConnectivityMode.offline) {
      _transition(
        state: OptoSyncConnectivityState.offline,
        mode: OptoSyncConnectivityMode.offline,
        source: OptoSyncConnectivitySource.forcedOffline,
      );
      return;
    }
    _transition(
      state: _automatic.state,
      mode: OptoSyncConnectivityMode.automatic,
      source: _automatic.source,
      verifiedAt: _automatic.verifiedAt,
    );
  }

  void setTotalOffline(bool enabled) => setMode(
    enabled
        ? OptoSyncConnectivityMode.offline
        : OptoSyncConnectivityMode.automatic,
  );

  /// Records a platform observation or successful end-to-end probe.
  OptoSyncConnectivitySnapshot publish(
    OptoSyncConnectivityState state, {
    OptoSyncConnectivitySource source = OptoSyncConnectivitySource.manual,
    DateTime? verifiedAt,
  }) {
    if (_closed) return _current;
    final observedAt = _now();
    final verified = state == OptoSyncConnectivityState.internet
        ? verifiedAt ?? observedAt
        : null;
    _automatic = OptoSyncConnectivitySnapshot(
      state: state,
      mode: OptoSyncConnectivityMode.automatic,
      source: source,
      changedAt: state == _automatic.state ? _automatic.changedAt : observedAt,
      verifiedAt: verified,
    );
    if (_current.mode == OptoSyncConnectivityMode.automatic) {
      _transition(
        state: state,
        mode: OptoSyncConnectivityMode.automatic,
        source: source,
        verifiedAt: verified,
      );
    }
    return _current;
  }

  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    await _controller.close();
  }

  void _transition({
    required OptoSyncConnectivityState state,
    required OptoSyncConnectivityMode mode,
    required OptoSyncConnectivitySource source,
    DateTime? verifiedAt,
  }) {
    final changed = state != _current.state || mode != _current.mode;
    _current = OptoSyncConnectivitySnapshot(
      state: state,
      mode: mode,
      source: source,
      changedAt: changed ? _now() : _current.changedAt,
      verifiedAt: verifiedAt,
    );
    if (changed) _controller.add(_current);
  }
}

enum OptoSyncSaveOperation { upsert, delete }

/// Metadata-only event emitted after a durable local queue commit.
final class OptoSyncLocalSaveEvent {
  const OptoSyncLocalSaveEvent({
    required this.queueId,
    required this.tableName,
    required this.recordId,
    required this.operation,
    required this.savedAt,
    required this.connectivity,
  });

  final Object queueId;
  final String tableName;
  final String recordId;
  final OptoSyncSaveOperation operation;
  final DateTime savedAt;
  final OptoSyncConnectivitySnapshot connectivity;
}

typedef OptoSyncLocalSaveHook =
    FutureOr<void> Function(OptoSyncLocalSaveEvent event);
typedef OptoSyncWakeHint = FutureOr<void> Function();

/// Adds post-commit save hooks to any Dart/Flutter opto-sync client without
/// importing UI packages. Wrap the existing queue call with [afterDurableSave],
/// or call [notifyAfterDurableSave] from a client implementation immediately
/// after its transaction commits.
final class OptoSyncConnectivitySaveSignals {
  OptoSyncConnectivitySaveSignals({
    required this.watcher,
    this.onSave,
    this.onOnlineSave,
    this.onMutationQueued,
  }) : _lastConnectivity = watcher.snapshot {
    _connectivitySubscription = watcher.changes.listen((next) {
      final previous = _lastConnectivity;
      _lastConnectivity = next;
      if (next.hasVerifiedInternet && !previous.hasVerifiedInternet) {
        _callWake();
      }
    });
  }

  final OptoSyncConnectivityWatcher watcher;
  final OptoSyncLocalSaveHook? onSave;
  final OptoSyncLocalSaveHook? onOnlineSave;
  OptoSyncWakeHint? onMutationQueued;
  final StreamController<OptoSyncLocalSaveEvent> _saveController =
      StreamController<OptoSyncLocalSaveEvent>.broadcast(sync: true);
  late OptoSyncConnectivitySnapshot _lastConnectivity;
  late final StreamSubscription<OptoSyncConnectivitySnapshot>
  _connectivitySubscription;
  bool _disposed = false;

  Stream<OptoSyncLocalSaveEvent> get saves => _saveController.stream;

  Stream<OptoSyncLocalSaveEvent> get onlineSaves =>
      saves.where((event) => event.connectivity.hasVerifiedInternet);

  void setTotalOffline(bool enabled) => watcher.setMode(
    enabled
        ? OptoSyncConnectivityMode.offline
        : OptoSyncConnectivityMode.automatic,
  );

  Future<T> afterDurableSave<T>({
    required Future<T> Function() save,
    required Object Function(T result) queueId,
    required String tableName,
    required String recordId,
    required OptoSyncSaveOperation operation,
  }) async {
    final result = await save();
    notifyAfterDurableSave(
      queueId: queueId(result),
      tableName: tableName,
      recordId: recordId,
      operation: operation,
    );
    return result;
  }

  void notifyAfterDurableSave({
    required Object queueId,
    required String tableName,
    required String recordId,
    required OptoSyncSaveOperation operation,
  }) {
    if (_disposed) return;
    final connectivity = watcher.snapshot;
    final event = OptoSyncLocalSaveEvent(
      queueId: queueId,
      tableName: tableName,
      recordId: recordId,
      operation: operation,
      savedAt: DateTime.now(),
      connectivity: connectivity,
    );
    _callHook(onSave, event);
    _saveController.add(event);
    if (connectivity.hasVerifiedInternet) {
      _callHook(onOnlineSave, event);
    }
    if (connectivity.mode == OptoSyncConnectivityMode.automatic &&
        connectivity.state != OptoSyncConnectivityState.offline) {
      _callWake();
    }
  }

  void setBackgroundSyncTrigger(OptoSyncWakeHint? trigger) {
    onMutationQueued = trigger;
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _connectivitySubscription.cancel();
    await _saveController.close();
  }

  void _callHook(OptoSyncLocalSaveHook? hook, OptoSyncLocalSaveEvent event) {
    if (hook == null) return;
    unawaited(Future<void>.sync(() => hook(event)).catchError((Object _) {}));
  }

  void _callWake() {
    final wake = onMutationQueued;
    if (wake == null) return;
    unawaited(Future<void>.sync(wake).catchError((Object _) {}));
  }
}
