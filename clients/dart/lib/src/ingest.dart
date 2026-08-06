import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import '../opto_sync_client.dart'
    show
        OptoSyncClient,
        QueueBatchDelete,
        QueueBatchMutation,
        QueueBatchUpsert;
import 'reactive_sync.dart';

const String syncIngestFormat = 'opto-sync.ingest.v1';
const String syncIngestSchemaId =
    'https://opto-sync.dev/schemas/opto-sync-ingest.v1.schema.json';
const int defaultMaxIngestBytes = 16 * 1024 * 1024;

final RegExp _scopeId = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]*$');
final RegExp _canonicalDecimal = RegExp(r'^(0|[1-9][0-9]*)$');
final RegExp _hlc = RegExp(
  r'^[0-9]{13}-[0-9a-f]{4}-[A-Za-z0-9._:]+$',
);
final RegExp _rfc3339 = RegExp(
  r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
  r'[0-9]{2}:[0-9]{2}:[0-9]{2}'
  r'(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$',
);

final class SyncIngestValidationException implements Exception {
  final String path;
  final String message;

  const SyncIngestValidationException(this.path, this.message);

  @override
  String toString() =>
      'SyncIngestValidationException($path): $message';
}

sealed class SyncIngestMutation {
  final String table;
  final String recordId;
  final String? baseRevision;

  const SyncIngestMutation({
    required this.table,
    required this.recordId,
    this.baseRevision,
  });
}

final class SyncIngestUpsert extends SyncIngestMutation {
  final Map<String, dynamic> record;
  final bool resurrect;

  const SyncIngestUpsert({
    required super.table,
    required super.recordId,
    required this.record,
    super.baseRevision,
    this.resurrect = false,
  });
}

final class SyncIngestDelete extends SyncIngestMutation {
  final String deletedAt;

  const SyncIngestDelete({
    required super.table,
    required super.recordId,
    required this.deletedAt,
    super.baseRevision,
  });
}

final class SyncIngestDocument {
  final String format;
  final String batchId;
  final String createdAt;
  final List<SyncIngestMutation> mutations;

  const SyncIngestDocument({
    required this.format,
    required this.batchId,
    required this.createdAt,
    required this.mutations,
  });
}

Never _invalid(String path, String message) =>
    throw SyncIngestValidationException(path, message);

bool _isSyncTimestamp(Object? value) {
  if (value is! String) return false;
  if (_hlc.hasMatch(value) || _canonicalDecimal.hasMatch(value)) return true;
  return _rfc3339.hasMatch(value) && DateTime.tryParse(value) != null;
}

void _requireExactKeys(
  Map<String, dynamic> value,
  Set<String> required,
  Set<String> allowed,
  String path,
) {
  for (final key in required) {
    if (!value.containsKey(key)) _invalid(path, 'missing required key $key');
  }
  for (final key in value.keys) {
    if (!allowed.contains(key)) _invalid(path, 'unknown key $key');
  }
}

String _requireScopeId(Object? value, String path) {
  if (value is! String ||
      value.isEmpty ||
      value.length > 128 ||
      !_scopeId.hasMatch(value)) {
    _invalid(path, 'must be a valid 1-128 character scope id');
  }
  return value;
}

String _requireRecordId(Object? value, String path) {
  if (value is! String || value.isEmpty || value.length > 512) {
    _invalid(path, 'must be a non-empty string of at most 512 characters');
  }
  return value;
}

String? _optionalRevision(Object? value, String path) {
  if (value == null) return null;
  if (value is! String || !_canonicalDecimal.hasMatch(value)) {
    _invalid(path, 'must be a canonical unsigned decimal string');
  }
  return value;
}

Map<String, dynamic> _requireRecord(Object? value, String path) {
  if (value is! Map<String, dynamic>) {
    _invalid(path, 'must be a JSON object');
  }
  if (!_isSyncTimestamp(value['updatedAt'])) {
    _invalid('$path.updatedAt', 'must be a sync timestamp string');
  }
  for (final key in ['createdAt', 'syncedAt']) {
    if (value.containsKey(key) && !_isSyncTimestamp(value[key])) {
      _invalid('$path.$key', 'must be a sync timestamp string');
    }
  }
  return value;
}

SyncIngestMutation _parseMutation(
  Object? value,
  int index,
) {
  final path = r'$.mutations[' '$index]';
  if (value is! Map<String, dynamic>) {
    _invalid(path, 'must be a JSON object');
  }
  final operation = value['operation'];
  final table = _requireScopeId(value['table'], '$path.table');
  final recordId = _requireRecordId(value['recordId'], '$path.recordId');
  final baseRevision = _optionalRevision(
    value['baseRevision'],
    '$path.baseRevision',
  );
  if (operation == 'upsert') {
    _requireExactKeys(
      value,
      {'operation', 'table', 'recordId', 'record'},
      {
        'operation',
        'table',
        'recordId',
        'record',
        'baseRevision',
        'resurrect',
      },
      path,
    );
    final resurrect = value['resurrect'];
    if (resurrect != null && resurrect is! bool) {
      _invalid('$path.resurrect', 'must be a boolean');
    }
    return SyncIngestUpsert(
      table: table,
      recordId: recordId,
      record: _requireRecord(value['record'], '$path.record'),
      baseRevision: baseRevision,
      resurrect: resurrect as bool? ?? false,
    );
  }
  if (operation == 'delete') {
    _requireExactKeys(
      value,
      {'operation', 'table', 'recordId', 'deletedAt'},
      {'operation', 'table', 'recordId', 'deletedAt', 'baseRevision'},
      path,
    );
    final deletedAt = value['deletedAt'];
    if (!_isSyncTimestamp(deletedAt)) {
      _invalid('$path.deletedAt', 'must be a sync timestamp string');
    }
    return SyncIngestDelete(
      table: table,
      recordId: recordId,
      deletedAt: deletedAt as String,
      baseRevision: baseRevision,
    );
  }
  _invalid('$path.operation', 'must be upsert or delete');
}

