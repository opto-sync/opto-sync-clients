import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:syncer/syncer.dart' as syncer_ffi;

export 'package:syncer/syncer.dart'
    show ArrayMergeStrategy, ArrayStrategy, resolveSyncerLibraryPath;
export 'src/clock.dart';

part 'opto_sync_client.g.dart';

/// The internal table used to queue offline optimistic mutations.
///
/// Getters are standard camelCase — drift derives the snake_case SQL column
/// names (record_id, json_payload, ...) itself. The one exception is
/// [targetTable]: `tableName` is reserved by drift's own `Table.tableName`
/// API, so the getter is named differently and pinned to the original
/// `table_name` SQL column explicitly.
@DataClassName('Mutation')
class LocalMutations extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get targetTable => text().named('table_name')();
  TextColumn get recordId => text()();
  TextColumn get jsonPayload => text()();
  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();

  /// 0 = pending, 1 = synced, 2 = failed.
  IntColumn get syncStatus => integer().withDefault(const Constant(0))();
}

/// Small key/value table for client state that is not a mutation: the durable
/// device id and the hybrid logical clock's last issued timestamp.
///
/// Kept in the same database as the queue deliberately — the clock must not be
/// able to move backwards relative to writes that are still queued, and one
/// store makes that a single atomic unit for backup and restore.
@DataClassName('MetaEntry')
class Meta extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column> get primaryKey => {key};
}

/// Sync status values for [LocalMutations.syncStatus].
abstract final class SyncStatus {
  static const int pending = 0;
  static const int synced = 1;
  static const int failed = 2;
}

/// [Meta] key holding the durable per-install device id.
const String metaDeviceIdKey = 'hlc.nodeId';

/// [Meta] key holding the clock's last issued timestamp.
const String metaClockKey = 'hlc.last';

@DriftDatabase(tables: [LocalMutations, Meta])
class OptoSyncDatabase extends _$OptoSyncDatabase {
  OptoSyncDatabase(super.e);

  /// v1 shipped with only `local_mutations`; v2 adds `meta` for clock state.
  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) => m.createAll(),
        onUpgrade: (m, from, to) async {
          if (from < 2) {
            // Create ONLY the new table. Recreating the schema (or bumping the
            // version without a migration, which makes drift throw and tempts
            // integrators into deleting the file) would drop `local_mutations`
            // and silently discard the user's un-synced work — exactly the work
            // an offline-first queue exists to protect.
            await m.createTable(meta);
          }
        },
      );
}

/// Abstract syncer to avoid hard coupling to the FFI layer.
///
/// Implementations must NOT signal failure by returning '' or another
/// sentinel — they should throw (see [SyncerMergeException]).
abstract class ISyncer {
  String merge(String base, String incoming);
}

/// Thrown when the native syncer core fails to merge two documents
/// (e.g. one of them is not valid JSON).
class SyncerMergeException implements Exception {
  final String message;
  SyncerMergeException(this.message);

  @override
  String toString() => 'SyncerMergeException: $message';
}

/// [ISyncer] backed by the syncer.c native core via package:syncer.
///
/// Defaults implement the opto-sync reconciliation policy:
/// timestamp-based CRDT resolution with Last-Write-Wins on
/// `updatedAt`/`syncedAt`, First-Write-Wins on `createdAt`, and
/// arrays of objects merged element-wise by their `id`. Every option is
/// overridable via the constructor.
class FfiSyncer implements ISyncer {
  final syncer_ffi.Syncer _native;

  final bool resolveByTimestamp;
  final String? lwwKeys;
  final String? fwwKeys;
  final syncer_ffi.ArrayMergeStrategy arrayStrategy;
  final String? arrayMatchKeys;
  final int maxDepth;
  final bool detectCircularRefs;

  /// [libraryPath] locates the native library; when omitted it is resolved
  /// via [syncer_ffi.resolveSyncerLibraryPath] (SYNCER_LIB_PATH env var, then
  /// a platform-named libsyncer next to the current directory).
  FfiSyncer({
    String? libraryPath,
    this.resolveByTimestamp = true,
    this.lwwKeys = 'updatedAt,syncedAt',
    this.fwwKeys = 'createdAt',
    this.arrayStrategy = syncer_ffi.ArrayMergeStrategy.mergeByKey,
    this.arrayMatchKeys = 'id',
    this.maxDepth = 0,
    this.detectCircularRefs = false,
  }) : _native = syncer_ffi.Syncer(
            libraryPath ?? syncer_ffi.resolveSyncerLibraryPath());

  /// Version of the loaded native core ("major.minor.patch").
  String get nativeVersion => _native.version;

  /// A copy of this syncer with timestamp resolution disabled, for replaying
  /// this client's own un-confirmed writes. See [rebasePending] for why the
  /// overlay must not be timestamp-gated.
  FfiSyncer overlay({String? libraryPath}) => FfiSyncer(
        libraryPath: libraryPath,
        resolveByTimestamp: false,
        lwwKeys: lwwKeys,
        fwwKeys: fwwKeys,
        arrayStrategy: arrayStrategy,
        arrayMatchKeys: arrayMatchKeys,
        maxDepth: maxDepth,
        detectCircularRefs: detectCircularRefs,
      );

