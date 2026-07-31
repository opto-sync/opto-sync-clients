import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:opto_sync_flutter_background/opto_sync_flutter_background.dart';

@pragma('vm:entry-point')
Future<bool> _drain() async => true;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final calls = <MethodCall>[];

  setUp(() {
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('dev.optosync.background/methods'),
      (call) async {
        calls.add(call);
        if (call.method == 'scheduleExpedited' && _failExpedited) {
          throw PlatformException(code: 'QUOTA');
        }
        return null;
      },
    );
  });

  test('initialize registers both the drain and dispatcher handles', () async {
    await OptoSyncBackground.initialize(_drain);
    expect(calls.single.method, 'initialize');
    final arguments = calls.single.arguments as Map;
    expect(arguments['callbackHandle'], isA<int>());
    expect(arguments['dispatcherHandle'], isA<int>());
    expect(arguments['callbackHandle'], isNot(arguments['dispatcherHandle']));
  });

  test('initialize rejects a closure (no callback handle)', () async {
    await expectLater(
      OptoSyncBackground.initialize(() async => true),
      throwsArgumentError,
    );
  });

  test('registerPeriodic forwards frequency and network constraint', () async {
    await OptoSyncBackground.registerPeriodic(
      frequency: const Duration(minutes: 30),
      requiresNetwork: true,
    );
    expect(calls.single.method, 'registerPeriodic');
    expect(calls.single.arguments, {
      'frequencySeconds': 1800,
      'requiresNetwork': true,
    });
  });

  test('scheduleExpedited swallows platform scheduling failures', () async {
    _failExpedited = true;
    addTearDown(() => _failExpedited = false);
    await OptoSyncBackground.scheduleExpedited(); // must not throw
    expect(calls.single.method, 'scheduleExpedited');
  });

  test('cancelAll forwards', () async {
    await OptoSyncBackground.cancelAll();
    expect(calls.single.method, 'cancelAll');
  });
}

bool _failExpedited = false;
