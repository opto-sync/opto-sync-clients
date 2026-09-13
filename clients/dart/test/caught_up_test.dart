import 'package:opto_sync_client/caught_up.dart';
import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:test/test.dart';

class _Queue implements ProtocolQueueAdapter {
  String checkpoint;

  _Queue([this.checkpoint = '0']);

  @override
  Future<int> acknowledgePush(
    Map<String, dynamic> response,
    Map<String, dynamic> request,
  ) async => 0;

  @override
  Future<void> installSnapshot(
    Map<String, dynamic> snapshot,
    Future<void> Function(List<Map<String, dynamic>> records)
    replaceAuthoritative,
  ) async {
    await replaceAuthoritative(const []);
    checkpoint = snapshot['checkpoint'] as String;
  }

  @override
  Future<String> pullCheckpoint() async => checkpoint;

  @override
  Future<Map<String, dynamic>> protocolPushRequest({int limit = 100}) async => {
    'protocolVersion': 1,
    'clientId': 'device-a',
    'mutations': <Map<String, dynamic>>[],
  };

  @override
  Future<void> setPullCheckpoint(String checkpoint) async {
    this.checkpoint = checkpoint;
  }
}

class _Transport implements ProtocolTransport {
  final _Queue queue;
  final List<String> pullCheckpoints = [];

  _Transport(this.queue);

  @override
  Future<Map<String, dynamic>> pull(
    String checkpoint,
    int limit,
    ProtocolCancellationToken cancellation,
  ) async {
    pullCheckpoints.add(checkpoint);
    final next = checkpoint == '0' ? '2' : checkpoint;
    return {
      'protocolVersion': 1,
      'checkpoint': next,
      'hasMore': false,
      'changes': next == checkpoint
          ? <Map<String, dynamic>>[]
          : <Map<String, dynamic>>[
              {
                'checkpoint': next,
                'table': 'docs',
                'recordId': 'r-$next',
                'operation': 'upsert',
                'record': {'id': 'r-$next'},
                'revision': next,
              },
            ],
    };
  }

  @override
  Future<Map<String, dynamic>> push(
    Map<String, dynamic> request,
    ProtocolCancellationToken cancellation,
  ) async => {
    'protocolVersion': 1,
    'clientId': 'device-a',
    'lastMutationId': '0',
    'results': <Map<String, dynamic>>[],
  };

  @override
  Future<Map<String, dynamic>> snapshot(
    ProtocolCancellationToken cancellation, [
    Map<String, dynamic>? reset,
  ]) async => {
    'protocolVersion': 1,
    'checkpoint': queue.checkpoint,
    'records': <Map<String, dynamic>>[],
  };
}

class _Callbacks implements ProtocolSyncCallbacks {
  final _Queue queue;

  _Callbacks(this.queue);

  @override
  Future<void> applyChanges(List<Map<String, dynamic>> changes) async {}

  @override
  Future<void> replaceAuthoritative(List<Map<String, dynamic>> records) async {}
}

void main() {
  test('checkpointReached compares arbitrary-size decimal strings', () {
    expect(checkpointReached('9', '10'), isFalse);
    expect(checkpointReached('10', '10'), isTrue);
    expect(checkpointReached('100000000000000000000', '99'), isTrue);
    expect(
      () => checkpointReached('01', '1'),
      throwsA(
        isA<CaughtUpBarrierException>().having(
          (error) => error.code,
          'code',
          CaughtUpBarrierErrorCode.invalidLocalCheckpoint,
        ),
      ),
    );
  });

  test('awaitCaughtUp completes only after durable queue checkpoint advances', () async {
    final queue = _Queue();
    final transport = _Transport(queue);
    final callbacks = _Callbacks(queue);
    final loop = ProtocolSyncLoop(queue, transport, callbacks);

    final result = await awaitCaughtUp(
      loop,
      queue,
      const AuthoritativeCheckpointTarget(checkpoint: '2'),
      timeout: const Duration(seconds: 1),
      pollInterval: Duration.zero,
    );

    expect(result.checkpoint, '2');
    expect(result.cycles, 1);
    expect(result.alreadyCaughtUp, isFalse);
    expect(await queue.pullCheckpoint(), '2');
    expect(transport.pullCheckpoints, ['0', '2']);
  });

  test('already caught up never starts a sync cycle', () async {
    final queue = _Queue('8');
    final transport = _Transport(queue);
    final loop = ProtocolSyncLoop(queue, transport, _Callbacks(queue));

    final result = await awaitCaughtUp(
      loop,
      queue,
      const AuthoritativeCheckpointTarget(checkpoint: '7'),
      timeout: const Duration(seconds: 1),
    );

    expect(result.alreadyCaughtUp, isTrue);
    expect(result.cycles, 0);
    expect(transport.pullCheckpoints, isEmpty);
  });

  test('generation mismatch fails closed', () async {
    final queue = _Queue();
    final loop = ProtocolSyncLoop(queue, _Transport(queue), _Callbacks(queue));

    await expectLater(
      awaitCaughtUp(
        loop,
        queue,
        const AuthoritativeCheckpointTarget(
          checkpoint: '2',
          generation: 'scope-b',
        ),
        expectedGeneration: 'scope-a',
      ),
      throwsA(
        isA<CaughtUpBarrierException>().having(
          (error) => error.code,
          'code',
          CaughtUpBarrierErrorCode.invalidated,
        ),
      ),
    );
  });

  test('caller cancellation does not stop the shared sync loop', () async {
    final queue = _Queue();
    final cancellation = CaughtUpCancellationToken();
    late void Function() release;
    final gate = Future<void>(() {});
    final transport = _BlockingTransport(queue, (complete) => release = complete);
    final loop = ProtocolSyncLoop(queue, transport, _Callbacks(queue));

    final wait = awaitCaughtUp(
      loop,
      queue,
      const AuthoritativeCheckpointTarget(checkpoint: '2'),
      timeout: const Duration(seconds: 1),
      cancellation: cancellation,
    );
    await gate;
    cancellation.cancel();
    await expectLater(
      wait,
      throwsA(
        isA<CaughtUpBarrierException>().having(
          (error) => error.code,
          'code',
          CaughtUpBarrierErrorCode.cancelled,
        ),
      ),
    );

    // Cancellation belongs to this waiter only. The ProtocolSyncLoop cycle is
    // still live and can finish normally for other/background callers.
    release();
    final cycle = await loop.syncNow();
    expect(cycle.checkpoint, '2');
  });
}

class _BlockingTransport extends _Transport {
  final void Function(void Function() complete) captureRelease;
  bool blocked = false;

  _BlockingTransport(super.queue, this.captureRelease);

  @override
  Future<Map<String, dynamic>> pull(
    String checkpoint,
    int limit,
    ProtocolCancellationToken cancellation,
  ) async {
    if (!blocked && checkpoint == '0') {
      blocked = true;
      final completer = Completer<void>();
      captureRelease(() => completer.complete());
      await completer.future;
    }
    return super.pull(checkpoint, limit, cancellation);
  }
}
