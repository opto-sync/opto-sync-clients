import 'dart:convert';

/// Declared latency/durability strategy for one application write.
enum SyncOptimism { remoteConfirmed, localDurable, localThenRemote }

enum SyncSource {
  local,
  http,
  websocket,
  tcp,
  supabase,
  broadcast,
  serviceWorker,
}

enum SyncRecordAuthority { localView, authoritative }

/// Structural mirror of shared-auth's verified identity.
///
/// Bearer and refresh tokens are deliberately absent so storage keys, stream
/// dedupe identities, and diagnostics cannot leak credentials.
final class SyncSessionIdentity {
  const SyncSessionIdentity({
    required this.sharedUserId,
    required this.provider,
    required this.providerTenant,
    required this.providerSubject,
    this.project,
    this.supabaseUserId,
    this.sessionId,
    this.authority,
    this.roles = const <String>[],
  });

  factory SyncSessionIdentity.fromSharedAuthJson(Map<String, Object?> json) {
    String requiredString(String key) {
      final value = json[key];
      if (value is! String || value.isEmpty) {
        throw FormatException('shared-auth identity requires $key');
      }
      return value;
    }

    final roles = json['roles'];
    return SyncSessionIdentity(
      sharedUserId: requiredString('shared_user_id'),
      provider: requiredString('provider'),
      providerTenant: requiredString('provider_tenant'),
      providerSubject: requiredString('provider_subject'),
      project: json['project'] as String?,
      supabaseUserId: json['supabase_user_id'] as String?,
      sessionId: json['session_id'] as String?,
      authority: json['authority'] as String?,
      roles: roles is List<Object?>
          ? List<String>.unmodifiable(roles.whereType<String>())
          : const <String>[],
    );
  }

  final String sharedUserId;
  final String provider;
  final String providerTenant;
  final String providerSubject;
  final String? project;
  final String? supabaseUserId;
  final String? sessionId;
  final String? authority;
  final List<String> roles;
}

sealed class SyncSession {
  const SyncSession();
}

final class AuthenticatedSyncSession extends SyncSession {
  const AuthenticatedSyncSession(this.identity);
  final SyncSessionIdentity identity;
}

final class AnonymousSyncSession extends SyncSession {
  const AnonymousSyncSession();
}

final class UnauthenticatedSyncSession extends SyncSession {
  const UnauthenticatedSyncSession();
}

final class DegradedSyncSession extends SyncSession {
  const DegradedSyncSession(this.reason);
  final String reason;
}

SyncSessionIdentity requireAuthenticated(SyncSession session) {
  if (session case AuthenticatedSyncSession(:final identity)) return identity;
  if (session case DegradedSyncSession(:final reason)) {
    throw StateError(
      'sync authentication is degraded; privileged synchronization fails closed: $reason',
    );
  }
  throw StateError(
      'sync requires an authenticated session: ${session.runtimeType}');
}

String _component(String value) => Uri.encodeComponent(value);

/// Durable storage/queue partition. Session rotation does not strand work.
String storagePartitionKey(SyncSessionIdentity identity) => <String>[
      identity.provider,
      identity.providerTenant,
      identity.sharedUserId,
    ].map(_component).join(':');

/// Live transport generation. Session rotation cancels stale streams.
String transportSessionKey(SyncSessionIdentity identity) =>
    '${storagePartitionKey(identity)}:${_component(identity.sessionId ?? 'sessionless')}';

final class SyncRecordEvent<T> {
  const SyncRecordEvent({
    required this.table,
    required this.recordId,
    required this.operation,
    required this.payload,
    required this.revision,
    required this.source,
    required this.authority,
    required this.sessionPartition,
    this.checkpoint,
    this.pending = false,
    this.dedupeKey,
  });

  final String table;
  final String recordId;
  final String operation;
  final T? payload;
  final String revision;
  final String? checkpoint;
  final SyncSource source;
  final SyncRecordAuthority authority;
  final bool pending;
  final String? dedupeKey;
  final String sessionPartition;
}

Object? _stable(Object? value) {
  if (value is List<Object?>) return value.map(_stable).toList(growable: false);
  if (value is Map<Object?, Object?>) {
    final entries = value.entries
        .map((entry) => MapEntry(entry.key.toString(), _stable(entry.value)))
        .toList(growable: false)
      ..sort((left, right) => left.key.compareTo(right.key));
    return Map<String, Object?>.fromEntries(entries);
  }
  return value;
}

String stableJson(Object? value) => jsonEncode(_stable(value));

String recordEventDedupeKey<T>(SyncRecordEvent<T> event) =>
    event.dedupeKey ??
    <String>[
      event.sessionPartition,
      event.table,
      event.recordId,
      event.operation,
      event.revision,
      stableJson(event.payload),
    ].join('\u0000');
