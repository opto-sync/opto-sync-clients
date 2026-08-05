import 'dart:async';

import 'package:opto_sync_reactive/opto_sync_reactive.dart';

Future<void> main() async {
  var calls = 0;
  final runner = BackgroundSyncRunner<int>(
    syncOnce: (_) {
      calls += 1;
      throw StateError('secure storage unavailable');
    },
  );

  late final Future<int> first;
  try {
    first = runner.runOnce();
  } catch (error) {
    throw StateError('runOnce leaked a synchronous exception: $error');
  }

  final second = runner.runOnce();
  if (!identical(first, second)) {
    throw StateError('setup failure did not preserve one visible Future');
  }

  for (final future in <Future<int>>[first, second]) {
    try {
      await future;
      throw StateError('expected background setup failure');
    } on StateError catch (error) {
      if (!error.message.toString().contains('secure storage unavailable')) {
        rethrow;
      }
    }
  }

  await Future<void>.delayed(Duration.zero);
  try {
    await runner.runOnce();
    throw StateError('expected a fresh background setup failure');
  } on StateError catch (error) {
    if (!error.message.toString().contains('secure storage unavailable')) {
      rethrow;
    }
  }

  if (calls != 2) {
    throw StateError('expected two serialized attempts, got $calls');
  }

  print('Background synchronous-failure regression test passed');
}
