import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';

enum SyncSessionStatus { authenticated, anonymous, degraded }

final class SyncSessionSnapshot {
  final SyncSessionStatus status;

  /// Stable, non-secret local scope. Never use this as server authorization.
  final String scope;
  final String? authority;
  final String? accessToken;
  final int? expiresAt;
  final String? reason;

  const SyncSessionSnapshot({
    required this.status,
    required this.scope,
    this.authority,
    this.accessToken,
    this.expiresAt,
    this.reason,
  });
}

abstract interface class SyncSessionProvider {
  Future<SyncSessionSnapshot> current();
  Stream<SyncSessionSnapshot> get changes;
}

final class SyncSessionException implements Exception {
  final String code;
  final String message;
  final bool retryable;

  const SyncSessionException(
    this.code,
    this.message, {
    required this.retryable,
  });

  @override
  String toString() => 'SyncSessionException($code): $message';
}

Future<Map<String, String>> Function() sessionAuthorizationHeaders(
  SyncSessionProvider provider, {
  FutureOr<Map<String, String>> Function()? base,
}) {
  return () async {
    final session = await provider.current();
    if (session.status == SyncSessionStatus.anonymous) {
      throw const SyncSessionException(
        'ANONYMOUS_SESSION',
        'sync requires an authenticated session',
        retryable: false,
      );
    }
    if (session.status == SyncSessionStatus.degraded) {
      throw const SyncSessionException(
        'SESSION_AUTHORITY_UNAVAILABLE',
        'session authority is temporarily unavailable',
        retryable: true,
      );
    }
    final token = session.accessToken;
    if (token == null || token.isEmpty) {
      throw const SyncSessionException(
        'SESSION_TOKEN_MISSING',
        'authenticated session has no access token',
        retryable: false,
      );
    }
    return {
      ...await base?.call() ?? const <String, String>{},
      'authorization': 'Bearer $token',
    };
  };
}

String sessionDatabaseName(
  String baseName,
  SyncSessionSnapshot session,
) {
  if (baseName.isEmpty || session.scope.isEmpty) {
    throw ArgumentError('baseName and session scope are required');
  }
  final digest = sha256.convert(
    utf8.encode('${session.authority ?? 'session'}\u0000${session.scope}'),
  );
  final suffix = digest.bytes
      .take(12)
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
  return '$baseName-$suffix';
}

final class SupabaseSessionData {
  final String userId;
  final String accessToken;
  final String? sessionId;
  final int? expiresAt;

  const SupabaseSessionData({
    required this.userId,
    required this.accessToken,
    this.sessionId,
    this.expiresAt,
  });
}

String? _jwtSessionId(String token) {
  try {
    final segments = token.split('.');
    if (segments.length < 2) return null;
    final payload =
        jsonDecode(
              utf8.decode(base64Url.decode(base64Url.normalize(segments[1]))),
            )
            as Map<String, dynamic>;
    return payload['session_id'] is String
        ? payload['session_id'] as String
        : null;
  } on Object {
    return null;
  }
}

SyncSessionSnapshot _supabaseSnapshot(SupabaseSessionData? session) {
  if (session == null) {
    return const SyncSessionSnapshot(
      status: SyncSessionStatus.anonymous,
      scope: 'anonymous',
    );
  }
  // Decoding chooses a local namespace only. The server still verifies the JWT
  // and derives tenant/roles from verified claims.
  final sessionId = session.sessionId ?? _jwtSessionId(session.accessToken);
  return SyncSessionSnapshot(
    status: SyncSessionStatus.authenticated,
    scope: sessionId == null
        ? session.userId
        : '${session.userId}:$sessionId',
    authority: 'supabase',
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
  );
}

SyncSessionProvider createSupabaseSessionProvider({
  required Future<SupabaseSessionData?> Function() getSession,
  required Stream<SupabaseSessionData?> sessionChanges,
}) {
  return _CallbackSessionProvider(
    current: () async => _supabaseSnapshot(await getSession()),
    changes: sessionChanges.map(_supabaseSnapshot).distinct(_sameSession),
  );
}

