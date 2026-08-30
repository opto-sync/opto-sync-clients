import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:opto_sync_client/opto_sync_client.dart';

const _actionField = 'mbt::actionTaken';
const _requiredActions = <String>[
  'init',
  'idle',
  'start',
  'stop',
  'hint',
  'go_offline',
  'go_online',
  'timer_fire',
  'timer_join',
  'stale_timer_fire',
  'page_more',
  'begin_reset',
  'finish_reset',
  'cycle_success',
  'cycle_success_more',
  'cycle_retryable_failure',
  'cycle_permanent_failure',
  'malformed_response',
  'stale_cycle_success',
  'stale_cycle_failure',
];
const _requiredScenarios = <String>[
  'stop_during_cycle',
  'trailing_wake',
  'offline_during_cycle',
  'online_recovery',
  'retryable_failure',
  'permanent_failure',
  'reset_ordering',
  'malformed_response',
  'paging_rerun',
  'stale_cycle',
  'stale_timer',
];
const _phaseByTag = <String, String>{
  'Stopped': 'stopped',
  'Idle': 'idle',
  'Syncing': 'syncing',
  'Offline': 'offline',
  'Backoff': 'backoff',
  'Error': 'error',
};
const _phaseByStatus = <ProtocolSyncStatus, String>{
  ProtocolSyncStatus.stopped: 'stopped',
  ProtocolSyncStatus.idle: 'idle',
  ProtocolSyncStatus.syncing: 'syncing',
  ProtocolSyncStatus.offline: 'offline',
  ProtocolSyncStatus.backoff: 'backoff',
  ProtocolSyncStatus.error: 'error',
};
const _resetByTag = <String, String>{
  'NoReset': 'none',
  'SnapshotRequested': 'requested',
  'SnapshotInstalled': 'installed',
};

Never _invalid(String message) => throw FormatException(message);

Map<String, Object?> _object(Object? value, String label) {
  if (value is! Map || value.keys.any((key) => key is! String)) {
    _invalid('$label must be an object');
  }
  return Map<String, Object?>.from(value);
}

Object? _field(Map<String, Object?> value, String name) {
  if (!value.containsKey(name)) _invalid('missing field $name');
  return value[name];
}

T _tagged<T>(Object? value, Map<String, T> mapping, String label) {
  final encoded = _object(value, label);
  final tag = _field(encoded, 'tag');
  if (tag is! String || !mapping.containsKey(tag)) {
    _invalid('unknown $label tag $tag');
  }
  return mapping[tag] as T;
}

Map<String, Object?> _modelProjection(Map<String, Object?> rawState) {
  final state = _object(_field(rawState, 's'), 'ITF scheduler state');
  bool boolean(String name) {
    final value = _field(state, name);
    if (value is! bool) _invalid('$name must be boolean');
    return value;
  }

  int integer(String name) {
    final value = _object(_field(state, name), name);
    final encoded = _field(value, '#bigint');
    if (encoded is! String || !RegExp(r'^(?:0|[1-9]\d*)$').hasMatch(encoded)) {
      _invalid('$name must contain a canonical non-negative ITF bigint');
    }
    return int.parse(encoded);
  }

  return <String, Object?>{
    'phase': _tagged(state['phase'], _phaseByTag, 'phase'),
    'online': boolean('online'),
    'timerPending': boolean('timer_pending'),
    'cyclePending': boolean('cycle_pending'),
    'networkActive': boolean('network_active'),
    'wakePending': boolean('wake_pending'),
    'consecutiveFailures': integer('consecutive_failures'),
    'resetPhase': _tagged(state['reset_phase'], _resetByTag, 'reset phase'),
    'pagesSeen': integer('pages_seen'),
  };
}

final class _ManualTimer implements ProtocolSyncTimer {
  final void Function() callback;
  bool active = true;
  bool fired = false;

  _ManualTimer(this.callback);

  @override
  void cancel() => active = false;

  void fire() {
    if (fired) _invalid('timer fired twice');
    fired = true;
    active = false;
    callback();
  }
}

final class _ManualTimers {
  final List<_ManualTimer> handles = <_ManualTimer>[];

  ProtocolSyncTimer create(Duration _, void Function() callback) {
    final timer = _ManualTimer(callback);
    handles.add(timer);
    return timer;
  }

  bool get pending => handles.any((timer) => timer.active && !timer.fired);

