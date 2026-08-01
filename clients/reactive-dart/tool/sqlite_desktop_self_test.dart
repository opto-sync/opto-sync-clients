import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:opto_sync_reactive/opto_sync_reactive_sqlite.dart';

final class _Fixture {
  _Fixture()
    : directory = Directory.systemTemp.createTempSync(
        'opto-sync-dart-sqlite-',
      ) {
    path = '${directory.path}${Platform.pathSeparator}coordination.sqlite3';
  }

  final Directory directory;
  late final String path;

  void dispose() {
    if (directory.existsSync()) directory.deleteSync(recursive: true);
  }
}

void _expect(bool condition, String message) {
  if (!condition) throw StateError(message);
}

SqliteDesktopLeaseGrant _acquired(SqliteDesktopAcquireResult result) {
  if (result case SqliteDesktopAcquired(:final grant)) return grant;
  throw StateError('expected SQLite lease acquisition');
}

/// Child stderr with the Dart SDK's own informational chatter removed.
///
/// `dart run` prints "Running build hooks..." progress to stderr on SDKs with
/// native build hooks; only output beyond that indicates a child failure.
String _meaningfulStderr(String stderr) {
  return stderr
      .replaceAll('Running build hooks...', '')
      .split('\n')
      .map((line) => line.trim())
      .where((line) => line.isNotEmpty)
      .join('\n');
}

/// The child built as a standalone bundle, set by [_buildChild].
///
/// `dart run` re-bundles native assets into the SHARED `.dart_tool/lib/` on
/// every invocation, so spawning children that way makes concurrent processes
/// fight over one directory: Windows refuses to delete a DLL the parent has
/// loaded (PathAccessException), and macOS races re-codesigning the dylib.
/// Neither is lease contention — the behavior under test — so the child is
/// built once and every spawn reuses that immutable bundle.
///
/// `dart build cli`, not `dart compile exe`: the sqlite3 package ships a
/// build hook, and `dart compile` refuses those outright ("does not support
/// build hooks, use 'dart build' instead"). `dart build cli` runs the hook and
/// copies the resulting library into the bundle, so the child carries its own
/// SQLite instead of resolving one from the shared directory — or, as on
/// macOS, silently from the host system.
late final String _childExecutable;

Future<Directory> _buildChild() async {
  final buildDir = Directory.systemTemp.createTempSync('opto-sync-dart-child-');
  final result = await Process.run(Platform.resolvedExecutable, <String>[
    'build',
    'cli',
    '--target',
    'bin/sqlite_desktop_child.dart',
    '--output',
    buildDir.path,
  ], workingDirectory: Directory.current.path);
  if (result.exitCode != 0) {
    buildDir.deleteSync(recursive: true);
    throw StateError(
      'could not build the coordination child '
      '(exit ${result.exitCode}): ${result.stderr}',
    );
  }
  // `--output <dir>` writes <dir>/bundle/bin/<name>, with the host's
  // executable suffix.
  final binDir = Directory(
    <String>[
      buildDir.path,
      'bundle',
      'bin',
    ].join(Platform.pathSeparator),
  );
  final executable = binDir
      .listSync()
      .whereType<File>()
      .map((entry) => entry.path)
      .firstWhere(
        (path) => path.contains('sqlite_desktop_child'),
        orElse: () => throw StateError(
          'the child bundle has no executable in ${binDir.path}',
        ),
      );
  _childExecutable = executable;
  return buildDir;
}

Future<ProcessResult> _runChild(List<String> arguments) {
  return Process.run(
    _childExecutable,
    arguments,
    workingDirectory: Directory.current.path,
  );
}

Future<({Process process, Future<String> stderr})> _startHolder(
  List<String> arguments,
) async {
  final process = await Process.start(
    _childExecutable,
    arguments,
    workingDirectory: Directory.current.path,
  );
  final stderr = process.stderr.transform(utf8.decoder).join();
  return (process: process, stderr: stderr);
}

/// First stdout line of [process], or a diagnosable failure.
///
/// A child that dies before printing closes stdout empty, and a bare
/// `Stream.first` then throws `Bad state: No element` — hiding the child's
/// exit code and stderr, which carry the actual reason. Race the line
/// against process exit and surface both instead.
Future<String> _firstLine(Process process, Future<String> stderr) async {
  // When the child dies silently its stdout closes empty and `.first`
  // REJECTS — Future.any would propagate that error before the exit code
  // resolves, so translate the rejection into waiting for the exit code
  // instead of racing it.
  final winner = await process.stdout
      .transform(utf8.decoder)
      .transform(const LineSplitter())
      .first
      .then<Object>((line) => line, onError: (Object _) => process.exitCode)
      .timeout(const Duration(seconds: 20));
  if (winner is String) return winner;
  final detail = _meaningfulStderr(await stderr);
  throw StateError(
    'child exited (code $winner) before its first line'
    '${detail.isEmpty ? '' : '; stderr: $detail'}',
  );
}

Future<void> _terminate(Process process) async {
  if (process.kill()) await process.exitCode;
}

