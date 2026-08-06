import 'dart:convert';

import 'package:drift/drift.dart';

import 'src/clock.dart';
import 'src/protocol_sync_loop.dart';
import 'src/syncer_backend_stub.dart'
    if (dart.library.io) 'src/syncer_backend_native.dart'
    as syncer_ffi;

export 'src/syncer_backend_stub.dart'
    if (dart.library.io) 'src/syncer_backend_native.dart'
    show ArrayMergeStrategy, ArrayStrategy, resolveSyncerLibraryPath;
export 'src/clock.dart';
export 'src/ingest.dart';
export 'src/mobile_background_sync.dart';
export 'src/native_transports_stub.dart'
    if (dart.library.io) 'src/native_transports.dart';
export 'src/protocol_sync_loop.dart';
export 'src/reactive_sync.dart';
export 'src/session_sync.dart';

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
  TextColumn get clientId => text().nullable()();
  TextColumn get mutationId => text().nullable()();
  TextColumn get operation => text().withDefault(const Constant('upsert'))();
  TextColumn get baseRevision => text().nullable()();
  BoolColumn get resurrect => boolean().withDefault(const Constant(false))();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();
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
const String metaMutationSequenceKey = 'mutation.seq';
const String metaPullCheckpointKey = 'pull.checkpoint';

/// Default maximum number of unacknowledged rows retained in the durable queue.
const int defaultMaxPendingMutations = 10000;

/// Default maximum UTF-8 size of one queued JSON payload.
///
/// This leaves 1 KiB of headroom inside the reference server's default
/// 256 KiB mutation-envelope limit.
const int defaultMaxQueuedPayloadBytes = 255 * 1024;

/// A durable queue refused work before allocating a protocol mutation id.
class QueueQuotaException implements Exception {
  final String code;
  final String message;

  const QueueQuotaException(this.code, this.message);

  @override
  String toString() => 'QueueQuotaException($code): $message';
}

@DriftDatabase(tables: [LocalMutations, Meta])
class OptoSyncDatabase extends _$OptoSyncDatabase {
  OptoSyncDatabase(super.e);

  /// v1 shipped with only `local_mutations`; v2 added `meta`; v3 adds protocol
  /// mutation identity without rebuilding (and therefore without losing) the
  /// offline queue.
  @override
  int get schemaVersion => 3;

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
      if (from < 3) {
        await m.addColumn(localMutations, localMutations.clientId);
        await m.addColumn(localMutations, localMutations.mutationId);
        await m.addColumn(localMutations, localMutations.operation);
        await m.addColumn(localMutations, localMutations.baseRevision);
        await m.addColumn(localMutations, localMutations.resurrect);
        await m.addColumn(localMutations, localMutations.attempts);
        await m.addColumn(localMutations, localMutations.lastError);
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

/// Merge engine that exposes its configured Last-Write-Wins selectors.
///
/// The queue uses these selectors when observing remote clocks. Both the
/// native [FfiSyncer] and the web `WasmSyncer` implement this contract.
abstract interface class TimestampConfiguredSyncer implements ISyncer {
  String? get lwwKeys;
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
/// `updatedAt`/`syncedAt`, **no First-Write-Wins keys**, and arrays of objects
/// merged element-wise by their `id`. Every option is overridable via the
/// constructor.
class FfiSyncer implements TimestampConfiguredSyncer {
  final syncer_ffi.Syncer _native;

  final bool resolveByTimestamp;
  @override
  final String? lwwKeys;

  /// Comma-separated First-Write-Wins keys. **Defaults to null (none).**
  ///
  /// First-write-wins is not field protection, it is a **node-level veto**: when
  /// the incoming document's FWW key is newer the engine rejects that whole
  /// node, discarding every other field of the write. `createdAt` used to be the
  /// default here, which meant any replica holding a later `createdAt` for a
  /// record could never be written to again — silently, with a successful merge:
  ///
  /// ```text
  /// base     {"createdAt":100,"updatedAt":100,"v":"base"}
  /// incoming {"createdAt":200,"updatedAt":999999,"v":"NEWEST"}
  /// result   base, unchanged — the vastly newer write is thrown away
  /// ```
  ///
  /// Two devices creating the same record id offline guarantees that state. The
  /// capability is intact for callers who genuinely want first-writer-owns-the-
  /// node semantics; pass `fwwKeys: 'createdAt'` to opt in.
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
    this.fwwKeys,
    this.arrayStrategy = syncer_ffi.ArrayMergeStrategy.mergeByKey,
    this.arrayMatchKeys = 'id',
    this.maxDepth = 0,
    this.detectCircularRefs = false,
  }) : _native = syncer_ffi.Syncer(
         libraryPath ?? syncer_ffi.resolveSyncerLibraryPath(),
       );

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
        'native merge failed (invalid JSON input?): base=$base incoming=$incoming',
      );
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

/// [ClockPersistence] over the client's own drift database.
///
/// The clock lives in the same store as the queue so a restore can never hand
/// out a timestamp that loses to a write still sitting in the queue.
class DriftClockPersistence implements ClockPersistence {
  final OptoSyncDatabase db;

