import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:opto_sync_client/connectivity.dart';

const _actionField = 'mbt::actionTaken';
const _requiredActions = <String>[
  'init',
  'idle',
  'publish_unknown',
  'publish_offline',
  'publish_link',
  'publish_internet',
  'force_offline',
  'restore_automatic',
];
const _requiredScenarios = <String>[
  'idempotent_force_offline',
  'idempotent_restore_automatic',
];
const _publishedStateByAction = <String, OptoSyncConnectivityState>{
  'publish_unknown': OptoSyncConnectivityState.unknown,
  'publish_offline': OptoSyncConnectivityState.offline,
  'publish_link': OptoSyncConnectivityState.link,
  'publish_internet': OptoSyncConnectivityState.internet,
};
const _stateByTag = <String, OptoSyncConnectivityState>{
  'Unknown': OptoSyncConnectivityState.unknown,
  'Offline': OptoSyncConnectivityState.offline,
  'Link': OptoSyncConnectivityState.link,
  'Internet': OptoSyncConnectivityState.internet,
};
const _modeByTag = <String, OptoSyncConnectivityMode>{
  'Automatic': OptoSyncConnectivityMode.automatic,
  'ForcedOffline': OptoSyncConnectivityMode.offline,
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

T _enumValue<T>(Object? value, Map<String, T> mapping, String label) {
  final encoded = _object(value, label);
  final tag = _field(encoded, 'tag');
  if (tag is! String || !mapping.containsKey(tag)) {
    _invalid('unknown $label $tag');
  }
  return mapping[tag] as T;
}

Map<String, Object?> _modelProjection(Map<String, Object?> rawState) {
  final state = _object(_field(rawState, 's'), 'ITF connectivity state');
  for (final name in <String>['exposed_verified', 'emitted']) {
    if (_field(state, name) is! bool) _invalid('$name must be boolean');
  }
  return <String, Object?>{
    'state': _enumValue(
      state['exposed_state'],
      _stateByTag,
      'connectivity state',
    ).name,
    'mode': _enumValue(state['mode'], _modeByTag, 'connectivity mode').name,
    'verified': state['exposed_verified'],
    'emitted': state['emitted'],
  };
}

Map<String, Object?> _implementationProjection(
  ManualOptoSyncConnectivityWatcher watcher,
  bool emitted,
) {
  final snapshot = watcher.snapshot;
  return <String, Object?>{
    'state': snapshot.state.name,
    'mode': snapshot.mode.name,
    'verified': snapshot.verifiedAt != null,
    'emitted': emitted,
  };
}

void _applyAction(ManualOptoSyncConnectivityWatcher watcher, String action) {
  final publishedState = _publishedStateByAction[action];
  if (publishedState != null) {
    watcher.publish(publishedState);
    return;
  }
  if (action == 'force_offline') {
    watcher.setMode(OptoSyncConnectivityMode.offline);
    return;
  }
  if (action == 'restore_automatic') {
    watcher.setMode(OptoSyncConnectivityMode.automatic);
    return;
  }
  if (action != 'idle') {
    _invalid('model action $action has no production operation');
  }
}

bool _sameProjection(Map<String, Object?> left, Map<String, Object?> right) {
  if (left.length != right.length) return false;
  return left.keys.every(
    (key) => right.containsKey(key) && left[key] == right[key],
  );
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
    _invalid('ITF trace exceeds the connectivity replay state limit');
  }

  var clock = 1;
  final watcher = ManualOptoSyncConnectivityWatcher(
    now: () => DateTime.fromMillisecondsSinceEpoch(clock++),
  );
  var deliveryCount = 0;
  final subscription = watcher.changes.listen((_) {
    deliveryCount += 1;
  });

  Map<String, Object?>? mismatch;
  try {
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

      final deliveriesBefore = deliveryCount;
      if (step == 0) {
        if (action != 'init') {
          _invalid('the first connectivity state must be init');
        }
      } else {
        final previousMode = watcher.snapshot.mode;
        if (action == 'force_offline' &&
            previousMode == OptoSyncConnectivityMode.offline) {
          scenarios.add('idempotent_force_offline');
        }
        if (action == 'restore_automatic' &&
            previousMode == OptoSyncConnectivityMode.automatic) {
          scenarios.add('idempotent_restore_automatic');
        }
        _applyAction(watcher, action);
      }

      final expected = _modelProjection(rawState);
      final actual = _implementationProjection(
        watcher,
        deliveryCount > deliveriesBefore,
      );
      if (!_sameProjection(actual, expected)) {
        mismatch = <String, Object?>{
          'trace': path,
          'step': step,
          'action': action,
          'message':
              'production Dart connectivity watcher does not refine Quint',
          'expected': expected,
          'actual': actual,
        };
        break;
      }
    }
  } finally {
    await subscription.cancel();
    await watcher.close();
  }
  return mismatch;
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
  if (request['protocol'] != 'fmctl.adapter.v1') {
    _invalid('unsupported adapter protocol');
  }
  if (request['adapter'] != 'dart') {
    _invalid('request selected a non-Dart adapter');
  }
  if (request['project'] != 'opto-sync-clients') {
    _invalid('unexpected connectivity project');
  }
  if (request['model'] != 'connectivity-override-v1') {
    _invalid('unexpected connectivity model');
  }
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

Future<Map<String, Object?>> _replayPaths(List<String> inputPaths) async {
  final paths = inputPaths.toList()..sort();
  final coverage = <String>{};
  final scenarios = <String>{};
  final mismatches = <Map<String, Object?>>[];
  var passed = 0;
  for (final path in paths) {
    try {
      final mismatch = await _replayTrace(path, coverage, scenarios);
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
          'connectivity trace corpus is missing actions: ${missing.join(', ')}',
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
          'connectivity trace corpus is missing critical scenarios: '
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
      'name': 'opto_sync_client ManualOptoSyncConnectivityWatcher',
      'version': '1.1.0',
    },
  };
}

Future<void> main(List<String> arguments) async {
  try {
    if (arguments.isNotEmpty) {
      stdout.writeln(
        const JsonEncoder.withIndent(
          ' ',
        ).convert(await _replayPaths(arguments)),
      );
      return;
    }
    final request = _validateRequest(
      jsonDecode(await stdin.transform(utf8.decoder).join()),
    );
    final traces = (request['traces']! as List).cast<String>();
    stdout.write(jsonEncode(await _replayPaths(traces)));
  } on Object catch (error, stackTrace) {
    stderr.writeln(error);
    stderr.writeln(stackTrace);
    exitCode = 1;
  }
}
