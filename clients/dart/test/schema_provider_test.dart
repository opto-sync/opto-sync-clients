import 'dart:io';

import 'package:opto_sync_client/schema.dart' as schema;
import 'package:test/test.dart';

class ThrowingProvider extends schema.EnvelopeValidationProvider {
  ThrowingProvider() : super('throwing-provider', (_) => const []);

  @override
  List<String> validate(Object? value) => throw StateError('boom');
}

Directory locateFixtures() {
  var dir = Directory.current.absolute;
  for (var i = 0; i < 10; i++) {
    final candidate = Directory(
      '${dir.path}${Platform.pathSeparator}schema${Platform.pathSeparator}fixtures',
    );
    if (candidate.existsSync()) return candidate;
    final parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  throw StateError('could not locate schema fixtures');
}

void main() {
  final fixtures = locateFixtures();

  String fixture(String kind, String name) => File(
    '${fixtures.path}${Platform.pathSeparator}$kind${Platform.pathSeparator}$name',
  ).readAsStringSync();

  test('normalizes malformed JSON', () {
    expect(
      () => schema.parseEnvelope('{ not json'),
      throwsA(isA<schema.IngestValidationException>()),
    );
  });

  test('counts Unicode code points and accepts the safe integer boundary', () {
    final envelope = schema.parseEnvelope(
      fixture('valid', 'safe-integer-unicode-boundaries.json'),
    );
    expect(envelope.source!.runes.length, 200);
    expect(envelope.records.single.recordId.runes.length, 512);
  });

  test('accepts mathematically integral JSON number timestamps', () {
    final envelope = schema.parseEnvelope(
      fixture('valid', 'integral-number-timestamps.json'),
    );
    expect(envelope.records.single.payload['updatedAt'], 1.0);
    expect(envelope.records.single.payload['createdAt'], 1000.0);
  });

  test('rejects null optionals and unsafe integers', () {
    for (final name in const [
      'null-source.json',
      'null-operation.json',
      'null-base-revision.json',
      'null-optional-timestamp.json',
      'unsafe-integer-timestamp.json',
    ]) {
      expect(
        () => schema.parseEnvelope(fixture('invalid', name)),
        throwsA(isA<schema.IngestValidationException>()),
        reason: name,
      );
    }
  });

  test('json_schema2 and validify providers are veto-only gates', () {
    final providers = [
      schema.EnvelopeValidationProvider.jsonSchema2((_) => ['blocked']),
      schema.EnvelopeValidationProvider.validify((_) => ['also blocked']),
    ];
    expect(
      () => schema.parseEnvelope(
        fixture('valid', 'optional-fields-omitted.json'),
        validationProviders: providers,
      ),
      throwsA(
        isA<schema.IngestValidationException>().having(
          (error) => error.issues,
          'provider issues',
          predicate<List<String>>(
            (issues) =>
                issues.any((entry) => entry.contains('provider[json_schema2]')),
            'contains a json_schema2 provider issue',
          ),
        ),
      ),
    );
  });

  test('provider audit detects acceptance drift', () {
    final provider = schema.EnvelopeValidationProvider.formz((_) => const []);
    final result = schema.auditEnvelopeProvider(
      fixture('invalid', 'null-operation.json'),
      provider,
    );
    expect(result.drift, isTrue);
    expect(result.canonicalAccepted, isFalse);
    expect(result.providerAccepted, isTrue);
  });

  test('overridden provider failures are normalized', () {
    final provider = ThrowingProvider();
    expect(
      () => schema.parseEnvelope(
        fixture('valid', 'optional-fields-omitted.json'),
        validationProviders: [provider],
      ),
      throwsA(
        isA<schema.IngestValidationException>().having(
          (error) => error.issues.join('; '),
          'provider failure',
          contains('provider[throwing-provider]: provider threw:'),
        ),
      ),
    );
    final audit = schema.auditEnvelopeProvider(
      fixture('valid', 'optional-fields-omitted.json'),
      provider,
    );
    expect(audit.providerAccepted, isFalse);
    expect(audit.drift, isTrue);
  });
}