  void fireCurrent() {
    final matching = handles.where((timer) => timer.active && !timer.fired);
    if (matching.isEmpty) _invalid('no current timer to fire');
    matching.last.fire();
  }

  void fireStale() {
    final matching = handles.where((timer) => !timer.active && !timer.fired);
    if (matching.isEmpty) _invalid('no cancelled timer to fire');
    matching.first.fire();
  }
}

ProtocolJson _mutation(String id) => <String, dynamic>{
  'mutationId': id,
  'operation': 'upsert',
  'table': 'docs',
  'recordId': 'record-$id',
  'payload': <String, dynamic>{'id': id},
};

final class _ReplayQueue implements ProtocolQueueAdapter {
  String checkpoint = '0';
  List<ProtocolJson> pending = <ProtocolJson>[];

  @override
  Future<ProtocolJson> protocolPushRequest({int limit = 100}) async =>
      <String, dynamic>{
        'protocolVersion': 1,
        'clientId': 'formal-dart',
        'mutations': pending.take(limit).toList(growable: false),
      };

  @override
  Future<int> acknowledgePush(
    ProtocolJson response,
    ProtocolJson request,
  ) async {
    final watermark = BigInt.parse(response['lastMutationId'] as String);
    final before = pending.length;
    pending = pending
        .where(
          (entry) => BigInt.parse(entry['mutationId'] as String) > watermark,
        )
        .toList(growable: true);
    return before - pending.length;
  }

  @override
  Future<String> pullCheckpoint() async => checkpoint;

  @override
  Future<void> setPullCheckpoint(String value) async {
    checkpoint = value;
  }

  @override
  Future<void> installSnapshot(
    ProtocolJson snapshot,
    Future<void> Function(List<ProtocolJson> records) replaceAuthoritative,
  ) async {
    final records = (snapshot['records'] as List)
        .map((value) => Map<String, dynamic>.from(value as Map))
        .toList(growable: false);
    await replaceAuthoritative(records);
    checkpoint = snapshot['checkpoint'] as String;
  }
}

final class _PendingPull {
  final String checkpoint;
  final ProtocolCancellationToken cancellation;
  final Completer<ProtocolJson> completer = Completer<ProtocolJson>();

  _PendingPull(this.checkpoint, this.cancellation);
}

final class _ControlledTransport implements ProtocolTransport {
  _PendingPull? pendingPull;
  Completer<ProtocolJson>? pendingSnapshot;
  bool autoSuccess = false;
  bool cyclePending = false;
  String resetPhase = 'none';
  int pagesSeen = 0;

  @override
  Future<ProtocolJson> pull(
    String checkpoint,
    int _,
    ProtocolCancellationToken cancellation,
  ) {
    cyclePending = true;
    if (autoSuccess) {
      return Future<ProtocolJson>.value(<String, dynamic>{
        'protocolVersion': 1,
        'checkpoint': checkpoint,
        'hasMore': false,
        'changes': <Object?>[],
      });
    }
    if (pendingPull != null) {
      _invalid('production loop issued overlapping pulls');
    }
    final pending = _PendingPull(checkpoint, cancellation);
    pendingPull = pending;
    return pending.completer.future;
  }

  @override
  Future<ProtocolJson> push(
    ProtocolJson request,
    ProtocolCancellationToken _,
  ) async {
    final mutations = request['mutations'] as List;
    if (mutations.isEmpty) _invalid('push must contain a mutation');
    final last = Map<String, dynamic>.from(mutations.last as Map);
    final lastMutationId = last['mutationId'] as String;
    return <String, dynamic>{
      'protocolVersion': 1,
      'clientId': request['clientId'],
      'lastMutationId': lastMutationId,
      'checkpoint': '0',
      'results': mutations
          .map(
            (entry) => <String, dynamic>{
              'mutationId': (entry as Map)['mutationId'],
              'status': 'applied',
            },
          )
          .toList(growable: false),
    };
  }

  @override
  Future<ProtocolJson> snapshot(
    ProtocolCancellationToken _, [
    ProtocolJson? reset,
  ]) {
    if (pendingSnapshot != null) {
      _invalid('production loop issued overlapping snapshots');
    }
    resetPhase = 'requested';
    final completer = Completer<ProtocolJson>();
    pendingSnapshot = completer;
    return completer.future;
  }

