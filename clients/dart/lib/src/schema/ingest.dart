/// Envelope validation + ingestion (Dart mirror of the shared contract).
///
/// The source of truth is `schema/opto-sync-envelope.schema.json`; this
/// validator and every optional provider must accept/reject exactly the shared
/// fixture corpus.
library;

import 'dart:convert';

import '../../opto_sync_client.dart';
import '../rx/write.dart';

const int maxSafeTimestampInteger = 9007199254740991;

final _identifier = RegExp(r'^[A-Za-z_][A-Za-z0-9_]{0,62}$');
final _digits = RegExp(r'^[0-9]{1,20}$');
final _decimal = RegExp(r'^(?:0|[1-9][0-9]*)$');
final _iso8601Hlc = RegExp(
  r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z(-[0-9A-Za-z._~-]+)*$',
);
final _nativeHlc = RegExp(r'^[0-9]{13}-[0-9a-f]{4}-[^-]{1,128}$');

class IngestValidationException implements Exception {
  IngestValidationException(this.issues);

  final List<String> issues;

  @override
  String toString() => 'IngestValidationException: ${issues.join('; ')}';
}

class IngestRecord {
  IngestRecord({
    required this.table,
    required this.recordId,
    required this.operation,
    required this.payload,
    this.baseRevision,
  });

  final String table;
  final String recordId;
  final String operation;
  final Map<String, dynamic> payload;
  final String? baseRevision;
}

class IngestEnvelope {
  IngestEnvelope({required this.records, this.source});

  final List<IngestRecord> records;
  final String? source;
}

typedef EnvelopeValidationCallback = Iterable<String> Function(Object? value);

/// Veto-only adapter for an additional validation library.
class EnvelopeValidationProvider {
  const EnvelopeValidationProvider(this.name, this._validate);

  factory EnvelopeValidationProvider.jsonSchema2(
    EnvelopeValidationCallback validate,
  ) => EnvelopeValidationProvider('json_schema2', validate);

  factory EnvelopeValidationProvider.validify(
    EnvelopeValidationCallback validate,
  ) => EnvelopeValidationProvider('validify', validate);

  factory EnvelopeValidationProvider.formz(
    EnvelopeValidationCallback validate,
  ) => EnvelopeValidationProvider('formz', validate);

  final String name;
  final EnvelopeValidationCallback _validate;

  List<String> validate(Object? value) {
    try {
      return _validate(
        value,
      ).map((message) => 'provider[$name]: $message').toList(growable: false);
    } catch (error) {
      return ['provider[$name]: provider threw: $error'];
    }
  }
}

class ProviderAuditResult {
  const ProviderAuditResult({
    required this.provider,
    required this.canonicalAccepted,
    required this.providerAccepted,
    required this.providerIssues,
  });

  final String provider;
  final bool canonicalAccepted;
  final bool providerAccepted;
  final List<String> providerIssues;

  bool get drift => canonicalAccepted != providerAccepted;
}

int _codePointLength(String value) => value.runes.length;

bool _isTimestamp(Object? value) {
  if (value is num) {
    return value.isFinite &&
        value >= 0 &&
        value <= maxSafeTimestampInteger &&
        value == value.truncateToDouble();
  }
  if (value is String) {
    return _digits.hasMatch(value) ||
        _nativeHlc.hasMatch(value) ||
        _iso8601Hlc.hasMatch(value);
  }
  return false;
}

List<String> _providerIssues(
  EnvelopeValidationProvider provider,
  Object? value,
) {
  try {
    return provider.validate(value).toList(growable: false);
  } catch (error) {
    return ['provider[${provider.name}]: provider threw: $error'];
  }
}

Object? _decodeInput(Object? input) {
  if (input is! String) return input;
  try {
    return jsonDecode(input);
  } on FormatException catch (error) {
    throw IngestValidationException(['<root>: invalid JSON: ${error.message}']);
  }
}