  DriftClockPersistence(this.db);

  @override
  Future<String?> load() async {
    final row = await (db.select(
      db.meta,
    )..where((t) => t.key.equals(metaClockKey))).getSingleOrNull();
    return row?.value;
  }

  @override
  Future<void> save(String timestamp) async {
    await db
        .into(db.meta)
        .insertOnConflictUpdate(MetaEntry(key: metaClockKey, value: timestamp));
  }
}

sealed class QueueBatchMutation {
  final String tableName;
  final String recordId;
  final String? baseRevision;

  const QueueBatchMutation({
    required this.tableName,
    required this.recordId,
    this.baseRevision,
  });
}

final class QueueBatchUpsert extends QueueBatchMutation {
  final Map<String, dynamic> payload;
  final bool resurrect;

  const QueueBatchUpsert({
    required super.tableName,
    required super.recordId,
    required this.payload,
    super.baseRevision,
    this.resurrect = false,
  });
}

final class QueueBatchDelete extends QueueBatchMutation {
  const QueueBatchDelete({
    required super.tableName,
    required super.recordId,
    super.baseRevision,
  });
}

final class _PreparedQueueBatchMutation {
  final QueueBatchMutation mutation;
  final String jsonPayload;

  const _PreparedQueueBatchMutation(this.mutation, this.jsonPayload);
}

class OptoSyncClient implements ProtocolQueueAdapter {
  final OptoSyncDatabase db;
  final ISyncer syncer;

  /// Syncer used to replay this client's un-confirmed writes in [localView].
  /// Must have timestamp resolution disabled — see [rebasePending].
  final ISyncer? overlaySyncer;

  /// Stamp `updatedAt` from the hybrid logical clock when a queued payload does
  /// not carry one. Default true.
  ///
  /// Set false only when something else supplies an *ordered* `updatedAt` — a
  /// server-authoritative timestamp, or callers that always stamp themselves.
  /// With no stamp at all, last-write-wins is decided by raw device clocks; and
  /// because the C core compares non-digit strings lexicographically, a writer
  /// supplying ISO-8601 beats an HLC writer on every conflict until the year
  /// 2286. That is what makes an unstamped client a silently privileged one.
  final bool stampUpdatedAt;

  /// Selectors [observeIncoming] scans for remote timestamps. Plain selectors
  /// are direct keys; `#/...` selectors are RFC 6901 JSON Pointers relative to
  /// each object. Defaults to the configured syncer's Last-Write-Wins keys,
  /// then to `updatedAt,syncedAt`.
  final String lwwKeys;

  /// Drift bound handed to the clock; see [defaultMaxDriftMs].
  final int maxDriftMs;

  /// Maximum number of unacknowledged rows accepted by this queue.
  final int maxPendingMutations;

  /// Maximum UTF-8 bytes accepted in one queued JSON payload.
  final int maxQueuedPayloadBytes;

  final int Function()? _now;
  Future<HybridLogicalClock>? _clockFuture;
  void Function()? _backgroundSyncTrigger;

