part of formal_itf_replay;

final class _TraceSummary {
  const _TraceSummary({required this.states, required this.actions});

  final int states;
  final Set<String> actions;
}

Future<_TraceSummary> _replay(String tracePath) async {
  Map<String, dynamic> trace;
  List<dynamic> states;
  try {
    trace = _object(
      jsonDecode(await File(tracePath).readAsString()),
      'ITF trace',
    );
    states = _array(trace['states'], 'ITF trace states');
    _ensure(
      states.isNotEmpty,
      '$tracePath: ITF trace has no states',
      expected: 'non-empty states',
      actual: states,
    );
    _ensure(
      _decodeState(states.first).action == 'init',
      '$tracePath: ITF trace must begin with init',
      expected: 'init',
      actual: _decodeState(states.first).action,
    );
  } on _FormalReplayError catch (error) {
    throw _TraceReplayError(
      trace: tracePath,
      step: null,
      action: null,
      message: error.message,
      expected: error.expected,
      actual: error.actual,
    );
  } on Object catch (error) {
    throw _TraceReplayError(
      trace: tracePath,
      step: null,
      action: null,
      message: 'could not read or parse ITF trace: $error',
      expected: 'valid ITF JSON',
      actual: error.toString(),
    );
  }

  _Adapter? adapter;
  final actions = <String>{};
  try {
    for (var index = 0; index < states.length; index += 1) {
      _DecodedState state;
      try {
        state = _decodeState(states[index]);
        _ensure(
          index == 0 || state.action != 'init',
          '$tracePath: unexpected init action at state $index',
          expected: 'non-init action',
          actual: state.action,
        );
        actions.add(state.action);
        final context = '$tracePath state $index action ${state.action}';
        adapter = await _applyAction(adapter, state, tracePath);
        await _assertProjection(adapter, state, context);
      } on _FormalReplayError catch (error) {
        throw _TraceReplayError(
          trace: tracePath,
          step: index,
          action: index < states.length
              ? _safeAction(states[index])
              : null,
          message: error.message,
          expected: error.expected,
          actual: error.actual,
        );
      } on _TraceReplayError {
        rethrow;
      } on Object catch (error) {
        throw _TraceReplayError(
          trace: tracePath,
          step: index,
          action: _safeAction(states[index]),
          message: 'implementation raised an unexpected error: $error',
          expected: 'successful production transition',
          actual: error.toString(),
        );
      }
    }
    return _TraceSummary(states: states.length, actions: actions);
  } finally {
    await adapter?.dispose();
  }
}

String? _safeAction(Object? rawState) {
  try {
    return _decodeState(rawState).action;
  } on Object {
    return null;
  }
}

Future<String> _clientVersion() async {
  final pubspec = await File('pubspec.yaml').readAsString();
  final match = RegExp(
    r'^version:\s*([^\s#]+)\s*$',
    multiLine: true,
  ).firstMatch(pubspec);
  if (match == null) {
    _fail(
      'could not read package version from pubspec.yaml',
      expected: 'version field',
      actual: pubspec,
    );
  }
  return match!.group(1)!;
}

Future<Map<String, Object?>> _replayPaths(
  List<String> inputPaths, {
  required bool protocolMode,
}) async {
  _ensure(
    inputPaths.isNotEmpty,
    'replay requires at least one ITF trace',
    expected: 'one or more trace paths',
    actual: inputPaths,
  );
  final paths = inputPaths.toList()..sort();
  var states = 0;
  var passed = 0;
  final actions = <String>{};
  final mismatches = <Map<String, Object?>>[];

  for (final tracePath in paths) {
    try {
      final summary = await _replay(tracePath);
      states += summary.states;
      passed += 1;
      actions.addAll(summary.actions);
      final diagnostic =
          'replayed ${summary.states} model states from $tracePath\n';
      if (protocolMode) {
        stderr.write(diagnostic);
      } else {
        stdout.write(diagnostic);
      }
    } on _TraceReplayError catch (error) {
      if (!protocolMode) {
        rethrow;
      }
      mismatches.add(error.toJson());
    }
  }

  final missing = _requiredActions
      .where((action) => !actions.contains(action))
      .toList(growable: false);
  if (missing.isNotEmpty) {
    final actualActions = actions.toList()..sort();
    final message =
        'trace suite left production adapter branches untested: '
        '${missing.join(', ')}';
    if (!protocolMode) {
      _fail(message, expected: _requiredActions, actual: actualActions);
    }
    if (passed > 0) {
      passed -= 1;
    }
    mismatches.add(<String, Object?>{
      'trace': paths.first,
      'step': null,
      'action': missing.first,
      'message': message,
      'expected': _requiredActions,
      'actual': actualActions,
    });
  }

  if (!protocolMode) {
    stdout.write(
      'Dart OptoSyncClient conformed to $states states across ${paths.length} '
      'Quint ITF traces covering all ${_requiredActions.length} model actions\n',
    );
  }

  return <String, Object?>{
    'protocol': _protocol,
    'success': mismatches.isEmpty && passed == paths.length,
    'traces_total': paths.length,
    'traces_passed': passed,
    'mismatches': mismatches,
    'implementation': <String, Object?>{
      'language': 'dart',
      'name': 'opto_sync_client OptoSyncClient',
      'version': await _clientVersion(),
    },
  };
}

Map<String, dynamic> _validateProtocolRequest(Object? value) {
  final request = _object(value, 'adapter request');
  final actualKeys = request.keys.toList()..sort();
  const expectedKeys = <String>[
    'adapter',
    'model',
    'project',
    'protocol',
    'specification',
    'traces',
  ];
  _ensure(
    _deepEqual(actualKeys, expectedKeys),
    'adapter request contains missing or unknown fields',
    expected: expectedKeys,
    actual: actualKeys,
  );
  _ensure(
    request['protocol'] == _protocol,
    'unsupported adapter protocol',
    expected: _protocol,
    actual: request['protocol'],
  );
  _ensure(
    request['adapter'] == 'dart',
    'request selected a non-Dart adapter',
    expected: 'dart',
    actual: request['adapter'],
  );
  _string(request['project'], 'project');
  _string(request['model'], 'model');
  final specification = _string(request['specification'], 'specification path');
  final traces = _array(request['traces'], 'trace paths');
  _ensure(
    traces.isNotEmpty &&
        traces.every((trace) => trace is String && trace.isNotEmpty),
    'request must contain non-empty trace paths',
    expected: 'one or more strings',
    actual: traces,
  );
  _ensure(
    File(specification).statSync().type == FileSystemEntityType.file,
    'specification is not a regular file',
    expected: 'regular file',
    actual: specification,
  );
  for (final trace in traces.cast<String>()) {
    _ensure(
      File(trace).statSync().type == FileSystemEntityType.file,
      'trace is not a regular file',
      expected: 'regular file',
      actual: trace,
    );
  }
  return request;
}

Future<void> _runProtocol() async {
  final input = await stdin.transform(utf8.decoder).join();
  final request = _validateProtocolRequest(jsonDecode(input));
  final traces = _array(request['traces'], 'trace paths').cast<String>();
  final response = await _replayPaths(traces, protocolMode: true);
  stdout.write(jsonEncode(response));
}
