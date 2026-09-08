import 'dart:async';
import 'dart:math' as math;

import 'package:rxdart/rxdart.dart';

import 'contracts.dart';

enum SupabaseHintChannelStatus { subscribed, closed, channelError, timedOut }

enum SyncHintReason {
  localMutation,
  remoteChange,
  connectivity,
  backgroundWake,
  manual,
}

final class SyncHint {
  const SyncHint({
    required this.reason,
    required this.source,
    required this.sessionPartition,
    this.table,
    this.recordId,
    this.checkpoint,
  });

  final SyncHintReason reason;
  final SyncSource source;
  final String sessionPartition;
  final String? table;
  final String? recordId;
  final String? checkpoint;
}

typedef SupabaseHintPayloadListener = void Function(Object? payload);
typedef SupabaseHintStatusListener =
    void Function(SupabaseHintChannelStatus status, [Object? error]);

/// Transport-neutral wrapper around a Supabase Realtime channel.
///
/// Hosts adapt `RealtimeChannel.onPostgresChanges` or private Broadcast into
/// this interface. The channel is a wake hint only; authenticated HTTP
/// push/pull remains the commit-ordered entity synchronization path.
abstract interface class SupabaseRealtimeHintChannel {
  void subscribe({
    required SupabaseHintPayloadListener onPayload,
    required SupabaseHintStatusListener onStatus,
  });

  FutureOr<void> unsubscribe();
}

/// Structural subset of `SupabaseClient.realtime` used for token refresh.
abstract interface class SupabaseRealtimeAuthLike {
  FutureOr<void> setAuth(String accessToken);
}

typedef SupabaseAccessTokenProvider =
    FutureOr<String> Function(SyncSessionIdentity identity);

final class SupabaseRealtimeAuthBinding {
  const SupabaseRealtimeAuthBinding({
    required this.realtime,
    required this.accessToken,
  });

  final SupabaseRealtimeAuthLike realtime;
  final SupabaseAccessTokenProvider accessToken;
}

final class DecodedSyncHint {
  const DecodedSyncHint({this.table, this.recordId, this.checkpoint});

  final String? table;
  final String? recordId;
  final String? checkpoint;
}

typedef SupabaseHintChannelFactory =
    SupabaseRealtimeHintChannel Function(SyncSessionIdentity identity);
typedef SupabaseHintDecoder =
    DecodedSyncHint Function(Object? payload, SyncSessionIdentity identity);
typedef SupabaseRetryDelay = Stream<void> Function(Duration delay);

bool _sameSession(SyncSession previous, SyncSession next) {
  if (previous is AuthenticatedSyncSession &&
      next is AuthenticatedSyncSession) {
    return transportSessionKey(previous.identity) ==
        transportSessionKey(next.identity);
  }
  return previous.runtimeType == next.runtimeType;
}

Duration _retryDelay(Duration base, Duration maximum, int retryNumber) {
  final exponent = math.min(math.max(0, retryNumber - 1), 10);
  final delayMillis = math.min(
    maximum.inMilliseconds,
    base.inMilliseconds * (1 << exponent),
  );
  return Duration(milliseconds: delayMillis);
}

Future<void> _refreshAuth(
  SupabaseRealtimeAuthBinding auth,
  SyncSessionIdentity identity,
) async {
  late final String token;
  try {
    token = await auth.accessToken(identity);
  } catch (_) {
    throw StateError('Supabase Realtime access-token refresh failed');
  }
  if (token.isEmpty || token.trim() != token) {
    throw StateError(
      'Supabase Realtime access-token refresh returned an invalid token',
    );
  }
  try {
    await auth.realtime.setAuth(token);
  } catch (_) {
    throw StateError('Supabase Realtime authentication update failed');
  }
}