  OptoSyncClient({
    required this.db,
    required this.syncer,
    this.overlaySyncer,
    this.stampUpdatedAt = true,
    this.maxDriftMs = defaultMaxDriftMs,
    this.maxPendingMutations = defaultMaxPendingMutations,
    this.maxQueuedPayloadBytes = defaultMaxQueuedPayloadBytes,
    String? lwwKeys,
    int Function()? now,
    void Function()? onMutationQueued,
  }) : lwwKeys =
           lwwKeys ??
           (syncer is TimestampConfiguredSyncer ? syncer.lwwKeys : null) ??
           'updatedAt,syncedAt',
       // The field is private and the parameter is public API, so an
       // initializing formal is not possible.
       // ignore: prefer_initializing_formals
       _now = now,
       _backgroundSyncTrigger = onMutationQueued {
    if (maxPendingMutations < 1) {
      throw RangeError.range(
        maxPendingMutations,
        1,
        null,
        'maxPendingMutations',
      );
    }
    if (maxQueuedPayloadBytes < 2) {
      throw RangeError.range(
        maxQueuedPayloadBytes,
        2,
        null,
        'maxQueuedPayloadBytes',
      );
    }
  }

  void _assertPayloadQuota(String jsonPayload) {
    final bytes = utf8.encode(jsonPayload).length;
    if (bytes > maxQueuedPayloadBytes) {
      throw QueueQuotaException(
        'PAYLOAD_TOO_LARGE',
        'queued payload is $bytes bytes; limit is $maxQueuedPayloadBytes',
      );
    }
  }

  Future<void> _assertPendingQuota() async {
    final countExpression = db.localMutations.id.count();
    final countQuery = db.selectOnly(db.localMutations)
      ..addColumns([countExpression])
      ..where(db.localMutations.syncStatus.equals(SyncStatus.pending));
    final pending = await countQuery
        .map((row) => row.read(countExpression) ?? 0)
        .getSingle();
    if (pending >= maxPendingMutations) {
      throw QueueQuotaException(
        'QUEUE_FULL',
        'pending queue has reached its '
            '$maxPendingMutations-mutation limit',
      );
    }
  }

  Future<void> _assertPendingBatchQuota(int additional) async {
    final countExpression = db.localMutations.id.count();
    final countQuery = db.selectOnly(db.localMutations)
      ..addColumns([countExpression])
      ..where(db.localMutations.syncStatus.equals(SyncStatus.pending));
    final pending = await countQuery
        .map((row) => row.read(countExpression) ?? 0)
        .getSingle();
    if (pending + additional > maxPendingMutations) {
      throw QueueQuotaException(
        'QUEUE_FULL',
        'queue has $pending pending mutations; adding $additional exceeds its '
            '$maxPendingMutations-mutation limit',
      );
    }
  }

  /// This client's hybrid logical clock, created on first use and backed by the
  /// [Meta] table so it cannot go backwards across a restart.
  ///
  /// The DEVICE id is generated once per install and persisted — regenerating it
  /// would lose consistent tie-breaking against this client's own past writes.
  /// The node id adds a per-instance suffix on top ([composeNodeId]), because
  /// several writers can share one durable store and a purely persisted node id
  /// would let two of them emit identical timestamps.
  Future<HybridLogicalClock> clock() => _clockFuture ??= _openClock();

  Future<HybridLogicalClock> _openClock() async {
    final deviceId = await db.transaction(() async {
      final existing =
          await (db.select(db.meta)
                ..where((t) => t.key.equals(metaDeviceIdKey)))
              .getSingleOrNull()
              .then((row) => row?.value);
      if (existing != null && existing.isNotEmpty) return existing;
      final generated = randomNodeId();
      await db
          .into(db.meta)
          .insertOnConflictUpdate(
            MetaEntry(key: metaDeviceIdKey, value: generated),
          );
      return generated;
    });
    final clock = HybridLogicalClock(
      nodeId: composeNodeId(deviceId),
      now: _now,
      persistence: DriftClockPersistence(db),
      maxDriftMs: maxDriftMs,
    );
    await clock.restore();
    return clock;
  }

  /// Stable per-install protocol identity.
  ///
  /// This is the durable device id, not the clock node id. The clock adds a
  /// per-instance suffix to avoid timestamp ties; using that ephemeral value in
  /// the server mutation ledger would strand queued work after every restart.
  Future<String> clientId() async {
    await clock();
    final row = await (db.select(
      db.meta,
    )..where((t) => t.key.equals(metaDeviceIdKey))).getSingle();
    return row.value;
  }