Future<void> _storeClockTest() async {
  final fixture = _Fixture();
  final first = SqliteDesktopCoordinator.open(fixture.path);
  final second = SqliteDesktopCoordinator.open(fixture.path);
  try {
    first.signalWake('partition');
    final grant = _acquired(
      first.acquire(
        const SqliteDesktopAcquireRequest(
          key: 'partition',
          ownerId: 'slow-clock-process',
          token: 'token-a',
          leaseTtl: Duration(seconds: 5),
        ),
      ),
    );
    _expect(
      grant.expiresAtMs - grant.acquiredAtMs == 5000,
      'SQLite did not derive the lease from its own clock',
    );

    final skewed = await second.tryAcquire(
      DesktopLeaseRequest(
        key: 'partition',
        ownerId: 'future-clock-process',
        token: 'token-b',
        now: DateTime.fromMillisecondsSinceEpoch(9000000000000),
        expiresAt: DateTime.fromMillisecondsSinceEpoch(9000000005000),
      ),
    );
    _expect(skewed == null, 'caller clock skew created overlapping owners');
  } finally {
    first.close();
    second.close();
    fixture.dispose();
  }
}

Future<void> _trailingWakeTest() async {
  final fixture = _Fixture();
  final owner = SqliteDesktopCoordinator.open(fixture.path);
  final writer = SqliteDesktopCoordinator.open(fixture.path);
  try {
    final initial = owner.signalWake('partition');
    _expect(initial.generation == '1', 'unexpected initial wake generation');
    final grant = _acquired(
      owner.acquire(
        const SqliteDesktopAcquireRequest(
          key: 'partition',
          ownerId: 'owner-a',
          token: 'token-a',
          leaseTtl: Duration(seconds: 5),
        ),
      ),
    );

    final later = writer.signalWake('partition');
    _expect(later.generation == '2', 'later wake was not durable');
    final firstCompletion = owner.complete(grant, grant.wakeGeneration);
    _expect(!firstCompletion.released, 'owner released across a newer wake');
    _expect(
      firstCompletion.currentWakeGeneration == '2' &&
          firstCompletion.handledGeneration == '1',
      'trailing wake generations were not preserved',
    );

    final renewed = owner.renew(grant, const Duration(seconds: 5));
    _expect(renewed != null, 'same-fence renewal failed');
    final secondCompletion = owner.complete(
      renewed!.copyWith(wakeGeneration: '2', handledGeneration: '1'),
      '2',
    );
    _expect(secondCompletion.released, 'clean trailing cycle did not release');
    final state = owner.readState('partition');
    _expect(!state.dirty && !state.owned, 'clean partition remained dirty');
  } finally {
    owner.close();
    writer.close();
    fixture.dispose();
  }
}

Future<void> _staleFenceTest() async {
  final fixture = _Fixture();
  final first = SqliteDesktopCoordinator.open(fixture.path);
  final second = SqliteDesktopCoordinator.open(fixture.path);
  try {
    first.signalWake('partition');
    final firstGrant = _acquired(
      first.acquire(
        const SqliteDesktopAcquireRequest(
          key: 'partition',
          ownerId: 'owner-a',
          token: 'token-a',
          leaseTtl: Duration(seconds: 1),
        ),
      ),
    );
    await Future<void>.delayed(const Duration(milliseconds: 1100));
    final secondGrant = _acquired(
      second.acquire(
        const SqliteDesktopAcquireRequest(
          key: 'partition',
          ownerId: 'owner-b',
          token: 'token-b',
          leaseTtl: Duration(seconds: 5),
        ),
      ),
    );
    _expect(secondGrant.fence == '2', 'new owner did not advance the fence');

    var rejected = false;
    try {
      first.withFencedWrite<void>(firstGrant.desktopGrant, (_) {});
    } on StaleSqliteDesktopFenceException {
      rejected = true;
    }
    _expect(rejected, 'stale fenced write was accepted');
    first.releaseLease(firstGrant.desktopGrant);
    second.assertCurrentFence(secondGrant.desktopGrant);
  } finally {
    first.close();
    second.close();
    fixture.dispose();
  }
}

Future<void> _multiprocessContentionTest() async {
  final fixture = _Fixture();
  Process? holder;
  Future<String>? holderStderr;
  try {
    final started = await _startHolder(<String>[
      'acquire-and-exit',
      fixture.path,
      'partition',
      'holder',
      '10000',
      '5000',
    ]);
    holder = started.process;
    holderStderr = started.stderr;
    final holderLine = await _firstLine(holder, holderStderr);
    _expect(holderLine == 'acquired:1', 'holder did not acquire first fence');

    // Genuinely concurrent: the children are one prebuilt executable, so
    // they contend for the lease and nothing else.
    final contenders = await Future.wait<ProcessResult>(
      List<Future<ProcessResult>>.generate(
        3,
        (index) => _runChild(<String>[
          'contend',
          fixture.path,
          'partition',
          'process-$index',
          '0',
        ]),
      ),
    );
    for (final contender in contenders) {
      _expect(contender.exitCode == 0, contender.stderr.toString());
      _expect(
        contender.stdout.toString().trim().startsWith('busy:'),
        'independent process bypassed the active lease',
      );
    }

    await _terminate(holder);
    final stderr = _meaningfulStderr(await holderStderr);
    _expect(stderr.isEmpty, 'holder failed before termination: $stderr');
    holder = null;

    final coordinator = SqliteDesktopCoordinator.open(fixture.path);
    try {
      final state = coordinator.readState('partition');
      _expect(state.fence == '1', 'contention unexpectedly advanced the fence');
      _expect(
        state.wakeGeneration == '4' && state.handledGeneration == '0',
        'busy processes did not preserve durable wakes',
      );
      _expect(state.dirty, 'contended partition was falsely acknowledged');
    } finally {
      coordinator.close();
    }
  } finally {
    if (holder != null) {
      await _terminate(holder);
      await holderStderr!;
    }
    fixture.dispose();
  }
}

