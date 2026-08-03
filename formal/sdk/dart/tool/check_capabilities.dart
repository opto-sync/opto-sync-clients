import 'dart:convert';
import 'dart:io';

import 'package:fm_adapter_stream/fm_adapter_capabilities.dart';

void main() {
  final Map<String, dynamic> fixture =
      jsonDecode(
            File(
              '../../protocol-fixtures/stream/capabilities.v1.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  final List<String> registry = (fixture['registry'] as List<dynamic>)
      .cast<String>();
  final List<String> required = (fixture['required'] as List<dynamic>)
      .cast<String>();

  _expect(streamAdapterProtocol == fixture['protocol'], 'protocol drift');
  _expect(
    streamAdapterProtocolVersion == fixture['protocolVersion'],
    'protocolVersion drift',
  );
  _expect(fixture['wireRule'] == 'strict-subsequence', 'wireRule drift');
  _expectJson(capabilityRegistryV1(), registry, 'registry drift');
  _expectJson(requiredCapabilitiesV1(), required, 'required-set drift');

  final List<String> mutableRegistry = capabilityRegistryV1();
  mutableRegistry[0] = 'tampered';
  _expectJson(
    capabilityRegistryV1(),
    registry,
    'registry accessor leaked mutable storage',
  );
  final List<String> mutableRequired = requiredCapabilitiesV1();
  mutableRequired[0] = 'tampered';
  _expectJson(
    requiredCapabilitiesV1(),
    required,
    'required accessor leaked mutable storage',
  );

  final List<List<String>> expected = _expectedSequences(registry, required);
  final List<List<String>> actual = allCanonicalCapabilitySequencesV1();
  _expect(expected.length == 16, 'expected 16 canonical arrays');
  _expect(
    expected.map(jsonEncode).toSet().length == 16,
    'canonical arrays must be unique',
  );
  _expectJson(actual, expected, 'enumerated capability arrays drift');

  for (final List<String> sequence in expected) {
    final List<String> unordered = sequence.reversed.toList();
    _expectJson(
      canonicalizeCapabilitySetV1(unordered),
      sequence,
      'producer canonicalization drift for ${jsonEncode(sequence)}',
    );
    _expectJson(
      validateCapabilitySequenceV1(sequence),
      sequence,
      'wire validation drift for ${jsonEncode(sequence)}',
    );
    _expect(
      capabilityArrayJsonV1(sequence) == jsonEncode(sequence),
      'canonical bytes drift for ${jsonEncode(sequence)}',
    );
  }

  _expectFormatException(
    () => canonicalizeCapabilitySetV1(<String>[
      'reset',
      'apply',
      'observe',
      'observe',
      'close',
    ]),
    'duplicate',
  );
  _expectFormatException(
    () => canonicalizeCapabilitySetV1(<String>['reset', 'observe', 'close']),
    'missing required',
  );
  _expectFormatException(
    () => canonicalizeCapabilitySetV1(<String>[
      'reset',
      'apply',
      'observe',
      'hello',
      'close',
    ]),
    'invalid capability',
  );
  _expectFormatException(
    () => canonicalizeCapabilitySetV1(<String>[
      'reset',
      'apply',
      'observe',
      'teleport',
      'close',
    ]),
    'invalid capability',
  );
  _expectFormatException(
    () => validateCapabilitySequenceV1(<String>[
      'reset',
      'apply',
      'observe',
      'snapshot',
      'settle',
      'close',
    ]),
    'canonical v1 order',
  );

  stdout.writeln(
    'Dart capability registry agrees with all 16 canonical arrays',
  );
}

List<List<String>> _expectedSequences(
  List<String> registry,
  List<String> required,
) {
  final Set<String> requiredSet = required.toSet();
  final List<String> optional = <String>[
    for (final String capability in registry)
      if (!requiredSet.contains(capability)) capability,
  ];
  final List<List<String>> result = <List<String>>[];
  for (int mask = 0; mask < (1 << optional.length); mask += 1) {
    final Set<String> selected = required.toSet();
    for (int index = 0; index < optional.length; index += 1) {
      if ((mask & (1 << index)) != 0) selected.add(optional[index]);
    }
    result.add(<String>[
      for (final String capability in registry)
        if (selected.contains(capability)) capability,
    ]);
  }
  return result;
}

void _expect(bool condition, String message) {
  if (!condition) throw StateError(message);
}

void _expectJson(Object? actual, Object? expected, String message) {
  if (jsonEncode(actual) != jsonEncode(expected)) {
    throw StateError(
      '$message: got ${jsonEncode(actual)}, expected ${jsonEncode(expected)}',
    );
  }
}

void _expectFormatException(void Function() callback, String fragment) {
  try {
    callback();
  } on FormatException catch (error) {
    _expect(
      error.toString().contains(fragment),
      'expected FormatException containing "$fragment", got $error',
    );
    return;
  }
  throw StateError('expected FormatException containing "$fragment"');
}