  /// Advance this client's clock past the timestamps in a payload received from
  /// elsewhere, so its next write is ordered *after* what it has already seen.
  ///
  /// Call this when pulling server state; [reconcileIncoming] delegates to the
  /// native core and cannot do it. Walks every key in [lwwKeys] at every depth,
  /// because a pull commonly returns a collection or a nested document rather
  /// than one flat record.
  ///
  /// Throws [ClockDriftException] when a peer's timestamp is implausibly far in
  /// the future. Whatever was legitimately observed before the refusal is kept,
  /// and the payload is still safe to merge, so a caller may log and continue.
  Future<void> observeIncoming(Map<String, dynamic> payload) async {
    final clock = await this.clock();
    final keys = lwwKeys
        .split(',')
        .map((k) => k.trim())
        .where((k) => k.isNotEmpty)
        .toList(growable: false);
    await _observeTree(clock, payload, keys);
  }

  /// Only string values are observed: a numeric `updatedAt` is a legacy epoch
  /// value on an incomparable scale, which [HybridLogicalClock.observe] ignores
  /// anyway.
  Future<void> _observeTree(
    HybridLogicalClock clock,
    Object? node,
    List<String> keys,
  ) async {
    if (node is List) {
      for (final item in node) {
        await _observeTree(clock, item, keys);
      }
      return;
    }
    if (node is! Map) return;
    for (final key in keys) {
      final value = _timestampSelectorValue(node, key);
      if (value is String) await clock.observe(value);
    }
    for (final value in node.values) {
      await _observeTree(clock, value, keys);
    }
  }

  Object? _timestampSelectorValue(Map node, String selector) {
    if (!selector.startsWith('#/')) return node[selector];

    Object? current = node;
    for (final encoded in selector.substring(2).split('/')) {
      if (RegExp(r'~(?:[^01]|$)').hasMatch(encoded)) return null;
      final token = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
      if (current is List) {
        if (!RegExp(r'^(?:0|[1-9]\d*)$').hasMatch(token)) return null;
        final index = int.tryParse(token);
        if (index == null || index >= current.length) return null;
        current = current[index];
      } else if (current is Map) {
        if (!current.containsKey(token)) return null;
        current = current[token];
      } else {
        return null;
      }
    }
    return current;
  }

  /// Queue an optimistic local write. The row is persisted with
  /// [SyncStatus.pending].
  ///
  /// `updatedAt` is stamped from this client's [clock] unless the payload
  /// already carries one (see [stampUpdatedAt] for why that matters).
  /// `createdAt` is deliberately NOT stamped: it belongs to whoever created the
  /// record, and inventing one only manufactures conflicts.
  Future<int> queueMutation(
    String tableName,
    String recordId,
    Map<String, dynamic> payload, {
    String? baseRevision,
    bool resurrect = false,
  }) => _queueMutation(
    tableName,
    recordId,
    payload,
    baseRevision: baseRevision,
    resurrect: resurrect,
  );

  /// Apply an optimistic SQLite write and enqueue its mutation atomically.
  ///
  /// [applyOptimistic] runs inside the same Drift transaction as the queue
  /// quota check, mutation sequence allocation, and queue insert. It must use
  /// this client's [db] connection (generated tables or bound raw SQL). Any
  /// exception rolls the application write and queue state back together.
  Future<int> queueMutationAtomic(
    String tableName,
    String recordId,
    Map<String, dynamic> payload,
    Future<void> Function(Map<String, dynamic> stampedPayload)
    applyOptimistic, {
    String? baseRevision,
    bool resurrect = false,
  }) => _queueMutation(
    tableName,
    recordId,
    payload,
    baseRevision: baseRevision,
    resurrect: resurrect,
    applyOptimistic: applyOptimistic,
  );

