import 'dart:async';
import 'dart:io';

import 'package:opto_sync_reactive/opto_sync_reactive_sqlite.dart';

Future<void> main(List<String> arguments) async {
  if (arguments.length < 5) {
    throw ArgumentError(
      'expected mode, path, key, owner, and hold milliseconds',
    );
  }
  final mode = arguments[0];
  final path = arguments[1];
  final key = arguments[2];
  final owner = arguments[3];
  final hold = Duration(milliseconds: int.parse(arguments[4]));
  final leaseTtl = Duration(
    milliseconds: arguments.length > 5 ? int.parse(arguments[5]) : 1000,
  );
  final coordinator = SqliteDesktopCoordinator.open(
    path,
    options: const SqliteDesktopCoordinatorOptions(
      busyTimeout: Duration(seconds: 10),
    ),
  );
  try {
    if (mode == 'contend') {
      coordinator.signalWake(key);
      final result = coordinator.acquire(
        SqliteDesktopAcquireRequest(
          key: key,
          ownerId: owner,
          token: '$owner-token',
          leaseTtl: const Duration(seconds: 2),
        ),
      );
      switch (result) {
        case SqliteDesktopBusy(:final wakeGeneration):
          stdout.writeln('busy:$wakeGeneration');
        case SqliteDesktopAcquired(:final grant):
          stdout.writeln('acquired:${grant.fence}');
          await stdout.flush();
          await Future<void>.delayed(hold);
          coordinator.complete(grant, grant.wakeGeneration);
      }
    } else if (mode == 'acquire-and-exit') {
      coordinator.signalWake(key);
      final result = coordinator.acquire(
        SqliteDesktopAcquireRequest(
          key: key,
          ownerId: owner,
          token: '$owner-token',
          leaseTtl: leaseTtl,
        ),
      );
      if (result is! SqliteDesktopAcquired) {
        throw StateError('expected acquisition');
      }
      stdout.writeln('acquired:${result.grant.fence}');
      await stdout.flush();
      await Future<void>.delayed(hold);
    } else {
      throw ArgumentError.value(mode, 'mode', 'unknown child mode');
    }
  } finally {
    coordinator.close();
  }
}
