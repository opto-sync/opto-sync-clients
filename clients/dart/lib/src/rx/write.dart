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

import '../../opto_sync_client.dart';
import '../consistency.dart';

enum Optimism { background, localFirst, awaitServer }

const Map<Optimism, String> optimismToConsistencyPolicy = {
  Optimism.background: consistencyPolicyQueuedLocalFirst,
  Optimism.localFirst: consistencyPolicyWriteThroughLocalFirst,
  Optimism.awaitServer: consistencyPolicyRemoteAcknowledged,
};

class WriteReceipt {
  const WriteReceipt({
    required this.optimism,
    required this.queuedMutationId,
    this.cycle,
    this.consistencyPolicy,
  });

  final Optimism optimism;

  /// Row id in the local queue.
  final int queuedMutationId;

  /// Populated only for [Optimism.awaitServer].
  final ProtocolSyncCycleResult? cycle;

  /// Canonical policy stored on the durable intent.
  final String? consistencyPolicy;
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
  String? consistency,
  SyncKicker? loop,
  String? baseRevision,
  bool? resurrect,
}) async {
  if (optimism == Optimism.awaitServer && loop == null) {
    throw ArgumentError("optimism 'awaitServer' requires a sync loop");
  }
  final policy = canonicalizeConsistencyPolicy(
    consistency ?? optimismToConsistencyPolicy[optimism]!,
  );
  final queuedMutationId = await client.queueMutation(
    tableName,
    recordId,
    payload,
    baseRevision: baseRevision,
    resurrect: resurrect ?? false,
    consistencyPolicy: policy,
  );
  return _settle(client, loop, optimism, queuedMutationId, policy);
}

Future<WriteReceipt> writeDelete(
  OptoSyncClient client,
  String tableName,
  String recordId, {
  Optimism optimism = Optimism.localFirst,
  String? consistency,
  SyncKicker? loop,
  String? baseRevision,
}) async {
  if (optimism == Optimism.awaitServer && loop == null) {
    throw ArgumentError("optimism 'awaitServer' requires a sync loop");
  }
  final policy = canonicalizeConsistencyPolicy(
    consistency ?? optimismToConsistencyPolicy[optimism]!,
  );
  final queuedMutationId = await client.queueDelete(
    tableName,
    recordId,
    baseRevision: baseRevision,
    consistencyPolicy: policy,
  );
  return _settle(client, loop, optimism, queuedMutationId, policy);
}

class ConsistencyWriteReceipt {
  const ConsistencyWriteReceipt({
    required this.status,
    required this.consistencyPolicy,
    required this.queuedMutationId,
    this.coveredMutationIds = const <String>[],
    this.message,
    this.cycle,
  });

  final String status;
  final String consistencyPolicy;
  final int queuedMutationId;
  final List<String> coveredMutationIds;
  final String? message;
  final ProtocolSyncCycleResult? cycle;
}

Future<ConsistencyWriteReceipt> writeWithConsistency(
  OptoSyncClient client,
  String tableName,
  String recordId,
  Map<String, dynamic> payload, {
  String? consistency,
  Optimism optimism = Optimism.localFirst,
  SyncKicker? loop,
  String? baseRevision,
  bool? resurrect,
}) async {
  final policy = canonicalizeConsistencyPolicy(
    consistency ?? optimismToConsistencyPolicy[optimism]!,
  );
  final queuedMutationId = await client.queueMutation(
    tableName,
    recordId,
    payload,
    baseRevision: baseRevision,
    resurrect: resurrect ?? false,
    consistencyPolicy: policy,
  );
  return _settleConsistency(client, loop, policy, queuedMutationId);
}

Future<WriteReceipt> _settle(
  OptoSyncClient client,
  SyncKicker? loop,
  Optimism optimism,
  int queuedMutationId,
  String policy,
) async {
  switch (optimism) {
    case Optimism.background:
      return WriteReceipt(
        optimism: optimism,
        queuedMutationId: queuedMutationId,
        consistencyPolicy: policy,
      );
    case Optimism.localFirst:
      loop?.hint();
      return WriteReceipt(
        optimism: optimism,
        queuedMutationId: queuedMutationId,
        consistencyPolicy: policy,
      );
    case Optimism.awaitServer:
      var cycle = await loop!.syncNow();
      if (await _isPending(client, queuedMutationId)) {
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
        consistencyPolicy: policy,
      );
  }
}

Future<ConsistencyWriteReceipt> _settleConsistency(
  OptoSyncClient client,
  SyncKicker? loop,
  String policy,
  int queuedMutationId,
) async {
  if (policy == consistencyPolicyQueuedLocalFirst) {
    final outcome = outcomeForNetwork(policy: policy, network: 'not-attempted');
    return ConsistencyWriteReceipt(
      status: outcome.status,
      consistencyPolicy: outcome.consistencyPolicy,
      queuedMutationId: queuedMutationId,
    );
  }
  if (loop == null) {
    if (policy == consistencyPolicyRemoteAcknowledged) {
      throw ArgumentError(
        'remote-acknowledged consistency requires a sync loop',
      );
    }
    final outcome = outcomeForNetwork(policy: policy, network: 'not-attempted');
    return ConsistencyWriteReceipt(
      status: outcome.status,
      consistencyPolicy: outcome.consistencyPolicy,
      queuedMutationId: queuedMutationId,
    );
  }
  loop.hint();
  try {
    var cycle = await loop.syncNow();
    if (await _isPending(client, queuedMutationId)) {
      cycle = await loop.syncNow();
      if (await _isPending(client, queuedMutationId)) {
        final outcome = outcomeForNetwork(
          policy: policy,
          network: 'response-lost',
        );
        return ConsistencyWriteReceipt(
          status: outcome.status,
          consistencyPolicy: outcome.consistencyPolicy,
          queuedMutationId: queuedMutationId,
          message: outcome.message,
          cycle: cycle,
        );
      }
    }
    final row = await (client.db.select(
      client.db.localMutations,
    )..where((t) => t.id.equals(queuedMutationId))).getSingleOrNull();
    final covered = row?.mutationId == null
        ? const <String>[]
        : [row!.mutationId!];
    final outcome = outcomeForNetwork(
      policy: policy,
      network: 'acked',
      coveredMutationIds: covered,
    );
    return ConsistencyWriteReceipt(
      status: outcome.status,
      consistencyPolicy: outcome.consistencyPolicy,
      queuedMutationId: queuedMutationId,
      coveredMutationIds: outcome.coveredMutationIds,
      cycle: cycle,
    );
  } catch (_) {
    final outcome = outcomeForNetwork(policy: policy, network: 'response-lost');
    return ConsistencyWriteReceipt(
      status: outcome.status,
      consistencyPolicy: outcome.consistencyPolicy,
      queuedMutationId: queuedMutationId,
      message: outcome.message,
    );
  }
}

Future<bool> _isPending(OptoSyncClient client, int id) async {
  final row = await (client.db.select(
    client.db.localMutations,
  )..where((t) => t.id.equals(id))).getSingleOrNull();
  return row != null && row.syncStatus == SyncStatus.pending;
}