  Future<int> _queueMutation(
    String tableName,
    String recordId,
    Map<String, dynamic> payload, {
    String? baseRevision,
    bool resurrect = false,
    Future<void> Function(Map<String, dynamic> stampedPayload)? applyOptimistic,
  }) async {
    var stamped = payload;
    // An explicit null counts as absent: a null timestamp orders against
    // nothing, so leaving it would be the unstamped failure with extra steps.
    if (stampUpdatedAt && payload['updatedAt'] == null) {
      final clock = await this.clock();
      stamped = {...payload, 'updatedAt': await clock.next()};
    }
    final jsonPayload = jsonEncode(stamped);
    _assertPayloadQuota(jsonPayload);
    final stableClientId = await clientId();
    final rowId = await db.transaction(() async {
      await _assertPendingQuota();
      final sequence = await (db.select(
        db.meta,
      )..where((t) => t.key.equals(metaMutationSequenceKey))).getSingleOrNull();
      final next =
          (BigInt.tryParse(sequence?.value ?? '0') ?? BigInt.zero) + BigInt.one;
      if (applyOptimistic != null) {
        // The queue payload is already fixed. Give the callback an independent
        // JSON value so its mutations cannot alter the wire envelope.
        await applyOptimistic(jsonDecode(jsonPayload) as Map<String, dynamic>);
      }
      await db
          .into(db.meta)
          .insertOnConflictUpdate(
            MetaEntry(key: metaMutationSequenceKey, value: '$next'),
          );
      return db
          .into(db.localMutations)
          .insert(
            LocalMutationsCompanion.insert(
              targetTable: tableName,
              recordId: recordId,
              jsonPayload: jsonPayload,
              clientId: Value(stableClientId),
              mutationId: Value('$next'),
              operation: const Value('upsert'),
              baseRevision: Value(baseRevision),
              resurrect: Value(resurrect),
            ),
          );
    });
    _triggerBackgroundSync();
    return rowId;
  }

  /// Queue an explicit tombstone mutation. Delete never carries a fake payload.
  Future<int> queueDelete(
    String tableName,
    String recordId, {
    String? baseRevision,
  }) => _queueDelete(tableName, recordId, baseRevision: baseRevision);

  /// Apply an optimistic SQLite deletion and queue its tombstone atomically.
  Future<int> queueDeleteAtomic(
    String tableName,
    String recordId,
    Future<void> Function() applyOptimisticDelete, {
    String? baseRevision,
  }) => _queueDelete(
    tableName,
    recordId,
    baseRevision: baseRevision,
    applyOptimisticDelete: applyOptimisticDelete,
  );

  Future<int> _queueDelete(
    String tableName,
    String recordId, {
    String? baseRevision,
    Future<void> Function()? applyOptimisticDelete,
  }) async {
    _assertPayloadQuota('{}');
    final stableClientId = await clientId();
    final rowId = await db.transaction(() async {
      await _assertPendingQuota();
      final sequence = await (db.select(
        db.meta,
      )..where((t) => t.key.equals(metaMutationSequenceKey))).getSingleOrNull();
      final next =
          (BigInt.tryParse(sequence?.value ?? '0') ?? BigInt.zero) + BigInt.one;
      await applyOptimisticDelete?.call();
      await db
          .into(db.meta)
          .insertOnConflictUpdate(
            MetaEntry(key: metaMutationSequenceKey, value: '$next'),
          );
      return db
          .into(db.localMutations)
          .insert(
            LocalMutationsCompanion.insert(
              targetTable: tableName,
              recordId: recordId,
              jsonPayload: '{}',
              clientId: Value(stableClientId),
              mutationId: Value('$next'),
              operation: const Value('delete'),
              baseRevision: Value(baseRevision),
            ),
          );
    });
    _triggerBackgroundSync();
    return rowId;
  }

  /// Enqueue a complete validated import in one SQLite transaction.
  ///
  /// The foreground loop and WorkManager/BGTaskScheduler can observe either
  /// every row with contiguous protocol identities or none of them.
  Future<List<int>> queueBatch(
    List<QueueBatchMutation> mutations,
  ) async {
    if (mutations.isEmpty) {
      throw ArgumentError.value(mutations, 'mutations', 'must not be empty');
    }
    final prepared = <_PreparedQueueBatchMutation>[];
    for (final mutation in mutations) {
      if (mutation is QueueBatchDelete) {
        _assertPayloadQuota('{}');
        prepared.add(_PreparedQueueBatchMutation(mutation, '{}'));
        continue;
      }
      final upsert = mutation as QueueBatchUpsert;
      var stamped = upsert.payload;
      if (stampUpdatedAt && upsert.payload['updatedAt'] == null) {
        final clock = await this.clock();
        stamped = {...upsert.payload, 'updatedAt': await clock.next()};
      }
      final jsonPayload = jsonEncode(stamped);
      _assertPayloadQuota(jsonPayload);
      prepared.add(_PreparedQueueBatchMutation(mutation, jsonPayload));
    }

    final stableClientId = await clientId();
    final ids = await db.transaction(() async {
      await _assertPendingBatchQuota(prepared.length);
      final storedSequence =
          await (db.select(db.meta)..where(
                (t) => t.key.equals(metaMutationSequenceKey),
              ))
              .getSingleOrNull();
      var sequence =
          BigInt.tryParse(storedSequence?.value ?? '0') ?? BigInt.zero;
      final inserted = <int>[];
      for (final item in prepared) {
        sequence += BigInt.one;
        final mutation = item.mutation;
        inserted.add(
          await db
              .into(db.localMutations)
              .insert(
                LocalMutationsCompanion.insert(
                  targetTable: mutation.tableName,
                  recordId: mutation.recordId,
                  jsonPayload: item.jsonPayload,
                  clientId: Value(stableClientId),
                  mutationId: Value('$sequence'),
                  operation: Value(
                    mutation is QueueBatchUpsert ? 'upsert' : 'delete',
                  ),
                  baseRevision: Value(mutation.baseRevision),
                  resurrect: Value(
                    mutation is QueueBatchUpsert && mutation.resurrect,
                  ),
                ),
              ),
        );
      }
      await db
          .into(db.meta)
          .insertOnConflictUpdate(
            MetaEntry(
              key: metaMutationSequenceKey,
              value: '$sequence',
            ),
          );
      return inserted;
    });
    _triggerBackgroundSync();
    return ids;
  }

