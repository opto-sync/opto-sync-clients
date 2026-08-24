import 'dart:async';
import 'dart:convert';

/// Why an authenticated application lifecycle requested a foreground cycle.
enum SessionSyncReason { login, logout }

/// Largest integer represented exactly by every supported Dart/JS/Rust host.
const int maxPortableSessionInteger = 9007199254740991;

/// Tenant-bound identity for one authenticated client session.
final class OptoSyncSessionIdentity {
  OptoSyncSessionIdentity({
    required this.subject,
    required this.tenant,
    required this.authEpoch,
  }) {
    if (subject.trim().isEmpty || utf8.encode(subject).length > 512) {
      throw ArgumentError.value(
        subject,
        'subject',
        'must be 1 through 512 bytes',
      );
    }
    if (tenant.trim().isEmpty || utf8.encode(tenant).length > 512) {
      throw ArgumentError.value(
        tenant,
        'tenant',
        'must be 1 through 512 bytes',
      );
    }
    if (authEpoch < 0 || authEpoch > maxPortableSessionInteger) {
      throw ArgumentError.value(
        authEpoch,
        'authEpoch',
        'must be from 0 through $maxPortableSessionInteger',
      );
    }
  }

  final String subject;
  final String tenant;
  final int authEpoch;

  bool sameSession(OptoSyncSessionIdentity other) =>
      subject == other.subject &&
      tenant == other.tenant &&
      authEpoch == other.authEpoch;
}

/// Durable accounting receipt returned by the application's ordinary sync loop.
///
/// A logout is drained only when every mutation present at the start of the
/// bounded cycle has an exact server acknowledgement, the local queue has
/// committed that acknowledgement, and no pending rows remain. Merely sending
/// a request, receiving a transport ACK, or timing out is never sufficient.
final class DurableSyncReceipt {
  DurableSyncReceipt({
    required this.pendingBefore,
    required this.acknowledged,
    required this.admittedDuringDrain,
    required this.pendingAfter,
    required this.checkpointCommitted,
    required this.admissionFenced,
  }) {
    if (pendingBefore < 0 ||
        acknowledged < 0 ||
        admittedDuringDrain < 0 ||
        pendingAfter < 0 ||
        pendingBefore > maxPortableSessionInteger ||
        acknowledged > maxPortableSessionInteger ||
        admittedDuringDrain > maxPortableSessionInteger ||
        pendingAfter > maxPortableSessionInteger) {
      throw ArgumentError(
        'durable sync counters must be portable integers from 0 through '
        '$maxPortableSessionInteger',
      );
    }
    if (acknowledged > pendingBefore ||
        pendingAfter != pendingBefore - acknowledged + admittedDuringDrain) {
      throw ArgumentError(
        'durable sync receipt violates queue conservation: '
        'pendingAfter must equal pendingBefore - acknowledged + '
        'admittedDuringDrain',
      );
    }
  }

  final int pendingBefore;
  final int acknowledged;

  /// Writes observed after the start snapshot. A correct logout fences these.
  final int admittedDuringDrain;
  final int pendingAfter;
  final bool checkpointCommitted;

  /// True only after the host has stopped session-scoped mutation admission.
  final bool admissionFenced;

  bool get durablyDrained =>
      pendingAfter == 0 &&
      acknowledged == pendingBefore &&
      admittedDuringDrain == 0 &&
      checkpointCommitted &&
      admissionFenced;
}

typedef AuthenticatedSync = Future<DurableSyncReceipt> Function(
  SessionSyncReason reason,
);
typedef TelemetryForceFlush = Future<void> Function();
typedef ClearSessionCredentials = Future<void> Function(
  OptoSyncSessionIdentity? session,
);

final class SessionLoginReport {
  const SessionLoginReport({
    required this.session,
    required this.syncTriggered,
    this.receipt,
    this.syncError,
    this.syncStackTrace,
  });

  final OptoSyncSessionIdentity session;
  final bool syncTriggered;
  final DurableSyncReceipt? receipt;
  final Object? syncError;
  final StackTrace? syncStackTrace;

  bool get syncSucceeded => syncTriggered && syncError == null;
}