Object? _decodeInput(Object? input, int maxBytes) {
  String encoded;
  if (input is String) {
    encoded = input;
  } else if (input is ByteBuffer) {
    encoded = utf8.decode(input.asUint8List(), allowMalformed: false);
  } else if (input is List<int>) {
    encoded = utf8.decode(input, allowMalformed: false);
  } else {
    try {
      encoded = jsonEncode(input);
    } on Object {
      _invalid(r'$', 'must contain only JSON values');
    }
  }
  final bytes = utf8.encode(encoded).length;
  if (bytes > maxBytes) {
    _invalid(r'$', 'document is $bytes bytes; limit is $maxBytes');
  }
  try {
    return jsonDecode(encoded);
  } on FormatException {
    _invalid(r'$', 'is not valid JSON');
  }
}

/// Parse and validate an object, JSON string, file bytes, or browser blob bytes
/// against `schemas/opto-sync-ingest.v1.schema.json`.
Future<SyncIngestDocument> parseSyncIngestDocument(
  Object? input, {
  int maxBytes = defaultMaxIngestBytes,
}) async {
  if (maxBytes < 1) {
    throw RangeError.range(maxBytes, 1, null, 'maxBytes');
  }
  final decoded = _decodeInput(input, maxBytes);
  if (decoded is! Map<String, dynamic>) {
    _invalid(r'$', 'must be a JSON object');
  }
  _requireExactKeys(
    decoded,
    {'format', 'batchId', 'createdAt', 'mutations'},
    {'format', 'batchId', 'createdAt', 'mutations'},
    r'$',
  );
  if (decoded['format'] != syncIngestFormat) {
    _invalid(r'$.format', 'must equal $syncIngestFormat');
  }
  final batchId = _requireScopeId(decoded['batchId'], r'$.batchId');
  final createdAt = decoded['createdAt'];
  if (!_isSyncTimestamp(createdAt)) {
    _invalid(r'$.createdAt', 'must be a sync timestamp string');
  }
  final mutations = decoded['mutations'];
  if (mutations is! List ||
      mutations.isEmpty ||
      mutations.length > 10000) {
    _invalid(r'$.mutations', 'must contain 1-10000 mutations');
  }
  return SyncIngestDocument(
    format: syncIngestFormat,
    batchId: batchId,
    createdAt: createdAt as String,
    mutations: [
      for (var index = 0; index < mutations.length; index++)
        _parseMutation(mutations[index], index),
    ],
  );
}

QueueBatchMutation _toQueueMutation(SyncIngestMutation mutation) {
  if (mutation is SyncIngestDelete) {
    return QueueBatchDelete(
      tableName: mutation.table,
      recordId: mutation.recordId,
      baseRevision: mutation.baseRevision,
    );
  }
  final upsert = mutation as SyncIngestUpsert;
  return QueueBatchUpsert(
    tableName: upsert.table,
    recordId: upsert.recordId,
    payload: upsert.record,
    baseRevision: upsert.baseRevision,
    resurrect: upsert.resurrect,
  );
}

final class IngestSyncDocumentResult {
  final SyncIngestDocument document;
  final ReactiveWriteResult<Object?, List<int>> write;

  const IngestSyncDocumentResult({
    required this.document,
    required this.write,
  });
}

/// Validate the complete document, then apply one explicit optimism strategy.
Future<IngestSyncDocumentResult> ingestSyncDocument({
  required Object? input,
  required OptoSyncClient client,
  OptimismLevel optimism = OptimismLevel.durableLocal,
  int maxBytes = defaultMaxIngestBytes,
  Future<Object?> Function(SyncIngestDocument document)? remoteIngest,
  Future<void> Function(Object? result)? installRemote,
  FutureOr<void> Function()? requestBackgroundSync,
  Future<void> Function()? syncNow,
}) async {
  final document = await parseSyncIngestDocument(
    input,
    maxBytes: maxBytes,
  );
  final write = await executeReactiveWrite<Object?, List<int>>(
    optimism: optimism,
    remoteWrite: () {
      if (remoteIngest == null) {
        throw ArgumentError('server-confirmed ingest requires remoteIngest');
      }
      return remoteIngest(document);
    },
    queueLocal: () =>
        client.queueBatch(document.mutations.map(_toQueueMutation).toList()),
    installRemote: installRemote,
    requestBackgroundSync: requestBackgroundSync,
    syncNow: syncNow,
  );
  return IngestSyncDocumentResult(document: document, write: write);
}