  /// Delete the oldest acknowledged rows, retaining recent diagnostics.
  ///
  /// Pending work is never removed.
  Future<int> pruneConfirmed({int retain = 1000}) async {
    if (retain < 0) {
      throw RangeError.range(retain, 0, null, 'retain');
    }
    return db.transaction(() async {
      final confirmed =
          await (db.select(db.localMutations)
                ..where((t) => t.syncStatus.equals(SyncStatus.synced))
                ..orderBy([(t) => OrderingTerm.asc(t.id)]))
              .get();
      final removeCount = confirmed.length - retain;
      if (removeCount <= 0) return 0;
      final ids = confirmed
          .take(removeCount)
          .map((mutation) => mutation.id)
          .toList(growable: false);
      await (db.delete(db.localMutations)..where((t) => t.id.isIn(ids))).go();
      return removeCount;
    });
  }

  /// Pending protocol mutations in immutable insertion order.
  Future<List<Mutation>> pendingMutations({int limit = 100}) {
    if (limit < 1 || limit > 100) {
      throw RangeError.range(limit, 1, 100, 'limit');
    }
    return (db.select(db.localMutations)
          ..where((t) => t.syncStatus.equals(SyncStatus.pending))
          ..orderBy([(t) => OrderingTerm.asc(t.id)])
          ..limit(limit))
        .get();
  }

  Map<String, dynamic> _encodeProtocolRows(
    String clientIdentity,
    List<Mutation> rows,
  ) {
    final mutations = <Map<String, dynamic>>[];
    BigInt? previous;
    for (final row in rows) {
      if (row.clientId != clientIdentity || row.mutationId == null) {
        throw StateError(
          'queued row ${row.id} has no matching protocol identity',
        );
      }
      final current = BigInt.tryParse(row.mutationId!);
      if (current == null || current <= BigInt.zero) {
        throw StateError('queued row ${row.id} has an invalid mutation id');
      }
      if (previous != null && current != previous + BigInt.one) {
        throw StateError('pending mutations are not contiguous');
      }
      previous = current;
      final encoded = <String, dynamic>{
        'mutationId': '$current',
        'operation': row.operation,
        'table': row.targetTable,
        'recordId': row.recordId,
        if (row.baseRevision != null) 'baseRevision': row.baseRevision,
      };
      if (row.operation == 'upsert') {
        final payload = jsonDecode(row.jsonPayload);
        if (payload is! Map<String, dynamic>) {
          throw StateError('mutation $current payload is not a JSON object');
        }
        encoded['payload'] = payload;
        if (row.resurrect) encoded['resurrect'] = true;
      }
      mutations.add(encoded);
    }
    return {
      'protocolVersion': 1,
      'clientId': clientIdentity,
      'mutations': mutations,
    };
  }

  /// Encode an insertion-ordered protocol v1 push batch.
  @override
  Future<Map<String, dynamic>> protocolPushRequest({int limit = 100}) async {
    final id = await clientId();
    final rows = await pendingMutations(limit: limit);
    return _encodeProtocolRows(id, rows);
  }