/// Validates a decoded JSON envelope (or a JSON string).
IngestEnvelope parseEnvelope(
  Object? input, {
  Iterable<EnvelopeValidationProvider> validationProviders = const [],
}) {
  final decoded = _decodeInput(input);
  final issues = <String>[];

  if (decoded is! Map<String, dynamic>) {
    throw IngestValidationException(['<root>: envelope must be an object']);
  }

  for (final provider in validationProviders) {
    issues.addAll(_providerIssues(provider, decoded));
  }

  const allowedTop = {'formatVersion', 'source', 'records'};
  for (final key in decoded.keys) {
    if (!allowedTop.contains(key)) issues.add('<root>.$key: unknown property');
  }

  if (decoded['formatVersion'] != 1) {
    issues.add('<root>.formatVersion: must be 1');
  }

  String? parsedSource;
  if (decoded.containsKey('source')) {
    final source = decoded['source'];
    if (source is String && _codePointLength(source) <= 200) {
      parsedSource = source;
    } else {
      issues.add('<root>.source: must be a string of at most 200 characters');
    }
  }

  final rawRecords = decoded['records'];
  final records = <IngestRecord>[];
  if (rawRecords is! List) {
    issues.add('<root>.records: must be an array');
  } else if (rawRecords.isEmpty) {
    issues.add('<root>.records: must be a non-empty array');
  } else {
    const allowed = {
      'table',
      'recordId',
      'operation',
      'baseRevision',
      'payload',
    };
    for (var index = 0; index < rawRecords.length; index++) {
      final raw = rawRecords[index];
      final path = 'records.$index';
      final recordIssues = <String>[];
      if (raw is! Map<String, dynamic>) {
        issues.add('$path: must be an object');
        continue;
      }

      for (final key in raw.keys) {
        if (!allowed.contains(key)) {
          recordIssues.add('$path.$key: unknown property');
        }
      }

      final table = raw['table'];
      if (table is! String || !_identifier.hasMatch(table)) {
        recordIssues.add('$path.table: must be a SQL-safe identifier');
      }

      final recordId = raw['recordId'];
      if (recordId is! String ||
          _codePointLength(recordId) < 1 ||
          _codePointLength(recordId) > 512) {
        recordIssues.add(
          '$path.recordId: must be a string of 1..512 characters',
        );
      }

      Object? operation = 'upsert';
      if (raw.containsKey('operation')) operation = raw['operation'];
      if (operation != 'upsert' && operation != 'delete') {
        recordIssues.add('$path.operation: must be upsert or delete');
      }

      Object? baseRevision;
      if (raw.containsKey('baseRevision')) {
        baseRevision = raw['baseRevision'];
        if (baseRevision is! String || !_decimal.hasMatch(baseRevision)) {
          recordIssues.add(
            '$path.baseRevision: must be a canonical decimal string',
          );
        }
      }

      final payload = raw['payload'];
      if (payload is! Map<String, dynamic>) {
        recordIssues.add('$path.payload: must be an object');
      } else if (operation == 'delete') {
        if (payload.isNotEmpty) {
          recordIssues.add(
            '$path.payload: a delete record must carry an empty payload',
          );
        }
      } else {
        if (!payload.containsKey('updatedAt') ||
            !_isTimestamp(payload['updatedAt'])) {
          recordIssues.add(
            '$path.payload.updatedAt: invalid or missing timestamp',
          );
        }
        for (final key in const ['createdAt', 'syncedAt']) {
          if (payload.containsKey(key) && !_isTimestamp(payload[key])) {
            recordIssues.add('$path.payload.$key: invalid timestamp');
          }
        }
      }

      if (recordIssues.isEmpty) {
        records.add(
          IngestRecord(
            table: table as String,
            recordId: recordId as String,
            operation: operation as String,
            payload: payload as Map<String, dynamic>,
            baseRevision: baseRevision as String?,
          ),
        );
      } else {
        issues.addAll(recordIssues);
      }
    }
  }

  if (issues.isNotEmpty) throw IngestValidationException(issues);
  return IngestEnvelope(records: records, source: parsedSource);
}

ProviderAuditResult auditEnvelopeProvider(
  Object? input,
  EnvelopeValidationProvider provider,
) {
  final decoded = _decodeInput(input);
  var canonicalAccepted = true;
  try {
    parseEnvelope(decoded);
  } on IngestValidationException {
    canonicalAccepted = false;
  }
  final providerIssues = _providerIssues(provider, decoded);
  return ProviderAuditResult(
    provider: provider.name,
    canonicalAccepted: canonicalAccepted,
    providerAccepted: providerIssues.isEmpty,
    providerIssues: providerIssues,
  );
}

/// Validates and queues every record through the standard optimism-level write
/// path. Nothing queues if the envelope or any provider rejects it.
Future<List<WriteReceipt>> ingestEnvelope(
  OptoSyncClient client,
  Object? input, {
  Optimism optimism = Optimism.localFirst,
  SyncKicker? loop,
  Iterable<EnvelopeValidationProvider> validationProviders = const [],
}) async {
  final envelope = parseEnvelope(
    input,
    validationProviders: validationProviders,
  );
  final receipts = <WriteReceipt>[];
  for (final record in envelope.records) {
    if (record.operation == 'delete') {
      receipts.add(
        await writeDelete(
          client,
          record.table,
          record.recordId,
          optimism: optimism,
          loop: loop,
          baseRevision: record.baseRevision,
        ),
      );
    } else {
      receipts.add(
        await write(
          client,
          record.table,
          record.recordId,
          record.payload,
          optimism: optimism,
          loop: loop,
          baseRevision: record.baseRevision,
        ),
      );
    }
  }
  return receipts;
}
