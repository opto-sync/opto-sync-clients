// Uniform cross-language conformance child for SQLite desktop coordination.
//
// Mirrors clients/desktop-rust/src/bin/opto_sync_sqlite_child.rs and
// clients/reactive-ts/tool/sqlite-conformance-child.ts exactly: same flags,
// same modes, same sentinel-prefixed JSON events. The orchestrator contends
// all three runtimes against a single SQLite database.
//
// The `@@OPTO@@` sentinel matters most here: `dart run` writes
// "Running build hooks..." to both stdout and stderr, which silently corrupts
// any child protocol that parses raw stream text. Parsing only sentinel lines
// keeps the corpus deterministic regardless of toolchain chatter.

import 'dart:convert';
import 'dart:io';

import 'package:opto_sync_reactive/opto_sync_reactive_sqlite.dart';

const String sentinel = '@@OPTO@@';

void emit(String event, Map<String, Object?> fields) {
  final payload = <String, Object?>{
    'event': event,
    'runtime': 'dart',
    ...fields,
  };
  stdout.writeln('$sentinel ${jsonEncode(payload)}');
}

String? flag(List<String> args, String name) {
  final index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return null;
  return args[index + 1];
}

String required(List<String> args, String name) {
  final value = flag(args, name);
  if (value == null) {
    stderr.writeln('missing required flag $name');
    exit(2);
  }
  return value;
}

Future<int> run(List<String> args) async {
  final db = required(args, '--db');
  final key = required(args, '--key');
  final owner = required(args, '--owner');
  final mode = required(args, '--mode');
  final holdMs = int.tryParse(flag(args, '--hold-ms') ?? '0') ?? 0;
  final ttlMs = int.tryParse(flag(args, '--ttl-ms') ?? '5000') ?? 5000;

  late final SqliteDesktopCoordinator coordinator;
  try {
    coordinator = SqliteDesktopCoordinator.open(
      db,
      options: const SqliteDesktopCoordinatorOptions(
        busyTimeout: Duration(seconds: 10),
      ),
    );
  } on Object catch (error) {
    emit('error', <String, Object?>{'message': error.toString()});
    return 1;
  }

  try {
    if (mode == 'wake') {
      final receipt = coordinator.signalWake(key);
      emit('wake', <String, Object?>{
        'generation': receipt.generation,
        'handledGeneration': receipt.handledGeneration,
        'dirty': receipt.dirty,
      });
      return 0;
    }

    if (mode == 'state') {
      final state = coordinator.readState(key);
      emit('state', <String, Object?>{
        'fence': state.fence,
        'wakeGeneration': state.wakeGeneration,
        'handledGeneration': state.handledGeneration,
        'dirty': state.dirty,
        'owned': state.owned,
      });
      return 0;
    }

    if (mode == 'contend' || mode == 'acquire-hold') {
      coordinator.signalWake(key);
      final result = coordinator.acquire(
        SqliteDesktopAcquireRequest(
          key: key,
          ownerId: owner,
          token: '$owner-token',
          leaseTtl: Duration(milliseconds: ttlMs),
        ),
      );

      switch (result) {
        case SqliteDesktopBusy(
          :final wakeGeneration,
          :final handledGeneration,
          :final retryAfterMs,
        ):
          emit('busy', <String, Object?>{
            'wakeGeneration': wakeGeneration,
            'handledGeneration': handledGeneration,
            'retryAfterMs': retryAfterMs,
          });
          return 0;
        case SqliteDesktopAcquired(:final grant):
          emit('acquired', <String, Object?>{
            'fence': grant.fence,
            'owner': grant.ownerId,
            'wakeGeneration': grant.wakeGeneration,
          });
          await stdout.flush();

          if (holdMs > 0) {
            await Future<void>.delayed(Duration(milliseconds: holdMs));
          }

          // acquire-hold exits while still holding, to exercise expiry replay.
          if (mode == 'acquire-hold') return 0;

          final completion = coordinator.complete(grant, grant.wakeGeneration);
          emit('completed', <String, Object?>{
            'released': completion.released,
            'currentWakeGeneration': completion.currentWakeGeneration,
            'handledGeneration': completion.handledGeneration,
          });
          return 0;
      }
    }

    emit('error', <String, Object?>{'message': 'unknown mode $mode'});
    return 2;
  } on Object catch (error) {
    emit('error', <String, Object?>{'message': error.toString()});
    return 1;
  } finally {
    coordinator.close();
  }
}

Future<void> main(List<String> args) async {
  final code = await run(args);
  await stdout.flush();
  exit(code);
}
