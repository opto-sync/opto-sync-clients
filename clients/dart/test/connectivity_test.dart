import 'package:opto_sync_client/connectivity.dart';
import 'package:test/test.dart';

void main() {
  test('forced offline hides automatic updates until restored', () async {
    final watcher = ManualOptoSyncConnectivityWatcher();
    final states = <OptoSyncConnectivitySnapshot>[];
    final subscription = watcher.changes.listen(states.add);

    watcher.publish(OptoSyncConnectivityState.link);
    watcher.setTotalOffline(true);
    watcher.publish(OptoSyncConnectivityState.internet);

    expect(watcher.snapshot.state, OptoSyncConnectivityState.offline);
    expect(watcher.snapshot.mode, OptoSyncConnectivityMode.offline);
    expect(states, hasLength(2));

    watcher.setTotalOffline(false);
    expect(watcher.snapshot.state, OptoSyncConnectivityState.internet);
    expect(watcher.snapshot.hasVerifiedInternet, isTrue);
    await subscription.cancel();
    await watcher.close();
  });

  test('save signal runs only after durable operation resolves', () async {
    final watcher = ManualOptoSyncConnectivityWatcher(
      initialState: OptoSyncConnectivityState.internet,
    );
    var durable = false;
    var wakes = 0;
    final observed = <OptoSyncLocalSaveEvent>[];
    final signals = OptoSyncConnectivitySaveSignals(
      watcher: watcher,
      onMutationQueued: () => wakes += 1,
      onSave: (event) {
        expect(durable, isTrue);
        observed.add(event);
        throw StateError('hook failure must not reject the save');
      },
    );

    final result = await signals.afterDurableSave<int>(
      save: () async {
        durable = true;
        return 42;
      },
      queueId: (value) => value,
      tableName: 'docs',
      recordId: 'one',
      operation: OptoSyncSaveOperation.upsert,
    );

    expect(result, 42);
    expect(observed.single.connectivity.hasVerifiedInternet, isTrue);
    expect(wakes, 1);

    signals.setTotalOffline(true);
    signals.notifyAfterDurableSave(
      queueId: 43,
      tableName: 'docs',
      recordId: 'two',
      operation: OptoSyncSaveOperation.delete,
    );
    expect(wakes, 1);

    watcher.publish(OptoSyncConnectivityState.internet);
    signals.setTotalOffline(false);
    expect(wakes, 2);

    await signals.dispose();
    await watcher.close();
  });
}