  @override
  String merge(String base, String incoming) {
    final result = _native.tryMerge(
      base,
      incoming,
      options: syncer_ffi.MergeOptions(
        resolveByTimestamp: resolveByTimestamp,
        lwwKeys: lwwKeys,
        fwwKeys: fwwKeys,
        arrayStrategy: arrayStrategy,
        arrayMatchKeys: arrayMatchKeys,
        maxDepth: maxDepth,
        detectCircularRefs: detectCircularRefs,
      ),
    );
    if (result == null) {
      throw SyncerMergeException(
          'native merge failed (invalid JSON input?): base=$base incoming=$incoming');
    }
    return result;
  }
}

/// Rebase un-confirmed local writes on top of authoritative server state.
///
/// This is the invariant that makes optimistic writes safe. A pull replaces the
/// base with server state, then every mutation the server has not yet confirmed
/// is replayed on top, so a user never watches their un-pushed edit disappear.
/// Replicache describes the same operation as a git rebase.
///
/// ## Why the overlay must not be timestamp-gated
///
/// Engines that replay *mutator functions* get this for free. opto-sync merges
/// *documents* under last-write-wins, so a naive replay reintroduces the bug
/// rebase exists to prevent: a pending edit stamped before the server's newer
/// `updatedAt` is rejected as stale and vanishes from the view while still
/// sitting in the queue, so the record flips back once the push lands.
///
/// Pass an [ISyncer] with `resolveByTimestamp: false` — [FfiSyncer.overlay]
/// builds one. Passing a gated syncer restores strict last-write-wins, which
/// drops pending writes older than the server's timestamp.
///
/// [pendingJson] must be **oldest first** — the order they will reach the
/// server. Merge failures surface as exceptions, never as an empty document.
String rebasePending(
  ISyncer overlaySyncer,
  String serverJson,
  Iterable<String> pendingJson,
) {
  var view = serverJson;
  for (final payload in pendingJson) {
    view = overlaySyncer.merge(view, payload);
  }
  return view;
}

class OptoSyncClient {
  final OptoSyncDatabase db;
  final ISyncer syncer;

  /// Syncer used to replay this client's un-confirmed writes in [localView].
  /// Must have timestamp resolution disabled — see [rebasePending].
  final ISyncer? overlaySyncer;

  OptoSyncClient({
    required this.db,
    required this.syncer,
    this.overlaySyncer,
  });

  /// Queue an optimistic local write. The row is persisted with
  /// [SyncStatus.pending].
  Future<void> queueMutation(
      String tableName, String recordId, Map<String, dynamic> payload) async {
    await db.into(db.localMutations).insert(LocalMutationsCompanion.insert(
          targetTable: tableName,
          recordId: recordId,
          jsonPayload: jsonEncode(payload),
        ));
    _triggerBackgroundSync();
  }

  /// Reconcile an incoming server payload against the existing local state.
  ///
  /// Merge failures surface as a [SyncerMergeException] (or whatever the
  /// configured [ISyncer] throws) — they are never silently swallowed.
  Future<Map<String, dynamic>> reconcileIncoming(
      String tableName,
      String recordId,
      Map<String, dynamic> incomingPayload,
      Map<String, dynamic> existingLocalPayload) async {
    final baseJson = jsonEncode(existingLocalPayload);
    final incomingJson = jsonEncode(incomingPayload);
    final mergedJson = syncer.merge(baseJson, incomingJson);
    return jsonDecode(mergedJson) as Map<String, dynamic>;
  }

  /// The view to render for one record: authoritative server state with this
  /// client's still-pending writes replayed on top.
  ///
  /// Prefer this over [reconcileIncoming] whenever the queue is in play.
  /// `reconcileIncoming` reconciles two documents and knows nothing about
  /// mutations awaiting push, so rendering its result drops any pending edit
  /// the server's timestamp outranks — the edit reappears when the push lands,
  /// which reads as the UI undoing and redoing the user's work.
  ///
  /// Requires an [overlaySyncer] (see [FfiSyncer.overlay]); without one there
  /// is no way to replay a pending write that the server's timestamp outranks.
  Future<Map<String, dynamic>> localView(
    String tableName,
    String recordId,
    Map<String, dynamic> serverPayload,
  ) async {
    final overlay = overlaySyncer;
    if (overlay == null) {
      throw StateError(
          'localView requires an overlaySyncer (see FfiSyncer.overlay()); '
          'without it a pending write older than the server cannot be replayed');
    }
    final rows = await (db.select(db.localMutations)
          ..where((t) =>
              t.targetTable.equals(tableName) & t.recordId.equals(recordId))
          // Insertion order: the order these will reach the server, and so the
          // order they must be replayed in.
          ..orderBy([(t) => OrderingTerm.asc(t.id)]))
        .get();

    final pending = rows.map((r) => r.jsonPayload).toList(growable: false);
    return jsonDecode(rebasePending(overlay, jsonEncode(serverPayload), pending))
        as Map<String, dynamic>;
  }

  void _triggerBackgroundSync() {
    // Implement background job to send pending mutations to the server.
  }
}