  /// Drain every local row covered by a protocol push watermark.
  @override
  Future<int> acknowledgePush(
    Map<String, dynamic> response,
    Map<String, dynamic> request,
  ) async {
    final id = await clientId();
    final requestMutations = request['mutations'];
    final results = response['results'];
    if (request['protocolVersion'] != 1 ||
        request['clientId'] != id ||
        requestMutations is! List ||
        requestMutations.isEmpty ||
        requestMutations.length > 100 ||
        response['protocolVersion'] != 1 ||
        response['clientId'] != id ||
        response['checkpoint'] is! String ||
        !RegExp(
          r'^(?:0|[1-9]\d*)$',
        ).hasMatch(response['checkpoint'] as String) ||
        results is! List ||
        results.length != requestMutations.length) {
      throw const FormatException(
        'push acknowledgement does not match the sent batch',
      );
    }
    final terminal = requestMutations.last;
    if (terminal is! Map ||
        response['lastMutationId'] is! String ||
        !RegExp(
          r'^(?:0|[1-9]\d*)$',
        ).hasMatch(response['lastMutationId'] as String) ||
        response['lastMutationId'] != terminal['mutationId']) {
      throw const FormatException(
        'push acknowledgement does not match the sent batch',
      );
    }
    for (var index = 0; index < requestMutations.length; index++) {
      final sent = requestMutations[index];
      final result = results[index];
      if (sent is! Map ||
          result is! Map ||
          result['mutationId'] != sent['mutationId'] ||
          !const [
            'applied',
            'duplicate',
            'rejected',
          ].contains(result['status']) ||
          (result['checkpoint'] != null &&
              (result['checkpoint'] is! String ||
                  !RegExp(
                    r'^(?:0|[1-9]\d*)$',
                  ).hasMatch(result['checkpoint'] as String))) ||
          (result['revision'] != null &&
              (result['revision'] is! String ||
                  !RegExp(
                    r'^[1-9]\d*$',
                  ).hasMatch(result['revision'] as String))) ||
          (result['originalStatus'] != null &&
              !const [
                'applied',
                'rejected',
              ].contains(result['originalStatus'])) ||
          ((result['status'] == 'duplicate') !=
              (result['originalStatus'] != null))) {
        throw const FormatException(
          'push acknowledgement does not match the sent batch',
        );
      }
    }
    return db.transaction(() async {
      final rows =
          await (db.select(db.localMutations)
                ..where(
                  (t) =>
                      t.syncStatus.equals(SyncStatus.pending) &
                      t.clientId.equals(id),
                )
                ..orderBy([(t) => OrderingTerm.asc(t.id)])
                ..limit(requestMutations.length))
              .get();
      final expected = _encodeProtocolRows(id, rows);
      if (jsonEncode(expected) != jsonEncode(request)) {
        throw const FormatException(
          'push acknowledgement does not match the sent batch',
        );
      }
      await db.batch((batch) {
        for (final row in rows) {
          batch.update(
            db.localMutations,
            const LocalMutationsCompanion(syncStatus: Value(SyncStatus.synced)),
            where: (t) => t.id.equals(row.id),
          );
        }
      });
      return rows.length;
    });
  }

  @override
  Future<String> pullCheckpoint() async =>
      (await (db.select(db.meta)
                ..where((t) => t.key.equals(metaPullCheckpointKey)))
              .getSingleOrNull())
          ?.value ??
      '0';

  /// Persist after authoritative changes have applied successfully.
  ///
  /// When both share this Drift database, use one transaction. Otherwise make
  /// application idempotent and advance second; a crash replays the page.
  @override
  Future<void> setPullCheckpoint(String checkpoint) async {
    _validateCheckpoint(checkpoint);
    await db
        .into(db.meta)
        .insertOnConflictUpdate(
          MetaEntry(key: metaPullCheckpointKey, value: checkpoint),
        );
  }

  /// Commit one authoritative pull page and its checkpoint in one SQLite
  /// transaction. [applyChanges] must use this client's [db] connection.
  Future<void> commitPullPageAtomic(
    String checkpoint,
    Future<void> Function() applyChanges,
  ) async {
    _validateCheckpoint(checkpoint);
    await db.transaction(() async {
      await applyChanges();
      await db
          .into(db.meta)
          .insertOnConflictUpdate(
            MetaEntry(key: metaPullCheckpointKey, value: checkpoint),
          );
    });
  }