  void resolvePage(bool hasMore) {
    final pending = _takePull();
    final next = (BigInt.parse(pending.checkpoint) + BigInt.one).toString();
    if (hasMore) pagesSeen++;
    pending.completer.complete(<String, dynamic>{
      'protocolVersion': 1,
      'checkpoint': next,
      'hasMore': hasMore,
      'changes': <Object?>[],
    });
  }

  void resolveReset() {
    _takePull().completer.complete(<String, dynamic>{
      'protocolVersion': 1,
      'error': 'RESET_REQUIRED',
    });
  }

  void resolveSnapshot() {
    final completer = pendingSnapshot;
    if (completer == null) _invalid('no snapshot to resolve');
    pendingSnapshot = null;
    resetPhase = 'installed';
    completer.complete(<String, dynamic>{
      'protocolVersion': 1,
      'checkpoint': '10',
      'records': <Object?>[
        <String, dynamic>{
          'table': 'docs',
          'recordId': 'snapshot',
          'record': <String, dynamic>{'snapshot': true},
          'revision': '1',
        },
      ],
    });
  }

  void resolveMalformed() {
    if (pendingPull != null) {
      final pending = _takePull();
      pending.completer.complete(<String, dynamic>{
        'protocolVersion': 1,
        'checkpoint': pending.checkpoint,
        'hasMore': 'false',
        'changes': <Object?>[],
      });
      return;
    }

    _takeSnapshot().complete(<String, dynamic>{
      'protocolVersion': 1,
      'checkpoint': '10',
      'records': 'not-an-array',
    });
  }

  void reject(Object error) {
    if (pendingPull != null) {
      _takePull().completer.completeError(error);
      return;
    }
    _takeSnapshot().completeError(error);
  }

  _PendingPull _takePull() {
    final pending = pendingPull;
    if (pending == null) _invalid('no pull to settle');
    pendingPull = null;
    return pending;
  }

  Completer<ProtocolJson> _takeSnapshot() {
    final pending = pendingSnapshot;
    if (pending == null) _invalid('no request to settle');
    pendingSnapshot = null;
    return pending;
  }
}

final class _Callbacks implements ProtocolSyncCallbacks {
  @override
  Future<void> applyChanges(List<ProtocolJson> _) async {}

  @override
  Future<void> replaceAuthoritative(List<ProtocolJson> _) async {}
}

Future<void> _eventually(bool Function() predicate, String message) async {
  for (var attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await Future<void>.delayed(Duration.zero);
  }
  throw StateError(message);
}

final class _ReplayHarness {
  bool online = true;
  bool wakePending = false;
  final _ManualTimers timers = _ManualTimers();
  final _ReplayQueue queue = _ReplayQueue();
  final _ControlledTransport transport = _ControlledTransport();
  late final ProtocolSyncLoop loop = ProtocolSyncLoop(
    queue,
    transport,
    _Callbacks(),
    pushLimit: 1,
    maxPushBatchesPerCycle: 1,
    retryBase: const Duration(milliseconds: 1),
    retryMaximum: const Duration(milliseconds: 8),
    random: () => 0,
    now: () => DateTime.fromMillisecondsSinceEpoch(0),
    isOnline: () => online,
    timerFactory: timers.create,
  );

  Map<String, Object?> projection() {
    final phase = _phaseByStatus[loop.state.status] as String;
    final cyclePending = transport.cyclePending;
    final ownsActiveCycle = phase == 'syncing';
    return <String, Object?>{
      'phase': phase,
      'online': online,
      'timerPending': timers.pending,
      'cyclePending': cyclePending,
      'networkActive': phase == 'syncing' && online && cyclePending,
      'wakePending': wakePending,
      'consecutiveFailures': loop.state.consecutiveFailures,
      'resetPhase': ownsActiveCycle ? transport.resetPhase : 'none',
      'pagesSeen': ownsActiveCycle ? transport.pagesSeen : 0,
    };
  }

