import 'dart:ui';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:opto_sync_flutter_background/opto_sync_flutter_background.dart';

@pragma('vm:entry-point')
Future<bool> _drain() async => true;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final calls = <MethodCall>[];
  final backgroundCalls = <MethodCall>[];
  const backgroundChannel = MethodChannel('dev.optosync.background/background');

  setUp(() {
    calls.clear();
    backgroundCalls.clear();
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger
      ..setMockMethodCallHandler(backgroundChannel, (call) async {
        backgroundCalls.add(call);
        return null;
      })
      ..setMockMethodCallHandler(
        const MethodChannel('dev.optosync.background/methods'),
        (call) async {
          calls.add(call);
          if (call.method == 'scheduleExpedited' && _failExpedited) {
            throw PlatformException(code: 'QUOTA');
          }
          if (call.method == 'scheduleExpedited' && _missingExpedited) {
            throw MissingPluginException('unsupported host');
          }
          if (call.method == 'cancelAll' && _failCancel) {
            throw PlatformException(code: 'CANCEL_FAILED');
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

  test('registerPeriodic rejects a cadence WorkManager cannot honor', () async {
    await expectLater(
      OptoSyncBackground.registerPeriodic(
        frequency: const Duration(minutes: 14, seconds: 59),
      ),
      throwsRangeError,
    );
    expect(calls, isEmpty);
  });

  test(
    'registerPeriodic accepts and forwards the exact platform floor',
    () async {
      await OptoSyncBackground.registerPeriodic(
        frequency: OptoSyncBackground.minimumPeriodicFrequency,
        requiresNetwork: false,
      );
      expect(calls.single.arguments, {
        'frequencySeconds': 900,
        'requiresNetwork': false,
      });
    },
  );

  test('scheduleExpedited swallows platform scheduling failures', () async {
    _failExpedited = true;
    addTearDown(() => _failExpedited = false);
    await OptoSyncBackground.scheduleExpedited(); // must not throw
    expect(calls.single.method, 'scheduleExpedited');
  });

  test('scheduleExpedited also tolerates an unsupported platform', () async {
    _missingExpedited = true;
    addTearDown(() => _missingExpedited = false);
    await OptoSyncBackground.scheduleExpedited();
    expect(calls.single.method, 'scheduleExpedited');
  });

  test('scheduleExpedited does not hide programmer Errors', () async {
    final original = OptoSyncBackground.channel;
    OptoSyncBackground.channel = const _ErrorChannel();
    addTearDown(() => OptoSyncBackground.channel = original);

    await expectLater(
      OptoSyncBackground.scheduleExpedited(),
      throwsA(isA<StateError>()),
    );
  });

  test('cancelAll forwards', () async {
    await OptoSyncBackground.cancelAll();
    expect(calls.single.method, 'cancelAll');
  });

  test('cancelAll surfaces an explicit cancellation failure', () async {
    _failCancel = true;
    addTearDown(() => _failCancel = false);
    await expectLater(
      OptoSyncBackground.cancelAll(),
      throwsA(isA<PlatformException>()),
    );
  });

  test(
    'background dispatcher validates malformed callback arguments',
    () async {
      await OptoSyncBackground.setupBackgroundChannel();
      expect(backgroundCalls.single.method, 'backgroundChannelReady');

      for (final arguments in <Object?>[
        null,
        'not-a-map',
        <String, Object?>{},
        <String, Object?>{'callbackHandle': 0},
        <String, Object?>{'callbackHandle': -1},
        <String, Object?>{'callbackHandle': '1'},
      ]) {
        final response = await _invokeFrameworkChannel(
          backgroundChannel.name,
          MethodCall('runDrain', arguments),
        );
        expect(
          () => const StandardMethodCodec().decodeEnvelope(response!),
          throwsA(anyOf(isA<ArgumentError>(), isA<PlatformException>())),
          reason: 'arguments $arguments must not reach a callback',
        );
      }
    },
  );

  test(
    'background dispatcher restores and invokes the registered drain',
    () async {
      await OptoSyncBackground.setupBackgroundChannel();
      final handle = PluginUtilities.getCallbackHandle(_drain)!;
      final response = await _invokeFrameworkChannel(
        backgroundChannel.name,
        MethodCall('runDrain', {'callbackHandle': handle.toRawHandle()}),
      );

      expect(const StandardMethodCodec().decodeEnvelope(response!), isTrue);
    },
  );
}

bool _failExpedited = false;
bool _missingExpedited = false;
bool _failCancel = false;

class _ErrorChannel extends MethodChannel {
  const _ErrorChannel() : super('dev.optosync.background/error-test');

  @override
  Future<T?> invokeMethod<T>(String method, [Object? arguments]) async {
    throw StateError('programmer error');
  }
}

Future<ByteData?> _invokeFrameworkChannel(String channel, MethodCall call) =>
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .handlePlatformMessage(
          channel,
          const StandardMethodCodec().encodeMethodCall(call),
          null,
        );