final class SessionLogoutReport {
  const SessionLogoutReport({
    required this.hadSession,
    required this.credentialsCleared,
    this.receipt,
    this.syncError,
    this.telemetryError,
    this.credentialError,
  });

  final bool hadSession;
  final bool credentialsCleared;
  final DurableSyncReceipt? receipt;
  final Object? syncError;
  final Object? telemetryError;
  final Object? credentialError;

  bool get dataDurablyDrained =>
      !hadSession || (syncError == null && receipt?.durablyDrained == true);
  bool get telemetryFlushed => telemetryError == null;
  bool get complete =>
      dataDurablyDrained && telemetryFlushed && credentialsCleared;
}

/// Serializes authenticated login/logout boundaries for Flutter and Dart hosts.
///
/// The application still owns authentication, secure storage, the concrete
/// opto-sync loop, and the ORES OTEL providers. This coordinator only enforces
/// ordering and honest durable acknowledgement semantics.
final class AuthenticatedSessionLifecycle {
  AuthenticatedSessionLifecycle({
    required AuthenticatedSync sync,
    required TelemetryForceFlush forceFlushTelemetry,
    required ClearSessionCredentials clearCredentials,
  }) : _sync = sync,
       _forceFlushTelemetry = forceFlushTelemetry,
       _clearCredentials = clearCredentials;

  final AuthenticatedSync _sync;
  final TelemetryForceFlush _forceFlushTelemetry;
  final ClearSessionCredentials _clearCredentials;
  OptoSyncSessionIdentity? _session;
  Future<void> _tail = Future<void>.value();

  OptoSyncSessionIdentity? get session => _session;
  bool get isAuthenticated => _session != null;

  Future<T> _serialize<T>(Future<T> Function() operation) async {
    final predecessor = _tail;
    final release = Completer<void>();
    _tail = release.future;
    await predecessor;
    try {
      return await operation();
    } finally {
      release.complete();
    }
  }

  /// Records a successful authentication and immediately wakes foreground sync.
  /// Duplicate notifications for the exact same auth epoch are coalesced.
  Future<SessionLoginReport> onLogin(
    OptoSyncSessionIdentity next,
  ) => _serialize(() async {
    final current = _session;
    if (current != null && !current.sameSession(next)) {
      throw StateError(
        'logout must complete before a tenant, subject, or auth-epoch switch',
      );
    }
    if (current != null) {
      return SessionLoginReport(session: current, syncTriggered: false);
    }

    _session = next;
    try {
      final receipt = await _sync(SessionSyncReason.login);
      return SessionLoginReport(
        session: next,
        syncTriggered: true,
        receipt: receipt,
      );
    } catch (error, stackTrace) {
      // Authentication succeeded even if the first foreground cycle did
      // not. Durable queue state remains authoritative for the next wake.
      return SessionLoginReport(
        session: next,
        syncTriggered: true,
        syncError: error,
        syncStackTrace: stackTrace,
      );
    }
  });

  /// Drains session data, force-flushes app-owned telemetry, then clears auth.
  ///
  /// Every stage is attempted. Credentials are cleared even when data or
  /// telemetry delivery fails; unsafely unacknowledged data stays durable for
  /// a later authenticated recovery instead of being marked delivered.
  Future<SessionLogoutReport> onLogout() => _serialize(() async {
    final current = _session;
    DurableSyncReceipt? receipt;
    Object? syncError;
    Object? telemetryError;
    Object? credentialError;
    var credentialsCleared = false;

    if (current != null) {
      try {
        receipt = await _sync(SessionSyncReason.logout);
      } catch (error) {
        syncError = error;
      }
    }
    try {
      await _forceFlushTelemetry();
    } catch (error) {
      telemetryError = error;
    }
    try {
      await _clearCredentials(current);
      credentialsCleared = true;
    } catch (error) {
      credentialError = error;
    } finally {
      // Never retain an authenticated in-memory session after logout was
      // requested, even when platform secure-storage cleanup reports failure.
      _session = null;
    }

    return SessionLogoutReport(
      hadSession: current != null,
      credentialsCleared: credentialsCleared,
      receipt: receipt,
      syncError: syncError,
      telemetryError: telemetryError,
      credentialError: credentialError,
    );
  });
}
