import 'dart:convert';

const String streamAdapterProtocol = 'fm.adapter.stream.v1';
const int streamAdapterProtocolVersion = 1;

const List<String> _capabilityRegistryV1 = <String>[
  'reset',
  'apply',
  'observe',
  'settle',
  'snapshot',
  'restore',
  'fault',
  'close',
];

const List<String> _requiredCapabilitiesV1 = <String>[
  'reset',
  'apply',
  'observe',
  'close',
];

/// Returns a defensive copy of the canonical V1 wire registry.
List<String> capabilityRegistryV1() =>
    List<String>.of(_capabilityRegistryV1);

/// Returns a defensive copy of the mandatory V1 capability set.
List<String> requiredCapabilitiesV1() =>
    List<String>.of(_requiredCapabilitiesV1);

/// Validates an unordered producer set and returns the canonical wire order.
List<String> canonicalizeCapabilitySetV1(Iterable<String> values) {
  final Set<String> seen = <String>{};
  for (final String capability in values) {
    if (capability == 'hello' ||
        !_capabilityRegistryV1.contains(capability)) {
      throw FormatException(
        'hello advertised invalid capability ${jsonEncode(capability)}',
      );
    }
    if (!seen.add(capability)) {
      throw FormatException(
        'hello capabilities contain duplicate ${jsonEncode(capability)}',
      );
    }
  }

  for (final String required in _requiredCapabilitiesV1) {
    if (!seen.contains(required)) {
      throw FormatException(
        'hello result is missing required capability $required',
      );
    }
  }

  return <String>[
    for (final String capability in _capabilityRegistryV1)
      if (seen.contains(capability)) capability,
  ];
}

/// Validates an incoming wire sequence without silently reordering it.
List<String> validateCapabilitySequenceV1(Iterable<String> values) {
  final List<String> input = List<String>.of(values);
  final List<String> canonical = canonicalizeCapabilitySetV1(input);
  if (!_listEquals(input, canonical)) {
    throw FormatException(
      'hello capabilities are not in canonical v1 order: '
      'got ${jsonEncode(input)}; expected ${jsonEncode(canonical)}',
    );
  }
  return List<String>.of(canonical);
}

/// Encodes a validated capability array to exact compact JSON.
String capabilityArrayJsonV1(Iterable<String> values) =>
    jsonEncode(validateCapabilitySequenceV1(values));

/// Enumerates all 16 valid arrays in deterministic optional-bit order.
List<List<String>> allCanonicalCapabilitySequencesV1() {
  final Set<String> required = _requiredCapabilitiesV1.toSet();
  final List<String> optional = <String>[
    for (final String capability in _capabilityRegistryV1)
      if (!required.contains(capability)) capability,
  ];
  final List<List<String>> sequences = <List<String>>[];
  final int combinations = 1 << optional.length;

  for (int mask = 0; mask < combinations; mask += 1) {
    final Set<String> selected = _requiredCapabilitiesV1.toSet();
    for (int index = 0; index < optional.length; index += 1) {
      if ((mask & (1 << index)) != 0) {
        selected.add(optional[index]);
      }
    }
    sequences.add(<String>[
      for (final String capability in _capabilityRegistryV1)
        if (selected.contains(capability)) capability,
    ]);
  }

  return sequences;
}

bool _listEquals(List<String> left, List<String> right) {
  if (left.length != right.length) return false;
  for (int index = 0; index < left.length; index += 1) {
    if (left[index] != right[index]) return false;
  }
  return true;
}
