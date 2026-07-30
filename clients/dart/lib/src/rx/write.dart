/// Declarative write strategies ("optimism levels").
///
/// Every write goes through the same durable queue — the levels differ only
/// in WHAT THE COMPLETED FUTURE MEANS:
///
/// - [Optimism.background]: completed = durably queued locally; a background
///   worker / service worker / next foreground cycle delivers it.
/// - [Optimism.localFirst]: completed = durably queued AND a sync cycle was
///   kicked off immediately (not awaited). The default.
/// - [Optimism.awaitServer]: completed = the server durably acknowledged this
///   mutation. Fails if the cycle fails or the row is still pending after.
///   The local write STILL lands first — this level never blocks rendering.
///
/// There is deliberately no "server-only, skip the queue" level: it would
/// reintroduce the lost-update window the queue exists to close.
library;

import 'package:drift/drift.dart';

import '../../opto_sync_client.dart';

enum Optimism { background, localFirst, awaitServer }

class WriteReceipt {
  const WriteReceipt({
    required this.optimism,
    required this.queuedMutationId,
    this.cycle,
  });

  final Optimism optimism;

  /// Row id in the local queue.
  final int queuedMutationId;

  /// Populated only for [Optimism.awaitServer].
  final ProtocolSyncCycleResult? cycle;
}

/// Minimal loop surface used here; satisfied by [ProtocolSyncLoop].
abstract interface class SyncKicker {
  void hint();
  Future<ProtocolSyncCycleResult> syncNow();
}

Future<WriteReceipt> write(
  OptoSyncClient client,
  String tableName,
  String recordId,
  Map<String, dynamic> payload, {
  Optimism optimism = Optimism.localFirst,
  SyncKicker? loop,
  String? baseRevision,
  bool? resurrect,
}) async {
  if (optimism == Optimism.awaitServer && loop == null) {
    throw ArgumentError("optimism 'awaitServer' requires a sync loop");
  }
  final queuedMutationId = await client.queueMutation(
    tableName,
    recordId,
    payload,
    baseRevision: baseRevision,
    resurrect: resurrect ?? false,
  );
  return _settle(client, loop, optimism, queuedMutationId);
}

Future<WriteReceipt> writeDelete(
  OptoSyncClient client,
  String tableName,
  String recordId, {
  Optimism optimism = Optimism.localFirst,
  SyncKicker? loop,
  String? baseRevision,
}) async {
  if (optimism == Optimism.awaitServer && loop == null) {
    throw ArgumentError("optimism 'awaitServer' requires a sync loop");
  }
  final queuedMutationId = await client.queueDelete(
    tableName,
    recordId,
    baseRevision: baseRevision,
  );
  return _settle(client, loop, optimism, queuedMutationId);
}

Future<WriteReceipt> _settle(
  OptoSyncClient client,
  SyncKicker? loop,
  Optimism optimism,
  int queuedMutationId,
) async {
  switch (optimism) {
    case Optimism.background:
      return WriteReceipt(
        optimism: optimism,
        queuedMutationId: queuedMutationId,
      );
    case Optimism.localFirst:
      loop?.hint();
      return WriteReceipt(
        optimism: optimism,
        queuedMutationId: queuedMutationId,
      );
    case Optimism.awaitServer:
      var cycle = await loop!.syncNow();
      if (await _isPending(client, queuedMutationId)) {
        // A concurrent cycle may have raced us with a partial batch; one more
        // single-flight cycle settles this row or fails loudly.
        cycle = await loop.syncNow();
        if (await _isPending(client, queuedMutationId)) {
          throw StateError(
            'server did not acknowledge the mutation within the awaited sync cycles',
          );
        }
      }
      return WriteReceipt(
        optimism: optimism,
        queuedMutationId: queuedMutationId,
        cycle: cycle,
      );
  }
}

Future<bool> _isPending(OptoSyncClient client, int id) async {
  final row =
      await (client.db.select(client.db.localMutations)
            ..where((t) => t.id.equals(id)))
          .getSingleOrNull();
  return row != null && row.syncStatus == SyncStatus.pending;
}