final class SharedAuthSessionData {
  final String sharedUserId;
  final String providerTenant;
  final String? sessionId;
  final String authority;
  final String accessToken;

  const SharedAuthSessionData({
    required this.sharedUserId,
    required this.providerTenant,
    required this.authority,
    required this.accessToken,
    this.sessionId,
  });

  SyncSessionSnapshot toSnapshot() => SyncSessionSnapshot(
    status: SyncSessionStatus.authenticated,
    scope: '$sharedUserId:$providerTenant:${sessionId ?? 'sessionless'}',
    authority: authority,
    accessToken: accessToken,
  );
}

SyncSessionProvider createSharedAuthSessionProvider({
  required Future<SharedAuthSessionData?> Function() getSession,
  required Stream<SharedAuthSessionData?> sessionChanges,
}) {
  SyncSessionSnapshot map(SharedAuthSessionData? session) =>
      session?.toSnapshot() ??
      const SyncSessionSnapshot(
        status: SyncSessionStatus.anonymous,
        scope: 'anonymous',
      );
  return _CallbackSessionProvider(
    current: () async => map(await getSession()),
    changes: sessionChanges.map(map).distinct(_sameSession),
  );
}

bool _sameSession(SyncSessionSnapshot left, SyncSessionSnapshot right) =>
    left.status == right.status &&
    left.scope == right.scope &&
    left.authority == right.authority &&
    left.expiresAt == right.expiresAt &&
    (left.accessToken == null) == (right.accessToken == null);

final class _CallbackSessionProvider implements SyncSessionProvider {
  final Future<SyncSessionSnapshot> Function() _current;
  @override
  final Stream<SyncSessionSnapshot> changes;

  const _CallbackSessionProvider({
    required this._current,
    required this.changes,
  });

  @override
  Future<SyncSessionSnapshot> current() => _current();
}

abstract interface class SessionBoundSyncResource {
  FutureOr<void> start();
  FutureOr<void> stop();
}

/// Reopens the correct SQLite store when the authenticated session changes.
final class SessionBoundSyncManager {
  final SyncSessionProvider provider;
  final String databaseBaseName;
  final Future<SessionBoundSyncResource> Function(
    SyncSessionSnapshot session,
    String databaseName,
  )
  open;
  final void Function(Object error, StackTrace stack)? onError;

  StreamSubscription<SyncSessionSnapshot>? _subscription;
  SessionBoundSyncResource? _active;
  String? _activeScope;
  Future<void> _transitions = Future<void>.value();
  bool _started = false;

  SessionBoundSyncManager({
    required this.provider,
    required this.databaseBaseName,
    required this.open,
    this.onError,
  });

  Future<void> start() async {
    if (_started) return;
    _started = true;
    _subscription = provider.changes.listen(
      _enqueue,
      onError: onError,
    );
    _enqueue(await provider.current());
    await _transitions;
  }

  Future<void> stop() async {
    _started = false;
    await _subscription?.cancel();
    _subscription = null;
    await _transitions;
    await _active?.stop();
    _active = null;
    _activeScope = null;
  }

  void _enqueue(SyncSessionSnapshot session) {
    _transitions = _transitions.then((_) => _transition(session)).catchError((
      Object error,
      StackTrace stack,
    ) {
      onError?.call(error, stack);
    });
  }

  Future<void> _transition(SyncSessionSnapshot session) async {
    if (!_started || session.status == SyncSessionStatus.degraded) return;
    if (session.status == SyncSessionStatus.anonymous) {
      await _active?.stop();
      _active = null;
      _activeScope = null;
      return;
    }
    final scope = '${session.authority ?? 'session'}\u0000${session.scope}';
    if (scope == _activeScope) return;
    final next = await open(
      session,
      sessionDatabaseName(databaseBaseName, session),
    );
    final previous = _active;
    await next.start();
    _active = next;
    _activeScope = scope;
    await previous?.stop();
  }
}