  Future<void> apply(String action) async {
    switch (action) {
      case 'idle':
        return;
      case 'start':
        loop.start();
        return;
      case 'stop':
        loop.stop();
        wakePending = false;
        return;
      case 'hint':
        if (transport.cyclePending) wakePending = true;
        loop.hint();
        return;
      case 'go_offline':
        online = false;
        loop.hint();
        wakePending = false;
        return;
      case 'go_online':
        online = true;
        if (transport.cyclePending) wakePending = true;
        loop.hint();
        return;
      case 'timer_fire':
        timers.fireCurrent();
        await _eventually(
          () => transport.pendingPull != null,
          'timer did not start a production cycle',
        );
        return;
      case 'timer_join':
        timers.fireCurrent();
        wakePending = true;
        await Future<void>.delayed(Duration.zero);
        return;
      case 'stale_timer_fire':
        timers.fireStale();
        await Future<void>.delayed(Duration.zero);
        return;
      case 'page_more':
        transport.resolvePage(true);
        await _eventually(
          () => transport.pendingPull != null,
          'hasMore did not request the next page',
        );
        return;
      case 'begin_reset':
        transport.resolveReset();
        await _eventually(
          () => transport.pendingSnapshot != null,
          'reset did not request a snapshot',
        );
        return;
      case 'finish_reset':
        transport.resolveSnapshot();
        await _eventually(
          () => transport.pendingPull != null,
          'snapshot install did not resume pull',
        );
        return;
      case 'cycle_success_more':
        queue.pending = <ProtocolJson>[_mutation('1'), _mutation('2')];
        await _settleSuccess();
        return;
      case 'cycle_success':
      case 'stale_cycle_success':
        await _settleSuccess();
        return;
      case 'cycle_retryable_failure':
      case 'stale_cycle_failure':
        transport.reject(
          const SyncTransportException('retryable formal failure'),
        );
        await _settleCycle();
        return;
      case 'cycle_permanent_failure':
        transport.reject(
          const SyncTransportException(
            'permanent formal failure',
            retryable: false,
          ),
        );
        await _settleCycle();
        return;
      case 'malformed_response':
        transport.resolveMalformed();
        await _settleCycle();
        return;
      default:
        _invalid('model action $action has no production operation');
    }
  }

  Future<void> _settleSuccess() async {
    transport.autoSuccess = true;
    if (transport.pendingSnapshot != null) {
      transport.resolveSnapshot();
    } else {
      transport.resolvePage(false);
    }
    await _settleCycle();
    transport.autoSuccess = false;
  }

  Future<void> _settleCycle() async {
    await _eventually(
      () => loop.state.status != ProtocolSyncStatus.syncing,
      'production cycle did not settle',
    );
    await Future<void>.delayed(Duration.zero);
    transport.cyclePending = false;
    transport.resetPhase = 'none';
    transport.pagesSeen = 0;
    wakePending = false;
  }
}

bool _sameProjection(Map<String, Object?> left, Map<String, Object?> right) {
  if (left.length != right.length) return false;
  return left.keys.every(
    (key) => right.containsKey(key) && left[key] == right[key],
  );
}

void _recordScenario(
  String action,
  Map<String, Object?> previous,
  Set<String> scenarios,
) {
  if (action == 'stop' && previous['cyclePending'] == true) {
    scenarios.add('stop_during_cycle');
  }
  if ((action == 'hint' || action == 'timer_join') &&
      previous['cyclePending'] == true) {
    scenarios.add('trailing_wake');
  }
  if (action == 'go_offline' && previous['cyclePending'] == true) {
    scenarios.add('offline_during_cycle');
  }
  if (action == 'go_online') scenarios.add('online_recovery');
  if (action == 'cycle_retryable_failure') {
    scenarios.add('retryable_failure');
  }
  if (action == 'cycle_permanent_failure') {
    scenarios.add('permanent_failure');
  }
  if (action == 'finish_reset') scenarios.add('reset_ordering');
  if (action == 'malformed_response') scenarios.add('malformed_response');
  if (action == 'cycle_success_more') scenarios.add('paging_rerun');
  if (action == 'stale_cycle_success' || action == 'stale_cycle_failure') {
    scenarios.add('stale_cycle');
  }
  if (action == 'stale_timer_fire') scenarios.add('stale_timer');
}

