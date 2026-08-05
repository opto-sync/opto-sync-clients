import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:opto_sync_flutter_background/opto_sync_connectivity.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('total-offline changes local state before invoking native bridge', () async {
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(OptoSyncFlutterConnectivity.methods, (call) async {
      calls.add(call);
      return <String, Object?>{
        'state': 'offline',
        'mode': 'offline',
        'source': 'forced-offline',
      };
    });

    final connectivity = OptoSyncFlutterConnectivity();
    connectivity.setTotalOffline(true);

    expect(connectivity.snapshot.mode, OptoSyncConnectivityMode.offline);
    expect(connectivity.snapshot.state, OptoSyncConnectivityState.offline);
    await Future<void>.delayed(Duration.zero);
    expect(calls.single.method, 'setConnectivityOffline');
    expect((calls.single.arguments as Map)['enabled'], isTrue);

    await connectivity.dispose();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(OptoSyncFlutterConnectivity.methods, null);
  });
}
