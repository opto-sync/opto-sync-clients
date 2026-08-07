import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:test/test.dart';

final class _NoopSyncer implements ISyncer {
  @override
  String merge(String base, String incoming) => incoming;
}

Future<String> _fixture(String name) {
  return File('../../schemas/fixtures/$name').readAsString();
}

void main() {
  late OptoSyncDatabase db;
  late OptoSyncClient client;

  setUp(() {
    db = OptoSyncDatabase(NativeDatabase.memory());
    client = OptoSyncClient(db: db, syncer: _NoopSyncer());
  });

  tearDown(() => db.close());

  test('shared fixture validates from JSON, bytes, and decoded object', () async {
    final json = await _fixture('ingest.valid.json');
    final fromJson = await parseSyncIngestDocument(json);
    final fromBytes = await parseSyncIngestDocument(utf8.encode(json));
    final fromObject = await parseSyncIngestDocument(jsonDecode(json));

    expect(fromJson.batchId, 'import-2026-07-30');
    expect(fromJson.mutations, hasLength(2));
    expect(fromBytes.batchId, fromJson.batchId);
    expect(fromObject.batchId, fromJson.batchId);
  });

  test('shared invalid fixtures fail before touching SQLite', () async {
    final fixtures =
        jsonDecode(await _fixture('ingest.invalid.json')) as List<dynamic>;
    for (final raw in fixtures) {
      final fixture = raw as Map<String, dynamic>;
      await expectLater(
        ingestSyncDocument(input: fixture['document'], client: client),
        throwsA(isA<SyncIngestValidationException>()),
        reason: fixture['name'] as String,
      );
    }
    expect(await client.pendingMutations(), isEmpty);
  });

  test('durable ingest is one contiguous SQLite transaction', () async {
    final input = await _fixture('ingest.valid.json');
    var wakes = 0;
    final waking = OptoSyncClient(
      db: db,
      syncer: _NoopSyncer(),
      onMutationQueued: () => wakes++,
    );

    final result = await ingestSyncDocument(input: input, client: waking);
    final pending = await waking.pendingMutations();
    final write =
        result.write as DurableLocalWrite<Object?, List<int>>;

    expect(write.optimism, OptimismLevel.durableLocal);
    expect(write.local, pending.map((row) => row.id).toList());
    expect(pending.map((row) => row.mutationId), ['1', '2']);
    expect(pending.map((row) => row.operation), ['upsert', 'delete']);
    expect(
      (jsonDecode(pending.first.jsonPayload) as Map)['updatedAt'],
      '1721822400000-0000-device.tab',
    );
    expect(wakes, 1);
  });

  test('queue quota failure leaves no partial imported rows', () async {
    final bounded = OptoSyncClient(
      db: db,
      syncer: _NoopSyncer(),
      maxPendingMutations: 1,
    );

    await expectLater(
      ingestSyncDocument(
        input: await _fixture('ingest.valid.json'),
        client: bounded,
      ),
      throwsA(
        isA<QueueQuotaException>().having(
          (error) => error.code,
          'code',
          'QUEUE_FULL',
        ),
      ),
    );
    expect(await bounded.pendingMutations(), isEmpty);
  });

  test('server-confirmed ingest bypasses the SQLite queue', () async {
    SyncIngestDocument? received;
    final result = await ingestSyncDocument(
      input: await _fixture('ingest.valid.json'),
      client: client,
      optimism: OptimismLevel.serverConfirmed,
      remoteIngest: (document) async {
        received = document;
        return {'accepted': document.mutations.length};
      },
    );
    final write =
        result.write as ServerConfirmedWrite<Object?, List<int>>;

    expect(received?.batchId, 'import-2026-07-30');
    expect(write.remote, {'accepted': 2});
    expect(await client.pendingMutations(), isEmpty);
  });
}
