part of '../formal_itf_replay.dart';

final class _FormalReplayError implements Exception {
  const _FormalReplayError(
    this.message, {
    this.expected,
    this.actual,
  });

  final String message;
  final Object? expected;
  final Object? actual;

  @override
  String toString() => message;
}

final class _TraceReplayError implements Exception {
  const _TraceReplayError({
    required this.trace,
    required this.step,
    required this.action,
    required this.message,
    required this.expected,
    required this.actual,
  });

  final String trace;
  final int? step;
  final String? action;
  final String message;
  final Object? expected;
  final Object? actual;

  Map<String, Object?> toJson() => <String, Object?>{
    'trace': trace,
    'step': step,
    'action': action,
    'message': message,
    'expected': expected,
    'actual': actual,
  };

  @override
  String toString() {
    final location = step == null
        ? trace
        : '$trace state $step${action == null ? '' : ' action $action'}';
    return '$location: $message';
  }
}

Never _fail(
  String message, {
  Object? expected,
  Object? actual,
}) => throw _FormalReplayError(
  message,
  expected: expected,
  actual: actual,
);

void _ensure(
  bool condition,
  String message, {
  Object? expected,
  Object? actual,
}) {
  if (!condition) {
    _fail(message, expected: expected, actual: actual);
  }
}

Map<String, dynamic> _object(Object? value, String context) {
  if (value is! Map) {
    _fail(
      '$context must be a JSON object',
      expected: 'object',
      actual: value,
    );
  }
  final result = <String, dynamic>{};
  for (final entry in value.entries) {
    if (entry.key is! String) {
      _fail(
        '$context contains a non-string key',
        expected: 'string keys',
        actual: entry.key,
      );
    }
    result[entry.key as String] = entry.value;
  }
  return result;
}

List<dynamic> _array(Object? value, String context) {
  if (value is! List) {
    _fail(
      '$context must be a JSON array',
      expected: 'array',
      actual: value,
    );
  }
  return value;
}

Object? _field(Object? value, String name) {
  final object = _object(value, 'value containing `$name`');
  if (!object.containsKey(name)) {
    _fail(
      'missing ITF field `$name`',
      expected: name,
      actual: object.keys.toList()..sort(),
    );
  }
  return object[name];
}

String _string(Object? value, String context) {
  if (value is! String || value.isEmpty) {
    _fail(
      '$context must be a non-empty string',
      expected: 'non-empty string',
      actual: value,
    );
  }
  return value;
}

BigInt _taggedBigInt(Object? value) {
  final encoded = _field(value, '#bigint');
  if (encoded is! String || !RegExp(r'^(?:0|[1-9]\d*)$').hasMatch(encoded)) {
    _fail(
      'ITF #bigint must contain a canonical non-negative decimal string',
      expected: '0 or a positive decimal string',
      actual: encoded,
    );
  }
  return BigInt.parse(encoded);
}

final class _DecodedState {
  const _DecodedState({
    required this.raw,
    required this.action,
    required this.nondeterministicPicks,
  });

  final Map<String, dynamic> raw;
  final String action;
  final Map<String, dynamic> nondeterministicPicks;

  Map<String, dynamic> get state => _object(_field(raw, 's'), 'ITF state `s`');
}

_DecodedState _decodeState(Object? rawState) {
  final raw = _object(rawState, 'ITF state');
  final action = _string(_field(raw, _actionField), 'ITF action');
  final picks = _object(
    _field(raw, _nondeterministicPicksField),
    'ITF nondeterministic picks',
  );
  return _DecodedState(
    raw: raw,
    action: action,
    nondeterministicPicks: picks,
  );
}

BigInt _stateBigInt(_DecodedState state, String name) =>
    _taggedBigInt(_field(state.state, name));

bool _stateBool(_DecodedState state, String name) {
  final value = _field(state.state, name);
  if (value is! bool) {
    _fail(
      'ITF state field `$name` must be boolean',
      expected: 'boolean',
      actual: value,
    );
  }
  return value;
}

Set<String> _stateSet(_DecodedState state, String name) {
  final entries = _array(
    _field(_field(state.state, name), '#set'),
    'ITF state set `$name`',
  );
  return entries.map((entry) => _taggedBigInt(entry).toString()).toSet();
}

String _stateTag(_DecodedState state, String name) =>
    _string(_field(_field(state.state, name), 'tag'), 'ITF tag `$name`');

BigInt _pickedId(_DecodedState state) {
  final pick = _object(
    _field(state.nondeterministicPicks, 'id'),
    'nondeterministic id pick',
  );
  _ensure(
    _field(pick, 'tag') == 'Some',
    'action `${state.action}` requires a nondeterministic id',
    expected: 'Some',
    actual: _field(pick, 'tag'),
  );
  return _taggedBigInt(_field(pick, 'value'));
}

BigInt _requestMutationId(Map<String, dynamic>? request) {
  _ensure(
    request != null,
    'no in-flight request',
    expected: 'request',
    actual: null,
  );
  final mutations = _array(request!['mutations'], 'request mutations');
  _ensure(
    mutations.length == 1,
    'formal adapter sends exactly one mutation per request',
    expected: 1,
    actual: mutations.length,
  );
  final mutation = _object(mutations.single, 'request mutation');
  final id = mutation['mutationId'];
  if (id is! String || !RegExp(r'^[1-9]\d*$').hasMatch(id)) {
    _fail(
      'request mutation id is not a canonical positive decimal string',
      expected: 'positive decimal string',
      actual: id,
    );
  }
  return BigInt.parse(id);
}

List<String> _sortedIds(Iterable<String> values) {
  final result = values.toList();
  result.sort((left, right) => BigInt.parse(left).compareTo(BigInt.parse(right)));
  return result;
}

void _ensureIdSetsEqual(
  Set<String> actual,
  Set<String> expected,
  String context,
  String name,
) {
  final sortedActual = _sortedIds(actual);
  final sortedExpected = _sortedIds(expected);
  _ensure(
    _deepEqual(sortedActual, sortedExpected),
    '$context: $name differs from the model',
    expected: sortedExpected,
    actual: sortedActual,
  );
}

Set<String> _allocatedIds(BigInt nextId) {
  final result = <String>{};
  for (var id = BigInt.one; id < nextId; id += BigInt.one) {
    result.add(id.toString());
  }
  return result;
}

bool _deepEqual(Object? left, Object? right) {
  if (identical(left, right) || left == right) {
    return true;
  }
  if (left is List && right is List) {
    if (left.length != right.length) {
      return false;
    }
    for (var index = 0; index < left.length; index += 1) {
      if (!_deepEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }
  if (left is Map && right is Map) {
    if (left.length != right.length) {
      return false;
    }
    for (final key in left.keys) {
      if (!right.containsKey(key) || !_deepEqual(left[key], right[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

Map<String, dynamic> _jsonClone(Map<String, dynamic> value) =>
    _object(jsonDecode(jsonEncode(value)), 'cloned JSON object');
