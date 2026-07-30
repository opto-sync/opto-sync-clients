import 'dart:async';

import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:test/test.dart';

Map<String, dynamic> mutation([String id = '1']) => {
  'mutationId': id,
  'operation': 'upsert',
  'table': 'docs',
  'recordId': 'record-$id',
  'payload': {'id': id},
};

Map<String, dynamic> change(String checkpoint, String id) => {
  'checkpoint': checkpoint,
  'table': 'docs',
  'recordId': id,
  'operation': 'upsert',
  'record': {'id': id},
  'revision': checkpoint,
};

class FakeQueue implements ProtocolQueueAdapter {
  final List<String> events;
  final List<Map<String, dynamic>> pending;
  String checkpoint = '0';

  FakeQueue(this.events, [Iterable<Map<String, dynamic>> pending = const []])
    : pending = [...pending];

  @override
  Future<Map<String, dynamic>> protocolPushRequest({int limit = 100}) async => {
    'protocolVersion': 1,
    'clientId': 'device-a',
    'mutations': pending.take(limit).toList(growable: false),
  };

  @override
  Future<int> acknowledgePush(
    Map<String, dynamic> response,
    Map<String, dynamic> request,
  ) async {
    expect(
      response['lastMutationId'],
      (request['mutations'] as List).last['mutationId'],
    );
    final watermark = BigInt.parse(response['lastMutationId'] as String);
    final before = pending.length;
    pending.removeWhere(
      (entry) => BigInt.parse(entry['mutationId'] as String) <= watermark,
    );
    events.add('ack:${response['lastMutationId']}');
    return before - pending.length;
  }

  @override
  Future<String> pullCheckpoint() async => checkpoint;

  @override
  Future<void> setPullCheckpoint(String next) async {
    checkpoint = next;
    events.add('checkpoint:$next');
  }

  @override
  Future<void> installSnapshot(
    Map<String, dynamic> snapshot,
    Future<void> Function(List<Map<String, dynamic>> records)
    replaceAuthoritative,
  ) async {
    await replaceAuthoritative(
      (snapshot['records'] as List)
          .map((record) => Map<String, dynamic>.from(record as Map))
          .toList(growable: false),
    );
    checkpoint = snapshot['checkpoint'] as String;
    events.add('checkpoint:$checkpoint');
  }
}

class FakeTransport implements ProtocolTransport {
  final Future<Map<String, dynamic>> Function(
    String checkpoint,
    int limit,
    ProtocolCancellationToken cancellation,
  )
  onPull;
  final Future<Map<String, dynamic>> Function(
    Map<String, dynamic> request,
    ProtocolCancellationToken cancellation,
  )
  onPush;
  final Future<Map<String, dynamic>> Function(
    ProtocolCancellationToken cancellation,
    Map<String, dynamic>? reset,
  )
  onSnapshot;

  FakeTransport({
    required this.onPull,
    required this.onPush,
    required this.onSnapshot,
  });

  @override
  Future<Map<String, dynamic>> pull(
    String checkpoint,
    int limit,
    ProtocolCancellationToken cancellation,
  ) => onPull(checkpoint, limit, cancellation);

  @override
  Future<Map<String, dynamic>> push(
    Map<String, dynamic> request,
    ProtocolCancellationToken cancellation,
  ) => onPush(request, cancellation);

  @override
  Future<Map<String, dynamic>> snapshot(
    ProtocolCancellationToken cancellation, [
    Map<String, dynamic>? reset,
  ]) => onSnapshot(cancellation, reset);
}

class FakeCallbacks implements ProtocolSyncCallbacks {
  final Future<void> Function(List<Map<String, dynamic>>) onApply;
  final Future<void> Function(List<Map<String, dynamic>>) onReplace;

  FakeCallbacks({required this.onApply, required this.onReplace});

  @override
  Future<void> applyChanges(List<Map<String, dynamic>> changes) =>
      onApply(changes);

  @override
  Future<void> replaceAuthoritative(List<Map<String, dynamic>> records) =>
      onReplace(records);
}

class AtomicFakeCallbacks implements AtomicProtocolSyncCallbacks {
  final Future<void> Function(List<Map<String, dynamic>>, String) onApplyAtomic;
  final Future<void> Function(List<Map<String, dynamic>>, String)
  onReplaceAtomic;

  AtomicFakeCallbacks({
    required this.onApplyAtomic,
    required this.onReplaceAtomic,
  });

  @override
  Future<void> applyChanges(List<Map<String, dynamic>> changes) =>
      unexpected('non-atomic apply');

  @override
  Future<void> replaceAuthoritative(List<Map<String, dynamic>> records) =>
      unexpected('non-atomic replacement');

