import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:syncer/syncer.dart' as syncer_ffi;

export 'package:syncer/syncer.dart'
    show ArrayMergeStrategy, ArrayStrategy, resolveSyncerLibraryPath;

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

/// Sync status values for [LocalMutations.syncStatus].
abstract final class SyncStatus {
  static const int pending = 0;
  static const int synced = 1;
  static const int failed = 2;
}

@DriftDatabase(tables: [LocalMutations])
class OptoSyncDatabase extends _$OptoSyncDatabase {
  OptoSyncDatabase(super.e);

  @override
  int get schemaVersion => 1;
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

class OptoSyncClient {
  final OptoSyncDatabase db;
  final ISyncer syncer;

  OptoSyncClient({
    required this.db,
    required this.syncer,
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

  void _triggerBackgroundSync() {
    // Implement background job to send pending mutations to the server.
  }
}
