import 'dart:async';

import 'package:opto_sync_reactive/opto_sync_reactive.dart';

Future<void> _waitFor(bool Function() test) async {
  final deadline = DateTime.now().add(const Duration(seconds: 2));
  while (!test()) {
    if (DateTime.now().isAfter(deadline)) {
      throw TimeoutException('desktop self-test condition did not become true');
    }
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

Future<void> _trailingWakeTest() async {
  final store = InMemoryDesktopLeaseStore();
  final releases = <Completer<void>>[];
  final reasons = <List<DesktopWakeReason>>[];
  var token = 0;
  final runner = DesktopSyncRunner<int>(
    leaseStore: store,
    leaseKey: 'account:one',
    ownerId: 'desktop-process-a',
    budget: const Duration(seconds: 2),
    leaseTtl: const Duration(seconds: 4),
    tokenFactory: () => 'token-${++token}',
    syncOnce: (context) async {
      reasons.add(context.reasons);
      final release = Completer<void>();
      releases.add(release);
      await release.future;
      return reasons.length;
    },
  );

  final first = runner.wake(DesktopWakeReason.processStart);
  await _waitFor(() => releases.length == 1);
  final second = runner.wake(DesktopWakeReason.localMutation);
  final third = runner.wake(DesktopWakeReason.remoteChange);
  if (!identical(first, second) || !identical(first, third)) {
    throw StateError('desktop wake burst did not share one drain');
  }

  releases.removeAt(0).complete();
  await _waitFor(() => releases.length == 1 && reasons.length == 2);
  releases.removeAt(0).complete();
  final result = await first;
  if (result.outcomes.length != 2 ||
      result.outcomes.any(
        (outcome) => outcome.status != DesktopSyncOutcomeStatus.completed,
      )) {
    throw StateError('desktop trailing cycle failed');
  }
  if (reasons[0].single != DesktopWakeReason.processStart ||
      reasons[1].join(',') !=
          <DesktopWakeReason>[
            DesktopWakeReason.localMutation,
            DesktopWakeReason.remoteChange,
          ].join(',')) {
    throw StateError('unexpected desktop wake grouping: $reasons');
  }
}

Future<void> _leaseTest() async {
  final store = InMemoryDesktopLeaseStore();
  final release = Completer<void>();
  final first = DesktopSyncRunner<String>(
    leaseStore: store,
    leaseKey: 'account:shared',
    ownerId: 'process-a',
    budget: const Duration(seconds: 2),
    leaseTtl: const Duration(seconds: 4),
    tokenFactory: () => 'token-a',
    syncOnce: (_) async {
      await release.future;
      return 'first';
    },
  );
  var secondCalls = 0;
  var secondToken = 0;
  final second = DesktopSyncRunner<String>(
    leaseStore: store,
    leaseKey: 'account:shared',
    ownerId: 'process-b',
    budget: const Duration(seconds: 2),
    leaseTtl: const Duration(seconds: 4),
    tokenFactory: () => 'token-b-${++secondToken}',
    syncOnce: (_) async {
      secondCalls += 1;
      return 'second';
    },
  );

  final active = first.runNow();
  await Future<void>.delayed(const Duration(milliseconds: 10));
  final blocked = await second.runNow();
  if (blocked.outcomes.single.status != DesktopSyncOutcomeStatus.busy ||
      secondCalls != 0) {
    throw StateError('durable desktop lease did not exclude process-b');
  }

  release.complete();
  final firstResult = await active;
  if (firstResult.outcomes.single.fence != '1') {
    throw StateError('unexpected first desktop fence');
  }
  final retry = await second.wake(DesktopWakeReason.connectivity);
  if (retry.outcomes.single.fence != '2' || secondCalls != 1) {
    throw StateError('desktop retry did not receive the next fence');
  }
}

void _capabilityTest() {
  final wasm = resolveDesktopSyncCapability(
    const DesktopCapabilityInput(
      runtime: DesktopRuntime.wasmWebView,
      serviceWorkerAvailable: true,
      tcpAvailable: true,
    ),
  );
  if (wasm.executionClass != DesktopExecutionClass.serviceWorkerEvents ||
      wasm.tcp != DesktopTcpCapability.unsupported ||
      wasm.survivesHostTermination ||
      wasm.exactIntervalsGuaranteed) {
    throw StateError('WASM desktop capability was overstated');
  }

  final electron = resolveDesktopSyncCapability(
    const DesktopCapabilityInput(
      runtime: DesktopRuntime.electron,
      persistentNativeRunnerAvailable: true,
      tcpAvailable: true,
    ),
  );
  if (electron.executionClass != DesktopExecutionClass.persistentNativeRunner ||
      electron.tcp != DesktopTcpCapability.native ||
      !electron.survivesHostTermination) {
    throw StateError('native desktop capability was understated');
  }

  try {
    resolveDesktopSyncCapability(
      const DesktopCapabilityInput(
        runtime: DesktopRuntime.wasmWebView,
        persistentNativeRunnerAvailable: true,
      ),
    );
    throw StateError('invalid WASM daemon capability was accepted');
  } on StateError catch (error) {
    if (!error.message.toString().contains('native host bridge')) rethrow;
  }
}

Future<void> main() async {
  _capabilityTest();
  await _trailingWakeTest();
  await _leaseTest();
  print('Dart desktop capability/lease/wake self-test passed');
}