  @override
  Future<void> applyChangesAndCheckpoint(
    List<Map<String, dynamic>> changes,
    String checkpoint,
  ) => onApplyAtomic(changes, checkpoint);

  @override
  Future<void> replaceAuthoritativeAndCheckpoint(
    List<Map<String, dynamic>> records,
    String checkpoint,
  ) => onReplaceAtomic(records, checkpoint);
}

Never unexpected(String operation) =>
    throw StateError('$operation was unexpected');

void main() {
  test(
    'cycle pulls, pushes immutable work, acknowledges, then pulls echo',
    () async {
      final events = <String>[];
      final queue = FakeQueue(events, [mutation()]);
      var pulls = 0;
      final loop = ProtocolSyncLoop(
        queue,
        FakeTransport(
          onPull: (checkpoint, _, _) async {
            pulls++;
            if (pulls == 1) {
              expect(checkpoint, '0');
              return {
                'protocolVersion': 1,
                'checkpoint': '1',
                'hasMore': false,
                'changes': [change('1', 'remote-before-push')],
              };
            }
            expect(checkpoint, '1');
            return {
              'protocolVersion': 1,
              'checkpoint': '2',
              'hasMore': false,
              'changes': [change('2', 'record-1')],
            };
          },
          onPush: (request, _) async {
            final mutations = request['mutations'] as List;
            events.add('push:${mutations.first['mutationId']}');
            return {
              'protocolVersion': 1,
              'clientId': 'device-a',
              'lastMutationId': '1',
              'checkpoint': '2',
              'results': [
                {'mutationId': '1', 'status': 'applied'},
              ],
            };
          },
          onSnapshot: (_, _) async => unexpected('snapshot'),
        ),
        FakeCallbacks(
          onApply: (changes) async {
            events.add(
              'apply:${changes.map((entry) => entry['checkpoint']).join(',')}',
            );
          },
          onReplace: (_) async => unexpected('replacement'),
        ),
      );

      final result = await loop.syncNow();
      expect(events, [
        'apply:1',
        'checkpoint:1',
        'push:1',
        'ack:1',
        'apply:2',
        'checkpoint:2',
      ]);
      expect(result.pushedMutations, 1);
      expect(result.acknowledgedMutations, 1);
      expect(result.pulledChanges, 2);
      expect(result.checkpoint, '2');
      expect(result.hasMorePending, isFalse);
    },
  );

  test(
    'failed authoritative application does not advance checkpoint',
    () async {
      final events = <String>[];
      final queue = FakeQueue(events);
      final loop = ProtocolSyncLoop(
        queue,
        FakeTransport(
          onPull: (_, _, _) async => {
            'protocolVersion': 1,
            'checkpoint': '1',
            'hasMore': false,
            'changes': [change('1', 'unsafe')],
          },
          onPush: (_, _) async => unexpected('push'),
          onSnapshot: (_, _) async => unexpected('snapshot'),
        ),
        FakeCallbacks(
          onApply: (_) async {
            events.add('apply');
            throw StateError('injected authoritative failure');
          },
          onReplace: (_) async => unexpected('replacement'),
        ),
      );

      await expectLater(loop.syncNow(), throwsA(isA<StateError>()));
      expect(events, ['apply']);
      expect(await queue.pullCheckpoint(), '0');
    },
  );

  test('atomic callbacks own and must persist pull checkpoints', () async {
    final events = <String>[];
    final queue = FakeQueue(events);
    var pulls = 0;
    final loop = ProtocolSyncLoop(
      queue,
      FakeTransport(
        onPull: (_, _, _) async {
          pulls++;
          return {
            'protocolVersion': 1,
            'checkpoint': '$pulls',
            'hasMore': false,
            'changes': [change('$pulls', 'record-$pulls')],
          };
        },
        onPush: (_, _) async => unexpected('push'),
        onSnapshot: (_, _) async => unexpected('snapshot'),
      ),
      AtomicFakeCallbacks(
        onApplyAtomic: (changes, checkpoint) async {
          events.add('atomic:${changes.single['recordId']}');
          await queue.setPullCheckpoint(checkpoint);
        },
        onReplaceAtomic: (_, _) async => unexpected('replacement'),
      ),
    );

    final result = await loop.syncNow();
    expect(events, [
      'atomic:record-1',
      'checkpoint:1',
      'atomic:record-2',
      'checkpoint:2',
    ]);
    expect(result.checkpoint, '2');

    final unsafeQueue = FakeQueue([]);
    final unsafe = ProtocolSyncLoop(
      unsafeQueue,
      FakeTransport(
        onPull: (_, _, _) async => {
          'protocolVersion': 1,
          'checkpoint': '1',
          'hasMore': false,
          'changes': [change('1', 'unsafe')],
        },
        onPush: (_, _) async => unexpected('push'),
        onSnapshot: (_, _) async => unexpected('snapshot'),
      ),
      AtomicFakeCallbacks(
        onApplyAtomic: (_, _) async {
          // Deliberately violates the atomic callback contract.
        },
        onReplaceAtomic: (_, _) async => unexpected('replacement'),
      ),
    );
    await expectLater(
      unsafe.syncNow(),
      throwsA(
        isA<SyncTransportException>()
            .having((error) => error.retryable, 'retryable', isFalse)
            .having(
              (error) => error.message,
              'message',
              contains('did not persist'),
            ),
      ),
    );
  });

  test('failed reset replacement does not advance checkpoint', () async {
    final events = <String>[];
    final queue = FakeQueue(events);
    final loop = ProtocolSyncLoop(
      queue,
      FakeTransport(
        onPull: (_, _, _) async => {
          'protocolVersion': 1,
          'error': 'RESET_REQUIRED',
        },
        onPush: (_, _) async => unexpected('push'),
        onSnapshot: (_, _) async => {
          'protocolVersion': 1,
          'checkpoint': '8',
          'records': [
            {
              'table': 'docs',
              'recordId': 'fresh',
              'record': {'fresh': true},
              'revision': '1',
            },
          ],
        },
      ),
      FakeCallbacks(
        onApply: (_) async {},
        onReplace: (_) async {
          events.add('replace');
          throw StateError('injected snapshot failure');
        },
      ),
    );

    await expectLater(loop.syncNow(), throwsA(isA<StateError>()));
    expect(events, ['replace']);
    expect(await queue.pullCheckpoint(), '0');
  });

  test(
    'malformed or regressing pages fail permanently before application',
    () async {
      for (final response in [
        {
          'protocolVersion': 1,
          'checkpoint': '0',
          'hasMore': false,
          'changes': [change('1', 'past-page-checkpoint')],
        },
        {
          'protocolVersion': 1,
          'checkpoint': '1',
          'hasMore': 'false',
          'changes': <Map<String, dynamic>>[],
        },
      ]) {
        final events = <String>[];
        final queue = FakeQueue(events);
        final loop = ProtocolSyncLoop(
          queue,
          FakeTransport(
            onPull: (_, _, _) async => response,
            onPush: (_, _) async => unexpected('push'),
            onSnapshot: (_, _) async => unexpected('snapshot'),
          ),
          FakeCallbacks(
            onApply: (_) async => events.add('apply'),
            onReplace: (_) async => events.add('replace'),
          ),
        );

        await expectLater(
          loop.syncNow(),
          throwsA(
            isA<SyncTransportException>().having(
              (error) => error.retryable,
              'retryable',
              isFalse,
            ),
          ),
        );
        expect(events, isEmpty);
        expect(await queue.pullCheckpoint(), '0');
      }
    },
  );

  test('concurrent syncNow callers share one flight', () async {
    final gate = Completer<void>();
    var pulls = 0;
    final loop = ProtocolSyncLoop(
      FakeQueue([]),
      FakeTransport(
        onPull: (checkpoint, _, _) async {
          pulls++;
          if (pulls == 1) await gate.future;
          return {
            'protocolVersion': 1,
            'checkpoint': checkpoint,
            'hasMore': false,
            'changes': <Map<String, dynamic>>[],
          };
        },
        onPush: (_, _) async => unexpected('push'),
        onSnapshot: (_, _) async => unexpected('snapshot'),
      ),
      FakeCallbacks(onApply: (_) async {}, onReplace: (_) async {}),
    );

    final first = loop.syncNow();
    final second = loop.syncNow();
    expect(identical(first, second), isTrue);
    gate.complete();
    await first;
    expect(pulls, 2);
  });

  test('retry delay uses bounded full jitter and Retry-After floor', () {
    expect(computeProtocolRetryDelay(1, random: () => 0), Duration.zero);
    expect(
      computeProtocolRetryDelay(4, random: () => 1),
      const Duration(seconds: 4),
    );
    expect(
      computeProtocolRetryDelay(40, random: () => 1),
      const Duration(seconds: 30),
    );
    expect(
      computeProtocolRetryDelay(
        2,
        random: () => 0.25,
        retryAfter: const Duration(seconds: 12),
      ),
      const Duration(seconds: 12),
    );
    expect(
      () => computeProtocolRetryDelay(1, random: () => 2),
      throwsRangeError,
    );
  });
}
