import 'dart:async';
import 'dart:collection';

import 'package:rxdart/rxdart.dart';

import 'contracts.dart';

typedef ReactiveProjector<T> =
    FutureOr<T?> Function(T? authoritative, T? localView, bool localPending);

typedef SameProjectedValue<T> = bool Function(T? left, T? right);

final class SyncRecordSource<T> {
  const SyncRecordSource({required this.name, required this.events});

  final String name;
  final Stream<SyncRecordEvent<T>> Function(SyncSessionIdentity identity)
  events;
}

final class ReactiveRecordSnapshot<T> {
  const ReactiveRecordSnapshot({
    required this.session,
    required this.table,
    required this.recordId,
    required this.value,
    required this.local,
    required this.authoritative,
    required this.lastEvent,
  });

  final SyncSessionIdentity session;
  final String table;
  final String recordId;
  final T? value;
  final SyncRecordEvent<T>? local;
  final SyncRecordEvent<T>? authoritative;
  final SyncRecordEvent<T> lastEvent;
}

/// RxDart controller for one complete UI record projection.
///
/// `switchMap` cancels stale session sources. `MergeStream` combines local,
/// HTTP, WebSocket, TCP, and Supabase streams. A BehaviorSubject gives late UI
/// subscribers the current projection while explicit `dispose` releases every
/// source subscription.
final class ReactiveRecordController<T> {
  ReactiveRecordController({
    required Stream<SyncSession> sessions,
    required this.table,
    required this.recordId,
    required List<SyncRecordSource<T>> sources,
    ReactiveProjector<T>? project,
    SameProjectedValue<T>? sameValue,
    this.onSourceError,
    this.maxRememberedEvents = 2048,
  }) : _sessions = sessions,
       _sources = List<SyncRecordSource<T>>.unmodifiable(sources),
       _project = project ?? _defaultProject,
       _sameValue = sameValue ?? _defaultSameValue {
    if (_sources.isEmpty) {
      throw ArgumentError.value(sources, 'sources', 'must not be empty');
    }
    if (maxRememberedEvents < 32) {
      throw ArgumentError.value(
        maxRememberedEvents,
        'maxRememberedEvents',
        'must be at least 32',
      );
    }
  }

  final Stream<SyncSession> _sessions;
  final String table;
  final String recordId;
  final List<SyncRecordSource<T>> _sources;
  final ReactiveProjector<T> _project;
  final SameProjectedValue<T> _sameValue;
  final void Function(String source, Object error, StackTrace stackTrace)?
  onSourceError;
  final int maxRememberedEvents;

  final BehaviorSubject<ReactiveRecordSnapshot<T>> _subject =
      BehaviorSubject<ReactiveRecordSnapshot<T>>();
  final LinkedHashSet<String> _seen = LinkedHashSet<String>();
  StreamSubscription<ReactiveRecordSnapshot<T>?>? _subscription;
  SyncSessionIdentity? _identity;
  SyncRecordEvent<T>? _local;
  SyncRecordEvent<T>? _authoritative;
  T? _value;
  bool _started = false;

  ValueStream<ReactiveRecordSnapshot<T>> get stream => _subject.stream;

  Future<void> start() async {
    if (_started) return;
    _started = true;
    final switched = _sessions.distinct(_sameSession).switchMap((session) {
      final identity = requireAuthenticated(session);
      _identity = identity;
      _local = null;
      _authoritative = null;
      _value = null;
      _seen.clear();
      final generation = transportSessionKey(identity);
      return MergeStream<SyncRecordEvent<T>>(
        _sources.map(
          (source) => source
              .events(identity)
              .transform(
                StreamTransformer<
                  SyncRecordEvent<T>,
                  SyncRecordEvent<T>
                >.fromHandlers(
                  handleError: (error, stackTrace, sink) {
                    onSourceError?.call(source.name, error, stackTrace);
                    // Individual transport errors are diagnostics. The transport
                    // owns reconnection; one error must not log out or terminate
                    // the complete local UI projection.
                  },
                ),
              ),
        ),
      ).where(
        (event) =>
            event.sessionPartition == generation &&
            event.table == table &&
            event.recordId == recordId,
      );
    });
    _subscription = switched
        .asyncMap(_apply)
        .listen(
          (snapshot) {
            if (snapshot != null && !_subject.isClosed) _subject.add(snapshot);
          },
          onError: (Object error, StackTrace stackTrace) {
            if (!_subject.isClosed) _subject.addError(error, stackTrace);
          },
        );
  }

  Future<ReactiveRecordSnapshot<T>?> _apply(SyncRecordEvent<T> event) async {
    final key = recordEventDedupeKey(event);
    if (!_seen.add(key)) return null;
    if (_seen.length > maxRememberedEvents) _seen.remove(_seen.first);

    if (event.authority == SyncRecordAuthority.localView) {
      _local = event;
    } else {
      _authoritative = event;
    }
    final projected = await _project(
      _authoritative?.payload,
      _local?.payload,
      _local?.pending ?? false,
    );
    if (_sameValue(_value, projected) &&
        event.authority != SyncRecordAuthority.localView) {
      return null;
    }
    _value = projected;
    return ReactiveRecordSnapshot<T>(
      session: _identity!,
      table: table,
      recordId: recordId,
      value: projected,
      local: _local,
      authoritative: _authoritative,
      lastEvent: event,
    );
  }

  Future<void> dispose() async {
    if (!_started) {
      await _subject.close();
      return;
    }
    _started = false;
    await _subscription?.cancel();
    _subscription = null;
    await _subject.close();
  }

  static bool _sameSession(SyncSession previous, SyncSession next) {
    if (previous is AuthenticatedSyncSession &&
        next is AuthenticatedSyncSession) {
      return transportSessionKey(previous.identity) ==
          transportSessionKey(next.identity);
    }
    return previous.runtimeType == next.runtimeType;
  }

  static T? _defaultProject<T>(
    T? authoritative,
    T? localView,
    bool localPending,
  ) => localPending ? localView : authoritative ?? localView;

  static bool _defaultSameValue<T>(T? left, T? right) =>
      stableJson(left) == stableJson(right);
}
