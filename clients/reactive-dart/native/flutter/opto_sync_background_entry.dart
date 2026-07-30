// Copy this file into the host Flutter application and replace
// createAppBackgroundRunner with the application's authenticated opto-sync
// composition root. It intentionally lives outside lib/ so the pure-Dart
// package remains analyzable without a Flutter SDK.
import 'package:flutter/services.dart';
import 'package:opto_sync_reactive/opto_sync_reactive.dart';

const _channelName = 'opto-sync/background';

Future<BackgroundSyncRunner<Object?>> createAppBackgroundRunner() async {
  throw UnimplementedError(
    'restore shared-auth/Supabase credentials from secure storage and construct '
    'the application ProtocolSyncLoop here',
  );
}

@pragma('vm:entry-point')
Future<void> optoSyncBackgroundMain() async {
  WidgetsFlutterBinding.ensureInitialized();
  final runner = await createAppBackgroundRunner();
  const channel = MethodChannel(_channelName);
  channel.setMethodCallHandler((call) async {
    switch (call.method) {
      case 'runOnce':
        return runner.runOnce();
      case 'cancel':
        // A bounded cycle must observe its own deadline/cancellation source.
        // Never delete queue rows when the OS expires a worker.
        return null;
      default:
        throw MissingPluginException('unknown opto-sync background method');
    }
  });
  // Native owns process/task completion. The isolate remains available only for
  // the bounded BGTask/WorkManager invocation and may be killed immediately.
}
