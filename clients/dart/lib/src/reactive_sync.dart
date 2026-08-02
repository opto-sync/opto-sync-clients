import 'dart:async';
import 'dart:convert';

import 'package:rxdart/rxdart.dart';

typedef ReactiveJson = Map<String, dynamic>;

/// RxDart's `shareReplay` retains one ReplaySubject after ref-count reaches
/// zero. For record streams that can retain an entire document indefinitely
/// and prevents a later subscriber from rebuilding fresh storage/network
/// subscriptions. This stream creates one shared replay generation while
/// listeners exist and tears the generation down when the final listener
/// leaves, matching RxJS `share({ resetOnRefCountZero: true })`.
final class _ResettingReplayStream<T> extends Stream<T> {
  final Stream<T> Function() _source;
  ReplaySubject<T>? _subject;
  StreamSubscription<T>? _upstream;

  _ResettingReplayStream(this._source);

  @override
  bool get isBroadcast => true;

  @override
  StreamSubscription<T> listen(
    void Function(T event)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) {
    final subject = _subject ??= _newSubject();
    return subject.stream.listen(
      onData,
      onError: onError,
      onDone: onDone,
      cancelOnError: cancelOnError,
    );
  }

  ReplaySubject<T> _newSubject() {
    late final ReplaySubject<T> subject;
    subject = ReplaySubject<T>(
      maxSize: 1,
      onListen: () => _connect(subject),
      onCancel: () => _disconnect(subject),
    );
    return subject;
  }

  void _connect(ReplaySubject<T> subject) {
    var terminatedSynchronously = false;
    final subscription = _source().listen(
      subject.add,
      onError: (Object error, StackTrace stack) {
        terminatedSynchronously = true;
        subject.addError(error, stack);
        _finish(subject);
      },
      onDone: () {
        terminatedSynchronously = true;
        _finish(subject);
      },
      cancelOnError: true,
    );
    if (terminatedSynchronously || !identical(_subject, subject)) {
      unawaited(subscription.cancel());
    } else {
      _upstream = subscription;
    }
  }

  void _disconnect(ReplaySubject<T> subject) {
    if (!identical(_subject, subject)) return;
    _subject = null;
    final upstream = _upstream;
    _upstream = null;
    if (upstream != null) unawaited(upstream.cancel());
    unawaited(subject.close());
  }

  void _finish(ReplaySubject<T> subject) {
    if (identical(_subject, subject)) {
      _subject = null;
      _upstream = null;
    }
    unawaited(subject.close());
  }
}

enum ReactiveSyncSource {
  indexedDb,
  sqlite,
  http,
  webSocket,
  tcp,
  supabase,
  blob,
}

final class SyncRecordEnvelope {
  final String tableName;
  final String recordId;
  final ReactiveSyncSource source;
  final ReactiveJson? record;
  final String? version;
  final DateTime receivedAt;

  SyncRecordEnvelope({
    required this.tableName,
    required this.recordId,
    required this.source,
    required this.record,
    this.version,
    DateTime? receivedAt,
  }) : receivedAt = receivedAt ?? DateTime.now();
}

Object? _canonicalize(Object? value) {
  if (value is List) return value.map(_canonicalize).toList(growable: false);
  if (value is Map) {
    final keys = value.keys.map((key) => key.toString()).toList()..sort();
    return <String, Object?>{
      for (final key in keys) key: _canonicalize(value[key]),
    };
  }
  return value;
}

/// Stable structural fingerprint used only for stream de-duplication.
String canonicalReactiveJson(Object? value) => jsonEncode(_canonicalize(value));

typedef ReconcileReactiveRecord =
    ReactiveJson Function(ReactiveJson incoming, ReactiveJson existing);
typedef RenderLocalRecord =
    Future<ReactiveJson?> Function(ReactiveJson authoritative);

