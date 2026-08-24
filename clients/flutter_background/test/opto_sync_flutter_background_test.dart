import 'dart:async';
import 'dart:ui';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:opto_sync_flutter_background/opto_sync_flutter_background.dart';

@pragma('vm:entry-point')
Future<bool> _drain() async => true;

@pragma('vm:entry-point')
Future<bool> _blockingDrain() {
  _blockingDrainCalls += 1;
  return _blockingDrainResult!.future;
}

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

  test('dispatcher handle restores the top-level engine entrypoint', () async {
    await OptoSyncBackground.initialize(_drain);
    final arguments = calls.single.arguments as Map;
    final handle = CallbackHandle.fromRawHandle(
      arguments['dispatcherHandle'] as int,
    );
    final dispatcher = PluginUtilities.getCallbackFromHandle(handle);

    expect(dispatcher, same(optoSyncBackgroundDispatcher));
    await (dispatcher! as Future<void> Function())();
    expect(backgroundCalls.single.method, 'backgroundChannelReady');
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

  test(
    'authenticated facade orders login, fenced logout, OTEL flush, and clear',
    () async {
      final order = <String>[];
      final lifecycle = OptoSyncFlutterSessionLifecycle(
        sync: (reason) async {
          order.add('${reason.name}-sync');
          final count = reason == SessionSyncReason.logout ? 2 : 0;
          return DurableSyncReceipt(
            pendingBefore: count,
            acknowledged: count,
            admittedDuringDrain: 0,
            pendingAfter: 0,
            checkpointCommitted: true,
            admissionFenced: true,
          );
        },
        forceFlushOresTelemetry: () async => order.add('otel-force-flush'),
        clearCredentials: (_) async => order.add('credentials-clear'),
        fenceSessionWrites: () async => order.add('fence-writes'),
        cancelBackgroundWork: () async => order.add('cancel-background'),
      );
      final identity = OptoSyncSessionIdentity(
        subject: 'subject-1',
        tenant: 'tenant-a',
        authEpoch: 7,
      );

      expect((await lifecycle.onLogin(identity)).syncSucceeded, isTrue);
      final logout = await lifecycle.onLogout();

      expect(logout.complete, isTrue);
      expect(lifecycle.session, isNull);
      expect(order, [
        'login-sync',
        'fence-writes',
        'cancel-background',
        'logout-sync',
        'otel-force-flush',
        'credentials-clear',
      ]);
    },
  );

  test(
    'failed Flutter admission fence cannot produce a drained logout claim',
    () async {
      final errors = <String>[];
      var cleared = false;
      final lifecycle = OptoSyncFlutterSessionLifecycle(
        sync: (_) async => DurableSyncReceipt(
          pendingBefore: 1,
          acknowledged: 1,
          admittedDuringDrain: 0,
          pendingAfter: 0,
          checkpointCommitted: true,
          admissionFenced: true,
        ),
        forceFlushOresTelemetry: () async {},
        clearCredentials: (_) async => cleared = true,
        fenceSessionWrites: () async => throw StateError('writer still active'),
        cancelBackgroundWork: () async {},
        onLifecycleError: (_, operation) => errors.add(operation),
      );
      await lifecycle.onLogin(
        OptoSyncSessionIdentity(
          subject: 'subject-1',
          tenant: 'tenant-a',
          authEpoch: 7,
        ),
      );

      final logout = await lifecycle.onLogout();

      expect(logout.dataDurablyDrained, isFalse);
      expect(cleared, isTrue);
      expect(errors, ['fence-session-writes']);
    },
  );

  test(
    'concurrent login and logout serialize the complete Flutter boundary',
    () async {
      final loginGate = Completer<DurableSyncReceipt>();
      final order = <String>[];
      final lifecycle = OptoSyncFlutterSessionLifecycle(
        sync: (reason) {
          order.add('${reason.name}-sync');
          if (reason == SessionSyncReason.login) return loginGate.future;
          return Future.value(
            DurableSyncReceipt(
              pendingBefore: 0,
              acknowledged: 0,
              admittedDuringDrain: 0,
              pendingAfter: 0,
              checkpointCommitted: true,
              admissionFenced: true,
            ),
          );
        },
        forceFlushOresTelemetry: () async => order.add('flush'),
        clearCredentials: (_) async => order.add('clear'),
        fenceSessionWrites: () async => order.add('fence'),
        cancelBackgroundWork: () async => order.add('cancel'),
      );
      final identity = OptoSyncSessionIdentity(
        subject: 'subject-1',
        tenant: 'tenant-a',
        authEpoch: 7,
      );

      final login = lifecycle.onLogin(identity);
      final logout = lifecycle.onLogout();
      await Future<void>.delayed(Duration.zero);
      expect(order, ['login-sync']);
      loginGate.complete(
        DurableSyncReceipt(
          pendingBefore: 0,
          acknowledged: 0,
          admittedDuringDrain: 0,
          pendingAfter: 0,
          checkpointCommitted: true,
          admissionFenced: true,
        ),
      );
      await login;
      await logout;
      expect(order, [
        'login-sync',
        'fence',
        'cancel',
        'logout-sync',
        'flush',
        'clear',
      ]);
    },
  );

  test('concurrent duplicate Flutter logout calls coalesce', () async {
    var fences = 0;
    var flushes = 0;
    final lifecycle = OptoSyncFlutterSessionLifecycle(
      sync: (_) async => DurableSyncReceipt(
        pendingBefore: 0,
        acknowledged: 0,
        admittedDuringDrain: 0,
        pendingAfter: 0,
        checkpointCommitted: true,
        admissionFenced: true,
      ),
      forceFlushOresTelemetry: () async => flushes += 1,
      clearCredentials: (_) async {},
      fenceSessionWrites: () async => fences += 1,
      cancelBackgroundWork: () async {},
    );
    await lifecycle.onLogin(
      OptoSyncSessionIdentity(
        subject: 'subject-1',
        tenant: 'tenant-a',
        authEpoch: 7,
      ),
    );

    final first = lifecycle.onLogout();
    final second = lifecycle.onLogout();
    expect(identical(first, second), isTrue);
    await Future.wait([first, second]);
    expect(fences, 1);
    expect(flushes, 1);
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
      await optoSyncBackgroundDispatcher();
      expect(backgroundCalls.single.method, 'backgroundChannelReady');

      for (final arguments in <Object?>[
        null,
        'not-a-map',
        <String, Object?>{},
        <String, Object?>{'callbackHandle': 0},
        <String, Object?>{'callbackHandle': '1'},
        <String, Object?>{'callbackHandle': 1.0},
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

  test('background dispatcher treats signed non-zero handles as structurally valid', () async {
    await optoSyncBackgroundDispatcher();
    final response = await _invokeFrameworkChannel(
      backgroundChannel.name,
      const MethodCall('runDrain', {'callbackHandle': -1}),
    );

    expect(
      () => const StandardMethodCodec().decodeEnvelope(response!),
      throwsA(
        isA<PlatformException>().having(
          (error) => error.message,
          'message',
          contains('registered callback is not a BackgroundDrain'),
        ),
      ),
    );
  });

  test(
    'background dispatcher restores and invokes the registered drain',
    () async {
      await optoSyncBackgroundDispatcher();
      final handle = PluginUtilities.getCallbackHandle(_drain)!;
      final rawHandle = handle.toRawHandle();
      expect(rawHandle, isNot(0));
      final response = await _invokeFrameworkChannel(
        backgroundChannel.name,
        MethodCall('runDrain', {'callbackHandle': rawHandle}),
      );

      expect(const StandardMethodCodec().decodeEnvelope(response!), isTrue);
    },
  );

  test(
    'dispatcher coalesces concurrent native drains into one cycle',
    () async {
      await optoSyncBackgroundDispatcher();
      _blockingDrainCalls = 0;
      _blockingDrainResult = Completer<bool>();
      addTearDown(() => _blockingDrainResult = null);
      final rawHandle = PluginUtilities.getCallbackHandle(_blockingDrain)!
          .toRawHandle();
      final first = _invokeFrameworkChannel(
        backgroundChannel.name,
        MethodCall('runDrain', {'callbackHandle': rawHandle}),
      );
      final second = _invokeFrameworkChannel(
        backgroundChannel.name,
        MethodCall('runDrain', {'callbackHandle': rawHandle}),
      );

      await Future<void>.delayed(Duration.zero);
      expect(_blockingDrainCalls, 1);
      _blockingDrainResult!.complete(true);
      expect(
        const StandardMethodCodec().decodeEnvelope((await first)!),
        isTrue,
      );
      expect(
        const StandardMethodCodec().decodeEnvelope((await second)!),
        isTrue,
      );
    },
  );
}

bool _failExpedited = false;
bool _missingExpedited = false;
bool _failCancel = false;
int _blockingDrainCalls = 0;
Completer<bool>? _blockingDrainResult;

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
