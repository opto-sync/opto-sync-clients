import 'dart:async';

import 'package:opto_sync_reactive/opto_sync_reactive.dart';
import 'package:rxdart/rxdart.dart';

final _identity = SyncSessionIdentity(
  sharedUserId: 'user-1',
  provider: 'supabase',
  providerTenant: 'project-a',
  providerSubject: 'subject-1',
  sessionId: 'session-a',
);

Future<void> _waitFor(bool Function() test) async {
  final deadline = DateTime.now().add(const Duration(seconds: 3));
  while (!test()) {
    if (DateTime.now().isAfter(deadline)) {
      throw TimeoutException('Supabase lifecycle condition did not become true');
    }
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

final class _Auth implements SupabaseRealtimeAuthLike {
  _Auth(this.appliedTokens, {this.fail = false});

  final List<String> appliedTokens;
  final bool fail;

  @override
  Future<void> setAuth(String accessToken) async {
    if (fail) throw StateError('$accessToken from provider');
    appliedTokens.add(accessToken);
  }
}

final class _Channel implements SupabaseRealtimeHintChannel {
  SupabaseHintPayloadListener? payloadListener;
  SupabaseHintStatusListener? statusListener;
  int unsubscribeCalls = 0;

  @override
  void subscribe({
    required SupabaseHintPayloadListener onPayload,
    required SupabaseHintStatusListener onStatus,
  }) {
    payloadListener = onPayload;
    statusListener = onStatus;
    onStatus(SupabaseHintChannelStatus.subscribed);
  }

  void emitPayload(Object? payload) => payloadListener?.call(payload);

  void emitStatus(SupabaseHintChannelStatus status, [Object? error]) =>
      statusListener?.call(status, error);

  @override
  Future<void> unsubscribe() async {
    unsubscribeCalls += 1;
  }
}

Future<void> _freshAuthAndRetryTest() async {
  final sessions = BehaviorSubject<SyncSession>.seeded(
    AuthenticatedSyncSession(_identity),
  );
  final channels = <_Channel>[];
  final appliedTokens = <String>[];
  final retryGates = <Completer<void>>[];
  final retryDelays = <Duration>[];
  final hints = <SyncHint>[];
  var tokenSequence = 0;

  final stream = createSupabaseHints(
    sessions: sessions,
    auth: SupabaseRealtimeAuthBinding(
      realtime: _Auth(appliedTokens),
      accessToken: (_) {
        tokenSequence += 1;
        return 'jwt-$tokenSequence';
      },
    ),
    channel: (_) {
      final channel = _Channel();
      channels.add(channel);
      return channel;
    },
    decode: (_, _) => const DecodedSyncHint(
      table: 'todos',
      recordId: 'todo-1',
    ),
    retryBase: const Duration(milliseconds: 10),
    retryMax: const Duration(milliseconds: 20),
    retryAttempts: 2,
    retryDelay: (duration) {
      retryDelays.add(duration);
      final gate = Completer<void>();
      retryGates.add(gate);
      return gate.future.asStream();
    },
  );
  final subscription = stream.listen(hints.add);

  await _waitFor(() => channels.length == 1);
  final stalePayload = channels.first.payloadListener;
  channels.first.emitStatus(
    SupabaseHintChannelStatus.closed,
    StateError('credential-in-reason'),
  );
  await _waitFor(
    () => retryGates.length == 1 && channels.first.unsubscribeCalls == 1,
  );
  retryGates.single.complete();
  await _waitFor(() => channels.length == 2);

  stalePayload?.call(<String, Object?>{'id': 'stale'});
  await Future<void>.delayed(Duration.zero);
  if (hints.isNotEmpty) {
    throw StateError('retired Supabase channel emitted a wake hint');
  }

  channels[1].emitPayload(<String, Object?>{'id': 'todo-1'});
  await _waitFor(() => hints.length == 1);
  final hint = hints.single;
  if (appliedTokens.join(',') != 'jwt-1,jwt-2' ||
      retryDelays.single != const Duration(milliseconds: 10) ||
      hint.reason != SyncHintReason.remoteChange ||
      hint.source != SyncSource.supabase ||
      hint.sessionPartition != transportSessionKey(_identity) ||
      hint.table != 'todos' ||
      hint.recordId != 'todo-1') {
    throw StateError(
      'Supabase reconnect/auth contract failed: '
      'tokens=$appliedTokens delays=$retryDelays hint=$hint',
    );
  }

  await subscription.cancel();
  await sessions.close();
  if (channels[1].unsubscribeCalls != 1) {
    throw StateError('active Supabase channel was not released exactly once');
  }
}

Future<void> _redactedFiniteAuthFailureTest() async {
  final sessions = BehaviorSubject<SyncSession>.seeded(
    AuthenticatedSyncSession(_identity),
  );
  final retryGate = Completer<void>();
  final errors = <Object>[];
  var tokenCalls = 0;
  var channelCalls = 0;

  final subscription = createSupabaseHints(
    sessions: sessions,
    auth: SupabaseRealtimeAuthBinding(
      realtime: _Auth(<String>[], fail: true),
      accessToken: (_) {
        tokenCalls += 1;
        return 'secret-jwt-value';
      },
    ),
    channel: (_) {
      channelCalls += 1;
      return _Channel();
    },
    retryAttempts: 1,
    retryDelay: (_) => retryGate.future.asStream(),
  ).listen(
    (_) {},
    onError: (Object error, StackTrace _) => errors.add(error),
  );

  await Future<void>.delayed(Duration.zero);
  retryGate.complete();
  await _waitFor(() => errors.length == 1);

  final message = errors.single.toString();
  if (tokenCalls != 2 ||
      channelCalls != 0 ||
      !message.contains('authentication update failed') ||
      message.contains('secret-jwt-value')) {
    throw StateError(
      'Supabase auth failure was not finite/redacted: '
      'tokenCalls=$tokenCalls channelCalls=$channelCalls error=$message',
    );
  }

  await subscription.cancel();
  await sessions.close();
}

Future<void> main() async {
  await _freshAuthAndRetryTest();
  await _redactedFiniteAuthFailureTest();
  print('RxDart Supabase auth/reconnect self-test passed');
}
