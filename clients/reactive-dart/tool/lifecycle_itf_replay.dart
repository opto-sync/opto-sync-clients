import 'dart:convert';
import 'dart:io';

import 'package:opto_sync_reactive/opto_sync_reactive.dart';

const _actionField = 'mbt::actionTaken';
const _requiredActions = <String>[
  'init',
  'idle',
  'wake',
  'join',
  'begin_acquire',
  'acquire_granted',
  'acquire_deferred',
  'cancel',
  'cycle_settled',
  'release_settled',
  'request_close',
  'process_abort',
];
const _requiredScenarios = <String>[
  'close_during_acquire',
  'close_while_running',
  'wake_while_running',
  'grant_after_close',
  'defer_after_close',
  'release_after_close',
  'process_abort_with_permit',
];
const _eventByAction = <String, SyncLifecycleEvent>{
  'wake': SyncLifecycleEvent.wake,
  'join': SyncLifecycleEvent.join,
  'begin_acquire': SyncLifecycleEvent.beginAcquire,
  'acquire_granted': SyncLifecycleEvent.acquireGranted,
  'acquire_deferred': SyncLifecycleEvent.acquireDeferred,
  'cancel': SyncLifecycleEvent.cancel,
  'cycle_settled': SyncLifecycleEvent.cycleSettled,
  'release_settled': SyncLifecycleEvent.releaseSettled,
  'request_close': SyncLifecycleEvent.close,
  'process_abort': SyncLifecycleEvent.processAbort,
};
const _phaseByTag = <String, SyncLifecyclePhase>{
  'Idle': SyncLifecyclePhase.idle,
  'Acquiring': SyncLifecyclePhase.acquiring,
  'Running': SyncLifecyclePhase.running,
  'Releasing': SyncLifecyclePhase.releasing,
  'Closed': SyncLifecyclePhase.closed,
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

Map<String, Object?> _modelProjection(Map<String, Object?> rawState) {
  final state = _object(_field(rawState, 's'), 'ITF lifecycle state');
  final phase = _object(_field(state, 'phase'), 'ITF phase');
  final phaseTag = _field(phase, 'tag');
  if (phaseTag is! String || !_phaseByTag.containsKey(phaseTag)) {
    _invalid('unknown lifecycle phase $phaseTag');
  }
  for (final name in <String>[
    'wake_pending',
    'close_requested',
    'cancel_requested',
    'permit_held',
  ]) {
    if (_field(state, name) is! bool) _invalid('$name must be boolean');
  }
  return <String, Object?>{
    'phase': _phaseByTag[phaseTag]!.name,
    'wakePending': state['wake_pending'],
    'closeRequested': state['close_requested'],
    'cancelRequested': state['cancel_requested'],
    'permitHeld': state['permit_held'],
  };
}

Map<String, Object?> _implementationProjection(SyncLifecycleMachine machine) {
  final state = machine.state;
  return <String, Object?>{
    'phase': state.phase.name,
    'wakePending': state.wakePending,
    'closeRequested': state.closeRequested,
    'cancelRequested': state.cancelRequested,
    'permitHeld': state.permitHeld,
  };
}

void _recordScenario(
  String action,
  Map<String, Object?> previous,
  Set<String> scenarios,
) {
  if (action == 'request_close' && previous['phase'] == 'acquiring') {
    scenarios.add('close_during_acquire');
  }
  if (action == 'request_close' && previous['phase'] == 'running') {
    scenarios.add('close_while_running');
  }
  if (action == 'wake' && previous['phase'] == 'running') {
    scenarios.add('wake_while_running');
  }
  if (action == 'acquire_granted' && previous['closeRequested'] == true) {
    scenarios.add('grant_after_close');
  }
  if (action == 'acquire_deferred' && previous['closeRequested'] == true) {
    scenarios.add('defer_after_close');
  }
  if (action == 'release_settled' && previous['closeRequested'] == true) {
    scenarios.add('release_after_close');
  }
  if (action == 'process_abort' && previous['permitHeld'] == true) {
    scenarios.add('process_abort_with_permit');
  }
}

bool _sameProjection(Map<String, Object?> left, Map<String, Object?> right) {
  if (left.length != right.length) return false;
  return left.keys.every(
    (key) => right.containsKey(key) && left[key] == right[key],
  );
}

Map<String, Object?>? _replayTrace(
  String path,
  Set<String> coverage,
  Set<String> scenarios,
) {
  final trace = _object(jsonDecode(File(path).readAsStringSync()), 'ITF trace');
  final states = _field(trace, 'states');
  if (states is! List || states.isEmpty) {
    _invalid('ITF trace must contain states');
  }
  if (states.length > 100000) {
    _invalid('ITF trace exceeds the lifecycle replay state limit');
  }
  final machine = SyncLifecycleMachine();

  for (var step = 0; step < states.length; step += 1) {
    final rawState = _object(states[step], 'ITF state $step');
    final action = _field(rawState, _actionField);
    if (action is! String || action.isEmpty) {
      _invalid('ITF state $step has no model action');
    }
    if (!_requiredActions.contains(action)) {
      _invalid('ITF state $step has unknown action $action');
    }
    coverage.add(action);

    if (step == 0) {
      if (action != 'init') _invalid('the first lifecycle state must be init');
    } else if (action != 'idle') {
      _recordScenario(
        action,
        _modelProjection(_object(states[step - 1], 'ITF state ${step - 1}')),
        scenarios,
      );
      final event = _eventByAction[action];
      if (event == null)
        _invalid('model action $action has no production event');
      machine.apply(event);
    }

    final expected = _modelProjection(rawState);
    final actual = _implementationProjection(machine);
    if (!_sameProjection(actual, expected)) {
      return <String, Object?>{
        'trace': path,
        'step': step,
        'action': action,
        'message': 'production Dart lifecycle state does not refine Quint',
        'expected': expected,
        'actual': actual,
      };
    }
  }
  return null;
}

Map<String, Object?> _validateRequest(Object? value) {
  final request = _object(value, 'adapter request');
  final keys = request.keys.toList()..sort();
  const expectedKeys = <String>[
    'adapter',
    'model',
    'project',
    'protocol',
    'specification',
    'traces',
  ];
  if (jsonEncode(keys) != jsonEncode(expectedKeys)) {
    _invalid('adapter request contains missing or unknown fields');
  }
  if (request['protocol'] != 'fmctl.adapter.v1')
    _invalid('unsupported adapter protocol');
  if (request['adapter'] != 'dart')
    _invalid('request selected a non-Dart adapter');
  if (request['project'] != 'opto-sync-clients')
    _invalid('unexpected lifecycle project');
  if (request['model'] != 'mobile-desktop-lifecycle-v1')
    _invalid('unexpected lifecycle model');
  final specification = request['specification'];
  if (specification is! String ||
      File(specification).statSync().type != FileSystemEntityType.file) {
    _invalid('specification is not a regular file');
  }
  final traces = request['traces'];
  if (traces is! List ||
      traces.isEmpty ||
      traces.any(
        (path) =>
            path is! String ||
            File(path).statSync().type != FileSystemEntityType.file,
      )) {
    _invalid('request traces must be regular files');
  }
  return request;
}

Map<String, Object?> _replayPaths(List<String> inputPaths) {
  final paths = inputPaths.toList()..sort();
  final coverage = <String>{};
  final scenarios = <String>{};
  final mismatches = <Map<String, Object?>>[];
  var passed = 0;
  for (final path in paths) {
    try {
      final mismatch = _replayTrace(path, coverage, scenarios);
      if (mismatch == null) {
        passed += 1;
      } else {
        mismatches.add(mismatch);
      }
    } on Object catch (error) {
      mismatches.add(<String, Object?>{
        'trace': path,
        'step': null,
        'action': null,
        'message': error.toString(),
        'expected': <String, Object?>{},
        'actual': <String, Object?>{},
      });
    }
  }

  final missing = _requiredActions
      .where((action) => !coverage.contains(action))
      .toList();
  if (missing.isNotEmpty) {
    mismatches.add(<String, Object?>{
      'trace': paths.first,
      'step': null,
      'action': null,
      'message':
          'lifecycle trace corpus is missing actions: ${missing.join(', ')}',
      'expected': _requiredActions,
      'actual': coverage.toList()..sort(),
    });
    if (passed == paths.length) passed -= 1;
  }

  final missingScenarios = _requiredScenarios
      .where((scenario) => !scenarios.contains(scenario))
      .toList();
  if (missingScenarios.isNotEmpty) {
    mismatches.add(<String, Object?>{
      'trace': paths.first,
      'step': null,
      'action': null,
      'message':
          'lifecycle trace corpus is missing critical scenarios: '
          '${missingScenarios.join(', ')}',
      'expected': _requiredScenarios,
      'actual': scenarios.toList()..sort(),
    });
    if (passed == paths.length) passed -= 1;
  }

  return <String, Object?>{
    'protocol': 'fmctl.adapter.v1',
    'success': mismatches.isEmpty,
    'traces_total': paths.length,
    'traces_passed': passed,
    'mismatches': mismatches,
    'implementation': <String, Object?>{
      'language': 'dart',
      'name': 'opto_sync_reactive SyncLifecycleMachine',
      'version': '0.2.1',
    },
  };
}

Future<void> main(List<String> arguments) async {
  try {
    if (arguments.isNotEmpty) {
      stdout.writeln(
        const JsonEncoder.withIndent('  ').convert(_replayPaths(arguments)),
      );
      return;
    }
    final request = _validateRequest(
      jsonDecode(await stdin.transform(utf8.decoder).join()),
    );
    final traces = (request['traces']! as List).cast<String>();
    stdout.write(jsonEncode(_replayPaths(traces)));
  } on Object catch (error, stackTrace) {
    stderr.writeln(error);
    stderr.writeln(stackTrace);
    exitCode = 1;
  }
}