Stream<SyncHint> _channelAttempt({
  required SyncSessionIdentity identity,
  required SupabaseHintChannelFactory channelFactory,
  required SupabaseHintDecoder? decode,
  required SupabaseRealtimeAuthBinding? auth,
}) {
  late final StreamController<SyncHint> controller;
  SupabaseRealtimeHintChannel? channel;
  var intentionalTeardown = false;
  var failed = false;

  void fail(String status) {
    if (failed || intentionalTeardown || controller.isClosed) return;
    failed = true;
    controller.addError(StateError('Supabase Realtime channel $status'));
    unawaited(controller.close());
  }

  Future<void> start() async {
    if (auth != null) {
      try {
        await _refreshAuth(auth, identity);
      } catch (error, stackTrace) {
        if (!intentionalTeardown && !controller.isClosed) {
          controller.addError(error, stackTrace);
          await controller.close();
        }
        return;
      }
    }
    if (intentionalTeardown || controller.isClosed) return;

    try {
      channel = channelFactory(identity);
    } catch (_) {
      fail('CREATION_ERROR');
      return;
    }
    if (intentionalTeardown || controller.isClosed) {
      try {
        await channel?.unsubscribe();
      } catch (_) {
        // A cancelled attempt is fenced even when provider teardown fails.
      }
      return;
    }

    try {
      channel!.subscribe(
        onPayload: (payload) {
          if (intentionalTeardown || failed || controller.isClosed) return;
          late final DecodedSyncHint decoded;
          try {
            decoded =
                decode?.call(payload, identity) ?? const DecodedSyncHint();
          } catch (_) {
            fail('DECODE_ERROR');
            return;
          }
          controller.add(
            SyncHint(
              reason: SyncHintReason.remoteChange,
              source: SyncSource.supabase,
              sessionPartition: transportSessionKey(identity),
              table: decoded.table,
              recordId: decoded.recordId,
              checkpoint: decoded.checkpoint,
            ),
          );
        },
        onStatus: (status, [_]) {
          switch (status) {
            case SupabaseHintChannelStatus.subscribed:
              return;
            case SupabaseHintChannelStatus.closed:
              fail('CLOSED');
              return;
            case SupabaseHintChannelStatus.channelError:
              fail('CHANNEL_ERROR');
              return;
            case SupabaseHintChannelStatus.timedOut:
              fail('TIMED_OUT');
              return;
          }
        },
      );
    } catch (_) {
      fail('SUBSCRIBE_ERROR');
    }
  }

  Future<void> cancel() async {
    intentionalTeardown = true;
    final current = channel;
    channel = null;
    if (current == null) return;
    try {
      await current.unsubscribe();
    } catch (_) {
      // Teardown diagnostics must not create an unhandled async error.
    }
  }

  controller = StreamController<SyncHint>(
    sync: true,
    onListen: () => unawaited(start()),
    onCancel: cancel,
  );
  return controller.stream;
}

/// RxDart session-bound Supabase wake hints with bounded reconnect and JWT refresh.
///
/// `switchMap` cancels the old channel on session rotation. `RetryWhenStream`
/// creates a new channel and obtains a fresh token before every retry. The
/// returned shared stream owns one entity-hint connection regardless of the
/// number of UI subscribers. ORES OTEL telemetry must use its own transport and
/// WebSocket; no queue, ACK, or channel is shared here.
Stream<SyncHint> createSupabaseHints({
  required Stream<SyncSession> sessions,
  required SupabaseHintChannelFactory channel,
  SupabaseHintDecoder? decode,
  SupabaseRealtimeAuthBinding? auth,
  Duration retryBase = const Duration(milliseconds: 500),
  Duration retryMax = const Duration(seconds: 30),
  int retryAttempts = 8,
  SupabaseRetryDelay? retryDelay,
}) {
  if (retryBase.isNegative) {
    throw ArgumentError.value(retryBase, 'retryBase', 'must not be negative');
  }
  if (retryMax < retryBase) {
    throw ArgumentError.value(
      retryMax,
      'retryMax',
      'must be greater than or equal to retryBase',
    );
  }
  if (retryAttempts < 0) {
    throw ArgumentError.value(
      retryAttempts,
      'retryAttempts',
      'must not be negative',
    );
  }
  final delay = retryDelay ?? (duration) => Rx.timer<void>(null, duration);

  return sessions.distinct(_sameSession).switchMap((session) {
    final identity = requireAuthenticated(session);
    var retries = 0;
    return RetryWhenStream<SyncHint>(
      () => _channelAttempt(
        identity: identity,
        channelFactory: channel,
        decode: decode,
        auth: auth,
      ),
      (error, stackTrace) {
        if (retries >= retryAttempts) {
          return Stream<void>.error(error, stackTrace);
        }
        retries += 1;
        return delay(_retryDelay(retryBase, retryMax, retries));
      },
    );
  }).share();
}