  /// Install a reset snapshot without acknowledging any pending mutations.
  ///
  /// [replaceAuthoritative] must atomically replace the application's synced
  /// store. This queue cannot transact an unrelated database, so it advances
  /// the checkpoint only after that callback succeeds. A crash or exception
  /// first leaves the old checkpoint in place and the full replacement can be
  /// retried; pending optimistic writes remain available for rebase.
  @override
  Future<void> installSnapshot(
    Map<String, dynamic> snapshot,
    Future<void> Function(List<Map<String, dynamic>> records)
    replaceAuthoritative,
  ) async {
    final validated = _validateSnapshot(snapshot);
    await replaceAuthoritative(validated.records);
    await setPullCheckpoint(validated.checkpoint);
  }

  /// Replace same-database authoritative rows and persist the reset checkpoint
  /// in one Drift transaction. Pending queue rows remain untouched for rebase.
  Future<void> installSnapshotAtomic(
    Map<String, dynamic> snapshot,
    Future<void> Function(List<Map<String, dynamic>> records)
    replaceAuthoritative,
  ) async {
    final validated = _validateSnapshot(snapshot);
    await db.transaction(() async {
      await replaceAuthoritative(validated.records);
      await db
          .into(db.meta)
          .insertOnConflictUpdate(
            MetaEntry(key: metaPullCheckpointKey, value: validated.checkpoint),
          );
    });
  }

  void _validateCheckpoint(String checkpoint) {
    if (!RegExp(r'^(?:0|[1-9]\d*)$').hasMatch(checkpoint)) {
      throw FormatException('checkpoint must be a canonical decimal string');
    }
  }

  ({String checkpoint, List<Map<String, dynamic>> records}) _validateSnapshot(
    Map<String, dynamic> snapshot,
  ) {
    final checkpoint = snapshot['checkpoint'];
    final rawRecords = snapshot['records'];
    if (snapshot['protocolVersion'] != 1 ||
        checkpoint is! String ||
        !RegExp(r'^(?:0|[1-9]\d*)$').hasMatch(checkpoint) ||
        rawRecords is! List) {
      throw const FormatException(
        'snapshot is not a valid protocol v1 snapshot',
      );
    }
    final records = rawRecords
        .map((record) {
          if (record is! Map ||
              record['table'] is! String ||
              (record['table'] as String).isEmpty ||
              record['recordId'] is! String ||
              (record['recordId'] as String).isEmpty ||
              record['revision'] is! String ||
              !RegExp(r'^[1-9]\d*$').hasMatch(record['revision'] as String) ||
              record['record'] is! Map) {
            throw const FormatException(
              'snapshot record is not a valid protocol v1 record',
            );
          }
          return Map<String, dynamic>.from(record);
        })
        .toList(growable: false);
    return (checkpoint: checkpoint, records: records);
  }

  /// Reconcile an incoming server payload against the existing local state.
  ///
  /// Merge failures surface as a [SyncerMergeException] (or whatever the
  /// configured [ISyncer] throws) — they are never silently swallowed.
  Future<Map<String, dynamic>> reconcileIncoming(
    String tableName,
    String recordId,
    Map<String, dynamic> incomingPayload,
    Map<String, dynamic> existingLocalPayload,
  ) async {
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
        'without it a pending write older than the server cannot be replayed',
      );
    }
    final rows =
        await (db.select(db.localMutations)
              ..where(
                (t) =>
                    t.targetTable.equals(tableName) &
                    t.recordId.equals(recordId) &
                    t.syncStatus.equals(SyncStatus.pending),
              )
              // Insertion order: the order these will reach the server, and so the
              // order they must be replayed in.
              ..orderBy([(t) => OrderingTerm.asc(t.id)]))
            .get();

    final pending = rows.map((r) => r.jsonPayload).toList(growable: false);
    return jsonDecode(
          rebasePending(overlay, jsonEncode(serverPayload), pending),
        )
        as Map<String, dynamic>;
  }

  /// Attach or replace the wake-up hook called after a durable queue commit.
  ///
  /// [ProtocolSyncLoop.hint] is the standard target. Hook failures cannot undo
  /// an already committed mutation.
  void setBackgroundSyncTrigger(void Function()? trigger) {
    _backgroundSyncTrigger = trigger;
  }

  void _triggerBackgroundSync() {
    try {
      _backgroundSyncTrigger?.call();
    } catch (_) {
      // A wake-up/observability hook must never make durable queueing fail.
    }
  }
}
