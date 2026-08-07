/// RxDart read layer: one deduplicated stream per record.
///
/// Local-store-as-single-source-of-truth: remote bytes (HTTP pages, websocket
/// frames) never flow straight to the UI. The sync loop reconciles them
/// through the C merge core into the authoritative store, and [watchLocalView]
/// renders that store with pending optimistic writes rebased on top. Combining
/// "the streams" therefore reduces to combining two local signals, which makes
/// deduplication exact (canonical-JSON comparison) instead of heuristic.
library;

import 'package:drift/drift.dart';
import 'package:rxdart/rxdart.dart';

import '../../opto_sync_client.dart';
import 'canonical.dart';

/// Rows of this client's pending mutation queue, re-emitted after every
/// transaction that touches it (drift watch stream).
Stream<List<Mutation>> pendingMutationsStream(
  OptoSyncClient client, {
  String? tableName,
  String? recordId,
}) {
  final query = client.db.select(client.db.localMutations)
    ..where((t) => t.syncStatus.equals(SyncStatus.pending))
    ..orderBy([(t) => OrderingTerm.asc(t.id)]);
  if (tableName != null) {
    query.where((t) => t.targetTable.equals(tableName));
  }
  if (recordId != null) {
    query.where((t) => t.recordId.equals(recordId));
  }
  return query.watch();
}

/// True while anything still waits to reach the server — drive "saving…" /
/// "saved" UI from this, never from individual request futures.
Stream<bool> hasUnsyncedWorkStream(OptoSyncClient client) =>
    pendingMutationsStream(client).map((rows) => rows.isNotEmpty).distinct();

/// The render-ready view of one record: authoritative server state with this
/// client's un-pushed writes replayed on top, recomputed whenever either
/// side changes, deduplicated on canonical JSON.
///
/// [authoritative] is the application's authoritative-store stream for the
/// record (typically a drift `watchSingleOrNull()` mapped to JSON), kept
/// current by the sync loop's `applyChanges`. `null` means "not replicated
/// yet"; the stream then renders pending writes over an empty document.
Stream<Map<String, dynamic>?> watchLocalView({
  required OptoSyncClient client,
  required String tableName,
  required String recordId,
  required Stream<Map<String, dynamic>?> authoritative,
}) {
  final pending = pendingMutationsStream(
    client,
    tableName: tableName,
    recordId: recordId,
  );
  return Rx.combineLatest2<
        Map<String, dynamic>?,
        List<Mutation>,
        (Map<String, dynamic>?, int)
      >(authoritative, pending, (server, rows) => (server, rows.length))
      // switchMap: a superseded rebase computation is dropped, never raced.
      .switchMap((pair) {
        final (server, pendingCount) = pair;
        if (server == null && pendingCount == 0) {
          return Stream<Map<String, dynamic>?>.value(null);
        }
        return Stream.fromFuture(
          client.localView(tableName, recordId, server ?? const {}),
        );
      })
      .distinct(canonicalJsonEquals)
      .shareReplay(maxSize: 1);
}

/// The loop's state as a replay-1 stream, preserving any caller-supplied
/// `onStateChange`. Use with `ProtocolSyncLoop`'s constructor callback:
///
/// ```dart
/// final states = SyncStateSubject();
/// final loop = ProtocolSyncLoop(..., onStateChange: states.add);
/// states.stream.listen(renderStatus);
/// ```
class SyncStateSubject {
  final BehaviorSubject<ProtocolSyncState> _subject = BehaviorSubject();

  void add(ProtocolSyncState state) => _subject.add(state);

  ValueStream<ProtocolSyncState> get stream => _subject.stream;

  Future<void> close() => _subject.close();
}