Future<void> _terminationReplayTest() async {
  final fixture = _Fixture();
  Process? child;
  Future<String>? childStderr;
  try {
    final started = await _startHolder(<String>[
      'acquire-and-exit',
      fixture.path,
      'partition',
      'doomed-process',
      '10000',
      '1000',
    ]);
    child = started.process;
    childStderr = started.stderr;
    final firstLine = await _firstLine(child, childStderr);
    _expect(firstLine == 'acquired:1', 'doomed process did not acquire');
    await _terminate(child);
    final stderr = _meaningfulStderr(await childStderr);
    _expect(
      stderr.isEmpty,
      'doomed process failed before termination: $stderr',
    );
    child = null;
    await Future<void>.delayed(const Duration(milliseconds: 1100));

    final recovery = SqliteDesktopCoordinator.open(fixture.path);
    try {
      final state = recovery.readState('partition');
      _expect(
        state.wakeGeneration == '1' && state.handledGeneration == '0',
        'termination lost or acknowledged durable work',
      );
      final grant = _acquired(
        recovery.acquire(
          const SqliteDesktopAcquireRequest(
            key: 'partition',
            ownerId: 'recovery-process',
            token: 'recovery-token',
            leaseTtl: Duration(seconds: 5),
          ),
        ),
      );
      _expect(grant.fence == '2', 'recovery did not receive a new fence');
      final completion = recovery.complete(grant, '1');
      _expect(completion.released, 'recovery did not clear durable work');
    } finally {
      recovery.close();
    }
  } finally {
    if (child != null) {
      await _terminate(child);
      await childStderr!;
    }
    fixture.dispose();
  }
}

Future<void> _runnerHandoffTest() async {
  final fixture = _Fixture();
  final first = SqliteDesktopCoordinator.open(fixture.path);
  final second = SqliteDesktopCoordinator.open(fixture.path);
  try {
    final seen = <String>[];
    final runner = SqliteCoordinatedDesktopSyncRunner<String>(
      coordinator: first,
      leaseKey: 'partition',
      ownerId: 'runner-a',
      budget: const Duration(seconds: 1),
      leaseTtl: const Duration(milliseconds: 2500),
      busyRetryCap: const Duration(milliseconds: 25),
      syncOnce: (context) async {
        seen.add(context.wakeGeneration);
        context.coordinator.withFencedWrite<void>(context.grant.desktopGrant, (
          database,
        ) {
          database.execute('''
              CREATE TABLE IF NOT EXISTS opto_sync_test_checkpoint (
                lease_key TEXT PRIMARY KEY NOT NULL,
                fence TEXT NOT NULL
              ) STRICT
            ''');
          database.execute(
            '''
              INSERT INTO opto_sync_test_checkpoint (lease_key, fence)
              VALUES (?, ?)
              ON CONFLICT(lease_key) DO UPDATE SET fence = excluded.fence
              ''',
            <Object?>[context.leaseKey, context.fence],
          );
        });
        if (seen.length == 1) second.signalWake('partition');
        return context.wakeGeneration;
      },
    );
    final result = await runner.wake(DesktopWakeReason.localMutation);
    _expect(
      seen.join(',') == '1,2',
      'runner did not execute the durable trailing generation',
    );
    _expect(
      result.outcomes.length == 2 &&
          result.outcomes.every(
            (outcome) => outcome.status == DesktopSyncOutcomeStatus.completed,
          ),
      'runner did not complete both fenced cycles',
    );
    _expect(!first.readState('partition').dirty, 'runner left dirty work');
    runner.close();
  } finally {
    first.close();
    second.close();
    fixture.dispose();
  }
}

Future<void> main() async {
  // Build before any test opens a coordinator: compilation is the last step
  // that may touch .dart_tool/lib/, and on Windows that directory cannot be
  // rewritten once this process has the SQLite library loaded.
  final childBuild = await _buildChild();
  try {
    await _storeClockTest();
    await _trailingWakeTest();
    await _staleFenceTest();
    await _multiprocessContentionTest();
    await _terminationReplayTest();
    await _runnerHandoffTest();
  } finally {
    if (childBuild.existsSync()) childBuild.deleteSync(recursive: true);
  }
  stdout.writeln('Dart SQLite desktop coordination self-test passed');
}
