import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:opto_sync_reactive/opto_sync_reactive.dart';

DurableSyncReceipt _drained(int count) => DurableSyncReceipt(
  pendingBefore: count,
  acknowledged: count,
  admittedDuringDrain: 0,
  pendingAfter: 0,
  checkpointCommitted: true,
  admissionFenced: true,
);

void _check(bool condition, String message) {
  if (!condition) throw StateError(message);
}

Future<void> main() async {
  final document =
      jsonDecode(
            await File(
              '../../formal/session_lifecycle_vectors.v1.json',
            ).readAsString(),
          )
          as Map<String, Object?>;
  _check(
    document['schema'] == 'opto-sync/session-lifecycle-vectors/v1',
    'unexpected lifecycle corpus schema',
  );
  _check(
    (document['ordering'] as List<Object?>).join(',') ==
        'logout-sync,telemetry-force-flush,credentials-clear',
    'logout ordering contract diverged',
  );
  final invariants = document['invariants'] as Map<String, Object?>;
  _check(
    invariants.values.every((value) => value == true),
    'lifecycle corpus contains a disabled invariant',
  );

  for (final raw in document['identityVectors'] as List<Object?>) {
    final vector = raw as Map<String, Object?>;
    var valid = true;
    try {
      OptoSyncSessionIdentity(
        subject: List<String>.filled(
          vector['subjectRepeat'] as int,
          vector['subject'] as String,
        ).join(),
        tenant: List<String>.filled(
          vector['tenantRepeat'] as int,
          vector['tenant'] as String,
        ).join(),
        authEpoch: vector['authEpoch'] as int,
      );
    } on ArgumentError {
      valid = false;
    }
    _check(
      valid == vector['expectedValid'],
      'Dart identity validation diverged for ${vector['id']}',
    );
  }

  for (final raw in document['vectors'] as List<Object?>) {
    final vector = raw as Map<String, Object?>;
    DurableSyncReceipt? receipt;
    try {
      receipt = DurableSyncReceipt(
        pendingBefore: vector['pendingBefore'] as int,
        acknowledged: vector['acknowledged'] as int,
        admittedDuringDrain: vector['admittedDuringDrain'] as int,
        pendingAfter: vector['pendingAfter'] as int,
        checkpointCommitted: vector['checkpointCommitted'] as bool,
        admissionFenced: vector['admissionFenced'] as bool,
      );
    } on ArgumentError {
      receipt = null;
    }
    _check(
      (receipt != null) == vector['expectedValid'],
      'Dart receipt validation diverged for ${vector['id']}',
    );
    _check(
      (receipt?.durablyDrained ?? false) == vector['expectedDrained'],
      'Dart receipt diverged for ${vector['id']}',
    );
  }

  final order = <String>[];
  final lifecycle = AuthenticatedSessionLifecycle(
    sync: (reason) async {
      order.add(
        reason == SessionSyncReason.login ? 'login-sync' : 'logout-sync',
      );
      return _drained(reason == SessionSyncReason.login ? 0 : 2);
    },
    forceFlushTelemetry: () async {
      order.add('telemetry-force-flush');
    },
    clearCredentials: (session) async {
      _check(session?.tenant == 'tenant-a', 'credential clear lost tenant');
      order.add('credentials-clear');
    },
  );
  final identity = OptoSyncSessionIdentity(
    subject: 'subject-1',
    tenant: 'tenant-a',
    authEpoch: 7,
  );
  final login = await lifecycle.onLogin(identity);
  _check(login.syncSucceeded, 'login did not trigger a successful sync');
  final duplicate = await lifecycle.onLogin(identity);
  _check(!duplicate.syncTriggered, 'duplicate login was not coalesced');
  final logout = await lifecycle.onLogout();
  _check(logout.complete, 'durably drained logout was not complete');
  _check(
    !lifecycle.isAuthenticated,
    'logout retained an authenticated session',
  );
  _check(
    order.join(',') ==
        'login-sync,logout-sync,telemetry-force-flush,credentials-clear',
    'successful logout operations ran out of order',
  );

  final failingOrder = <String>[];
  final failing = AuthenticatedSessionLifecycle(
    sync: (reason) async {
      if (reason == SessionSyncReason.login) return _drained(0);
      failingOrder.add('logout-sync');
      throw StateError('network unavailable');
    },
    forceFlushTelemetry: () async {
      failingOrder.add('telemetry-force-flush');
      throw StateError('collector unavailable');
    },
    clearCredentials: (_) async {
      failingOrder.add('credentials-clear');
    },
  );
  await failing.onLogin(identity);
  final failedLogout = await failing.onLogout();
  _check(!failedLogout.complete, 'failed logout was reported complete');
  _check(failedLogout.syncError != null, 'sync failure was not reported');
  _check(
    failedLogout.telemetryError != null,
    'telemetry failure was not reported',
  );
  _check(failedLogout.credentialsCleared, 'failed logout retained credentials');
  _check(
    !failing.isAuthenticated,
    'failed logout retained an in-memory session',
  );
  _check(
    failingOrder.join(',') ==
        'logout-sync,telemetry-force-flush,credentials-clear',
    'failed logout did not attempt every stage in order',
  );

  var releaseSync = Completer<DurableSyncReceipt>();
  final serializedOrder = <String>[];
  final serialized = AuthenticatedSessionLifecycle(
    sync: (reason) {
      serializedOrder.add(reason.name);
      if (reason == SessionSyncReason.login) return releaseSync.future;
      return Future.value(_drained(0));
    },
    forceFlushTelemetry: () async => serializedOrder.add('flush'),
    clearCredentials: (_) async => serializedOrder.add('clear'),
  );
  final pendingLogin = serialized.onLogin(identity);
  final pendingLogout = serialized.onLogout();
  await Future<void>.delayed(Duration.zero);
  _check(
    serializedOrder.join(',') == 'login',
    'logout overlapped an unfinished login',
  );
  releaseSync.complete(_drained(0));
  await pendingLogin;
  await pendingLogout;
  _check(
    serializedOrder.join(',') == 'login,logout,flush,clear',
    'serialized login/logout ordering diverged',
  );

  stdout.writeln('Dart authenticated session lifecycle conformance passed');
}
