import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:opto_sync_client/consistency.dart';
import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:opto_sync_client/rx.dart' as rx;
import 'package:test/test.dart';

File locateVectors() {
  var dir = Directory.current.absolute;
  for (var i = 0; i < 10; i++) {
    final candidate = File(
      '${dir.path}${Platform.pathSeparator}formal${Platform.pathSeparator}consistency_vectors.v1.json',
    );
    if (candidate.existsSync()) return candidate;
    final parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  throw StateError('could not locate formal/consistency_vectors.v1.json');
}

Map<String, dynamic> _map(Object? value) =>
    Map<String, dynamic>.from(value as Map);

List<Map<String, dynamic>> _maps(Object? value) =>
    (value as List).map(_map).toList(growable: false);

void main() {
  final vectors =
      jsonDecode(locateVectors().readAsStringSync()) as Map<String, dynamic>;

  test('canonical policy ids are stable and aliases collapse onto them', () {
    expect(vectors['policies'], [
      consistencyPolicyRemoteAcknowledged,
      consistencyPolicyWriteThroughLocalFirst,
      consistencyPolicyQueuedLocalFirst,
    ]);
    final aliases = _map(vectors['aliases']);
    for (final entry in aliases.entries) {
      expect(canonicalizeConsistencyPolicy(entry.key), entry.value);
    }
    for (final unknown in vectors['unknownPolicies'] as List) {
      expect(
        () => canonicalizeConsistencyPolicy(unknown as String),
        throwsA(isA<UnknownConsistencyPolicyException>()),
      );
    }
  });

  test('queued mutation intent cannot change policy identity or content', () {
    for (final fixture in _maps(vectors['freeze'])) {
      final existing = MutationIntent.fromJson(_map(fixture['existing']));
      final proposed = MutationIntent.fromJson(_map(fixture['proposed']));
      if (fixture['allowed'] == true) {
        assertQueuedIntentFrozen(existing, proposed);
      } else {
        expect(
          () => assertQueuedIntentFrozen(existing, proposed),
          throwsA(isA<FrozenMutationIntentException>()),
        );
      }
    }
  });

  test(
    'read reconciliation is deterministic across the shared vector corpus',
    () {
      for (final fixture in _maps(vectors['readModels'])) {
        final input = _map(fixture['input']);
        final actual = reconcileReadModel(
          localBase: _maps(input['localBase']).map(BaseRow.fromJson).toList(),
          overlay: _maps(input['overlay']).map(OverlayEntry.fromJson).toList(),
          remote: input['remote'] == null
              ? const <BaseRow>[]
              : _maps(input['remote']).map(BaseRow.fromJson).toList(),
          acknowledgedMutationIds:
              ((input['acknowledgedMutationIds'] as List?) ?? const [])
                  .cast<String>(),
        );
        expect(
          actual.map((row) => row.toJson()).toList(),
          _maps(_map(fixture['expect'])['records']),
          reason: fixture['id'] as String,
        );
      }
    },
  );

  test('each consistency mode returns the documented typed outcome', () {
    for (final fixture in _maps(vectors['modeOutcomes'])) {
      final actual = outcomeForNetwork(
        policy: fixture['policy'] as String,
        network: fixture['network'] as String,
        coveredMutationIds:
            ((fixture['coveredMutationIds'] as List?) ?? const [])
                .cast<String>(),
      );
      expect(
        actual.status,
        fixture['expectStatus'],
        reason: fixture['id'] as String,
      );
      expect(actual.consistencyPolicy, fixture['policy']);
    }
  });

  test(
    'queueMutation serializes the canonical policy into durable intent',
    () async {
      final db = OptoSyncDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      final client = OptoSyncClient(db: db, syncer: const NoopSyncer());
      final id = await client.queueMutation('docs', 'r1', {
        'title': 'queued',
      }, consistencyPolicy: 'queued-local-first');
      final row = await (client.db.select(
        client.db.localMutations,
      )..where((t) => t.id.equals(id))).getSingle();
      expect(
        await client.queuedConsistencyPolicy(row.mutationId!),
        consistencyPolicyQueuedLocalFirst,
      );
    },
  );

  test('writeWithConsistency covers the three public modes', () async {
    final db = OptoSyncDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    final client = OptoSyncClient(db: db, syncer: const NoopSyncer());
    final loop = _FakeLoop(client);

    final queued = await rx.writeWithConsistency(
      client,
      'docs',
      'queued',
      {'v': 1},
      consistency: consistencyPolicyQueuedLocalFirst,
      loop: loop,
    );
    expect(queued.status, 'pending');
    expect(loop.hints, 0);

    final writeThrough = await rx.writeWithConsistency(
      client,
      'docs',
      'through',
      {'v': 2},
      consistency: consistencyPolicyWriteThroughLocalFirst,
      loop: loop,
    );
    expect(writeThrough.status, 'confirmed');
    expect(loop.hints, 1);

    final strict = await rx.writeWithConsistency(
      client,
      'docs',
      'strict',
      {'v': 3},
      consistency: consistencyPolicyRemoteAcknowledged,
      loop: loop,
    );
    expect(strict.status, 'confirmed');
  });
}

class NoopSyncer implements ISyncer {
  const NoopSyncer();

  @override
  String merge(String base, String incoming) => incoming;
}

class _FakeLoop implements rx.SyncKicker {
  _FakeLoop(this.client);
  final OptoSyncClient client;
  int hints = 0;

  @override
  void hint() => hints += 1;

  @override
  Future<ProtocolSyncCycleResult> syncNow() async {
    await client.db
        .update(client.db.localMutations)
        .write(
          const LocalMutationsCompanion(syncStatus: Value(SyncStatus.synced)),
        );
    return const ProtocolSyncCycleResult(
      pushedMutations: 0,
      acknowledgedMutations: 0,
      pulledChanges: 0,
      installedSnapshots: 0,
      checkpoint: '0',
      hasMorePending: false,
    );
  }
}