/// Combines SQLite/IndexedDB, HTTP, WebSocket, TCP, Supabase, and blob streams.
///
/// Source events are processed with `asyncMap`, which preserves arrival order
/// while [renderLocal] reads the pending durable queue. `switchMap` would drop
/// emissions from an older async queue read without cancelling that read. The
/// shared replay buffer is released when the final listener leaves.
Stream<ReactiveJson?> createReactiveRecordStream({
  required String tableName,
  required String recordId,
  required Iterable<Stream<SyncRecordEnvelope>> sources,
  required ReconcileReactiveRecord reconcile,
  required RenderLocalRecord renderLocal,
  ReactiveJson? initial,
  bool Function(ReactiveJson? left, ReactiveJson? right)? equals,
}) {
  final sourceList = sources.toList(growable: false);
  if (sourceList.isEmpty && initial == null) {
    return Stream<ReactiveJson?>.value(null);
  }
  final compare =
      equals ??
      (left, right) =>
          canonicalReactiveJson(left) == canonicalReactiveJson(right);

  final cold = Rx.defer<ReactiveJson?>(() {
    ReactiveJson? authoritative = initial;
    final events = sourceList.isEmpty
        ? Stream<SyncRecordEnvelope>.value(
            SyncRecordEnvelope(
              tableName: tableName,
              recordId: recordId,
              source: ReactiveSyncSource.blob,
              record: authoritative,
            ),
          )
        : Rx.merge(sourceList);
    return events
        .where(
          (event) => event.tableName == tableName && event.recordId == recordId,
        )
        .asyncMap((event) async {
          final incoming = event.record;
          if (incoming == null) {
            authoritative = null;
            return null;
          }
          final existing = authoritative;
          authoritative = existing == null
              ? Map<String, dynamic>.from(incoming)
              : reconcile(incoming, existing);
          return renderLocal(authoritative!);
        });
  }).distinct(compare);
  return _ResettingReplayStream(() => cold);
}

/// Turns realtime wakeups into latest-only HTTP reads.
///
/// RxDart unsubscribes from the older `Stream.fromFuture` when a new hint
/// arrives, so a late stale result is not emitted even though Dart Futures
/// themselves are not cancellable.
Stream<T> createRemoteRefreshStream<T>(
  Stream<Object?> hints,
  Future<T> Function() load,
) {
  return _ResettingReplayStream(
    () => hints.startWith(null).switchMap((_) => Stream<T>.fromFuture(load())),
  );
}

StreamSubscription<Object?> connectReactiveSyncHints(
  Stream<Object?> hints,
  void Function() hint, {
  void Function(Object error, StackTrace stack)? onError,
}) {
  return hints.listen((_) => hint(), onError: onError);
}

enum OptimismLevel {
  /// Send to the server first and install only its confirmed response.
  serverConfirmed('server-confirmed'),

  /// Commit to SQLite/IndexedDB and return; an OS worker performs network I/O.
  durableLocal('durable-local'),

  /// Commit locally, start a sync cycle immediately, and await that cycle.
  durableLocalAndWait('durable-local-and-wait');

  final String wireName;

  const OptimismLevel(this.wireName);
}

sealed class ReactiveWriteResult<RemoteResult, LocalResult> {
  final OptimismLevel optimism;

  const ReactiveWriteResult(this.optimism);
}

final class ServerConfirmedWrite<RemoteResult, LocalResult>
    extends ReactiveWriteResult<RemoteResult, LocalResult> {
  final RemoteResult remote;

  const ServerConfirmedWrite(this.remote)
    : super(OptimismLevel.serverConfirmed);
}

final class DurableLocalWrite<RemoteResult, LocalResult>
    extends ReactiveWriteResult<RemoteResult, LocalResult> {
  final LocalResult local;

  const DurableLocalWrite(this.local, OptimismLevel optimism)
    : assert(
        optimism == OptimismLevel.durableLocal ||
            optimism == OptimismLevel.durableLocalAndWait,
      ),
      super(optimism);
}

/// Executes one write under an explicit durability/optimism policy.
///
/// When an immediate sync fails, the local mutation remains durable and can be
/// retried by WorkManager, BGTaskScheduler, or the foreground sync loop.
Future<ReactiveWriteResult<RemoteResult, LocalResult>>
executeReactiveWrite<RemoteResult, LocalResult>({
  required OptimismLevel optimism,
  required Future<RemoteResult> Function() remoteWrite,
  required Future<LocalResult> Function() queueLocal,
  Future<void> Function(RemoteResult result)? installRemote,
  FutureOr<void> Function()? requestBackgroundSync,
  Future<void> Function()? syncNow,
}) async {
  if (optimism == OptimismLevel.serverConfirmed) {
    final remote = await remoteWrite();
    await installRemote?.call(remote);
    return ServerConfirmedWrite<RemoteResult, LocalResult>(remote);
  }

  final local = await queueLocal();
  await requestBackgroundSync?.call();
  if (optimism == OptimismLevel.durableLocalAndWait) {
    final immediate = syncNow;
    if (immediate == null) {
      throw ArgumentError('durable-local-and-wait requires syncNow');
    }
    await immediate();
  }
  return DurableLocalWrite<RemoteResult, LocalResult>(local, optimism);
}