Future<Map<String, Object?>?> _replayTrace(
  String path,
  Set<String> coverage,
  Set<String> scenarios,
) async {
  final trace = _object(jsonDecode(File(path).readAsStringSync()), 'ITF trace');
  final states = _field(trace, 'states');
  if (states is! List || states.isEmpty) {
    _invalid('ITF trace must contain states');
  }
  if (states.length > 100000) {
    _invalid('ITF trace exceeds scheduler replay limit');
  }
  final harness = _ReplayHarness();
  try {
    for (var step = 0; step < states.length; step++) {
      final rawState = _object(states[step], 'ITF state $step');
      final action = _field(rawState, _actionField);
      if (action is! String || !_requiredActions.contains(action)) {
        _invalid('ITF state $step has unknown action $action');
      }
      coverage.add(action);
      if (step == 0) {
        if (action != 'init') _invalid('first scheduler state must be init');
      } else {
        final previous = _modelProjection(
          _object(states[step - 1], 'prior ITF state'),
        );
        _recordScenario(action, previous, scenarios);
        await harness.apply(action);
      }

      final expected = _modelProjection(rawState);
      final actual = harness.projection();
      if (!_sameProjection(actual, expected)) {
        return <String, Object?>{
          'trace': path,
          'step': step,
          'action': action,
          'message': 'production Dart scheduler does not refine Quint',
          'expected': expected,
          'actual': actual,
        };
      }
    }
  } finally {
    harness.loop.stop();
  }
  return null;
}

Map<String, Object?> _validateRequest(Object? value) {
  final request = _object(value, 'adapter request');
  if (request['protocol'] != 'fmctl.adapter.v1') {
    _invalid('unsupported adapter protocol');
  }
  if (request['adapter'] != 'dart') {
    _invalid('request selected a non-Dart adapter');
  }
  if (request['project'] != 'opto-sync-clients') {
    _invalid('unexpected scheduler project');
  }
  if (request['model'] != 'protocol-sync-scheduler-v1') {
    _invalid('unexpected scheduler model');
  }
  final specification = request['specification'];
  if (specification is! String ||
      FileSystemEntity.typeSync(specification) != FileSystemEntityType.file) {
    _invalid('specification is not a file');
  }
  final traces = request['traces'];
  if (traces is! List ||
      traces.isEmpty ||
      traces.any(
        (path) =>
            path is! String ||
            FileSystemEntity.typeSync(path) != FileSystemEntityType.file,
      )) {
    _invalid('request must contain trace files');
  }
  return request;
}

Future<Map<String, Object?>> _replayPaths(List<String> paths) async {
  final coverage = <String>{};
  final scenarios = <String>{};
  final mismatches = <Map<String, Object?>>[];
  var passed = 0;
  paths.sort();
  for (final path in paths) {
    try {
      final mismatch = await _replayTrace(path, coverage, scenarios);
      if (mismatch == null) {
        passed++;
      } else {
        mismatches.add(mismatch);
      }
    } catch (error) {
      mismatches.add(<String, Object?>{
        'trace': path,
        'step': null,
        'action': null,
        'message': '$error',
        'expected': <String, Object?>{},
        'actual': <String, Object?>{},
      });
    }
  }

  final missing = _requiredActions
      .where((action) => !coverage.contains(action))
      .toList();
  final missingScenarios = _requiredScenarios
      .where((scenario) => !scenarios.contains(scenario))
      .toList();
  if (missing.isNotEmpty || missingScenarios.isNotEmpty) {
    mismatches.add(<String, Object?>{
      'trace': paths.first,
      'step': null,
      'action': null,
      'message':
          'scheduler corpus coverage missing actions $missing scenarios $missingScenarios',
      'expected': <String, Object?>{
        'actions': _requiredActions,
        'scenarios': _requiredScenarios,
      },
      'actual': <String, Object?>{
        'actions': coverage.toList()..sort(),
        'scenarios': scenarios.toList()..sort(),
      },
    });
    if (passed == paths.length) passed--;
  }

  return <String, Object?>{
    'protocol': 'fmctl.adapter.v1',
    'success': mismatches.isEmpty,
    'traces_total': paths.length,
    'traces_passed': passed,
    'mismatches': mismatches,
    'implementation': <String, Object?>{
      'language': 'dart',
      'name': 'opto_sync_client ProtocolSyncLoop',
      'version': '1.2.0',
    },
  };
}

Future<void> main(List<String> arguments) async {
  late final List<String> paths;
  if (arguments.isNotEmpty) {
    paths = arguments;
  } else {
    final request = _validateRequest(
      jsonDecode(await stdin.transform(utf8.decoder).join()),
    );
    paths = (request['traces'] as List).cast<String>();
  }
  stdout.writeln(jsonEncode(await _replayPaths(paths)));
}
