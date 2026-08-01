/// Envelope validation + ingestion (Dart mirror of the shared contract).
///
/// The source of truth is `opto-sync-clients/schema/opto-sync-envelope.schema.json`;
/// this validator MUST accept/reject exactly the shared fixture corpus in
/// `schema/fixtures/` (enforced by test/schema_ingest_test.dart), keeping it
/// in lockstep with the TS (zod), Rust, and Gleam validators.
library;

import 'dart:convert';

import '../../opto_sync_client.dart';
import '../rx/write.dart';

final _identifier = RegExp(r'^[A-Za-z_][A-Za-z0-9_]{0,62}$');
final _digits = RegExp(r'^[0-9]{1,20}$');
final _decimal = RegExp(r'^(?:0|[1-9][0-9]*)$');
final _iso8601Hlc = RegExp(
  r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z(-[0-9A-Za-z._~-]+)*$',
);

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
  final String operation; // 'upsert' | 'delete'
  final Map<String, dynamic> payload;
  final String? baseRevision;
}

class IngestEnvelope {
  IngestEnvelope({required this.records, this.source});

  final List<IngestRecord> records;
  final String? source;
}

bool _isTimestamp(Object? value) {
  if (value is int) return value >= 0;
  if (value is String) {
    return _digits.hasMatch(value) || _iso8601Hlc.hasMatch(value);
  }
  return false;
}

/// Validates a decoded JSON envelope (or a JSON string).
IngestEnvelope parseEnvelope(Object? input) {
  final Object? decoded = input is String ? jsonDecode(input) : input;
  final issues = <String>[];

  if (decoded is! Map<String, dynamic>) {
    throw IngestValidationException(['<root>: envelope must be an object']);
  }
  final allowedTop = {'formatVersion', 'source', 'records'};
  for (final key in decoded.keys) {
    if (!allowedTop.contains(key)) issues.add('$key: unknown property');
  }
  if (decoded['formatVersion'] != 1) {
    issues.add('formatVersion: must be 1');
  }
  final source = decoded['source'];
  if (source != null && (source is! String || source.length > 200)) {
    issues.add('source: must be a string of at most 200 characters');
  }

  final rawRecords = decoded['records'];
  final records = <IngestRecord>[];
  if (rawRecords is! List || rawRecords.isEmpty) {
    issues.add('records: must be a non-empty array');
  } else {
    final allowed = {
      'table',
      'recordId',
      'operation',
      'baseRevision',
      'payload',
    };
    for (var i = 0; i < rawRecords.length; i++) {
      final raw = rawRecords[i];
      final where = 'records.$i';
      if (raw is! Map<String, dynamic>) {
        issues.add('$where: must be an object');
        continue;
      }
      for (final key in raw.keys) {
        if (!allowed.contains(key)) issues.add('$where.$key: unknown property');
      }
      final table = raw['table'];
      if (table is! String || !_identifier.hasMatch(table)) {
        issues.add('$where.table: must be a SQL-safe identifier');
      }
      final recordId = raw['recordId'];
      if (recordId is! String || recordId.isEmpty || recordId.length > 512) {
        issues.add('$where.recordId: must be a string of 1..512 characters');
      }
      final operation = raw['operation'] ?? 'upsert';
      if (operation != 'upsert' && operation != 'delete') {
        issues.add('$where.operation: must be upsert or delete');
      }
      final baseRevision = raw['baseRevision'];
      if (baseRevision != null &&
          (baseRevision is! String || !_decimal.hasMatch(baseRevision))) {
        issues.add('$where.baseRevision: must be a canonical decimal string');
      }
      final payload = raw['payload'];
      if (payload is! Map<String, dynamic>) {
        issues.add('$where.payload: must be an object');
        continue;
      }
      if (operation == 'delete') {
        if (payload.isNotEmpty) {
          issues.add('$where.payload: a delete record must carry an empty payload');
        }
      } else {
        if (!_isTimestamp(payload['updatedAt'])) {
          issues.add('$where.payload.updatedAt: required timestamp '
              '(epoch int, digit string, or fixed-width ISO-8601 UTC/HLC)');
        }
        for (final key in const ['createdAt', 'syncedAt']) {
          final value = payload[key];
          if (value != null && !_isTimestamp(value)) {
            issues.add('$where.payload.$key: invalid timestamp');
          }
        }
      }
      if (issues.isEmpty) {
        records.add(
          IngestRecord(
            table: table as String,
            recordId: recordId as String,
            operation: operation as String,
            payload: payload,
            baseRevision: baseRevision as String?,
          ),
        );
      }
    }
  }

  if (issues.isNotEmpty) throw IngestValidationException(issues);
  return IngestEnvelope(records: records, source: source as String?);
}

/// Validates and queues every record of an envelope through the standard
/// optimism-level write path (nothing queues if any record is invalid).
Future<List<WriteReceipt>> ingestEnvelope(
  OptoSyncClient client,
  Object? input, {
  Optimism optimism = Optimism.localFirst,
  SyncKicker? loop,
}) async {
  final envelope = parseEnvelope(input);
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
