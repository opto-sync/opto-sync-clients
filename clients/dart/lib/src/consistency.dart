/// Wire-neutral consistency policy identifiers, frozen mutation intent, and
/// deterministic local-plus-remote read reconciliation.
library;

import 'dart:convert';

const String consistencyPolicyRemoteAcknowledged =
    'opto.consistency.remote-acknowledged.v1';
const String consistencyPolicyWriteThroughLocalFirst =
    'opto.consistency.write-through-local-first.v1';
const String consistencyPolicyQueuedLocalFirst =
    'opto.consistency.queued-local-first.v1';

const Set<String> consistencyPolicyIds = {
  consistencyPolicyRemoteAcknowledged,
  consistencyPolicyWriteThroughLocalFirst,
  consistencyPolicyQueuedLocalFirst,
};

const Map<String, String> consistencyPolicyAliases = {
  'opto.consistency.remote-acknowledged.v1':
      consistencyPolicyRemoteAcknowledged,
  'remote-acknowledged': consistencyPolicyRemoteAcknowledged,
  'strict': consistencyPolicyRemoteAcknowledged,
  'remote-confirmed': consistencyPolicyRemoteAcknowledged,
  'await-server': consistencyPolicyRemoteAcknowledged,
  'opto.consistency.write-through-local-first.v1':
      consistencyPolicyWriteThroughLocalFirst,
  'write-through-local-first': consistencyPolicyWriteThroughLocalFirst,
  'local-then-remote': consistencyPolicyWriteThroughLocalFirst,
  'local-first': consistencyPolicyWriteThroughLocalFirst,
  'opto.consistency.queued-local-first.v1': consistencyPolicyQueuedLocalFirst,
  'queued-local-first': consistencyPolicyQueuedLocalFirst,
  'local-durable': consistencyPolicyQueuedLocalFirst,
  'background': consistencyPolicyQueuedLocalFirst,
};

const String metaIntentPolicyPrefix = 'intent.policy.';

String intentPolicyMetaKey(String mutationId) =>
    '$metaIntentPolicyPrefix$mutationId';

class UnknownConsistencyPolicyException implements Exception {
  const UnknownConsistencyPolicyException(this.identifier);
  final String identifier;

  @override
  String toString() =>
      'UnknownConsistencyPolicyException: ${jsonEncode(identifier)}';
}

class FrozenMutationIntentException implements Exception {
  const FrozenMutationIntentException([
    this.message = 'queued mutation intent is immutable',
  ]);
  final String message;

  @override
  String toString() => 'FrozenMutationIntentException: $message';
}

class MutationIntent {
  const MutationIntent({
    required this.clientId,
    required this.mutationId,
    required this.table,
    required this.recordId,
    required this.operation,
    required this.consistencyPolicy,
    this.payload,
    this.baseRevision,
    this.resurrect = false,
  });

  factory MutationIntent.fromJson(Map<String, dynamic> json) {
    return MutationIntent(
      clientId: json['clientId'] as String,
      mutationId: json['mutationId'] as String,
      table: json['table'] as String,
      recordId: json['recordId'] as String,
      operation: json['operation'] as String,
      consistencyPolicy: json['consistencyPolicy'] as String,
      payload: json['payload'] is Map
          ? Map<String, dynamic>.from(json['payload'] as Map)
          : null,
      baseRevision: json['baseRevision'] as String?,
      resurrect: json['resurrect'] as bool? ?? false,
    );
  }

  final String clientId;
  final String mutationId;
  final String table;
  final String recordId;
  final String operation;
  final Map<String, dynamic>? payload;
  final String? baseRevision;
  final bool resurrect;
  final String consistencyPolicy;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'clientId': clientId,
    'mutationId': mutationId,
    'table': table,
    'recordId': recordId,
    'operation': operation,
    if (payload != null) 'payload': payload,
    if (baseRevision != null) 'baseRevision': baseRevision,
    if (resurrect) 'resurrect': true,
    'consistencyPolicy': consistencyPolicy,
  };
}

class BaseRow {
  const BaseRow({
    required this.table,
    required this.recordId,
    required this.revision,
    required this.operation,
    this.payload,
    this.identity,
    this.arrivalSeq,
  });

  factory BaseRow.fromJson(Map<String, dynamic> json) {
    final identity = json['identity'];
    return BaseRow(
      table: json['table'] as String,
      recordId: json['recordId'] as String,
      revision: json['revision'] as String,
      operation: json['operation'] as String,
      payload: json['payload'] is Map
          ? Map<String, dynamic>.from(json['payload'] as Map)
          : null,
      identity: identity is Map
          ? ProtocolIdentity(
              clientId: identity['clientId'] as String,
              mutationId: identity['mutationId'] as String,
            )
          : null,
      arrivalSeq: json['arrivalSeq'] as int?,
    );
  }

  final String table;
  final String recordId;
  final String revision;
  final String operation;
  final Map<String, dynamic>? payload;
  final ProtocolIdentity? identity;
  final int? arrivalSeq;
}

class ProtocolIdentity {
  const ProtocolIdentity({required this.clientId, required this.mutationId});
  final String clientId;
  final String mutationId;
}

class OverlayEntry {
  const OverlayEntry({
    required this.mutationId,
    required this.clientId,
    required this.table,
    required this.recordId,
    required this.operation,
    required this.consistencyPolicy,
    required this.status,
    this.payload,
    this.revision,
    this.transformedPayload,
  });

  factory OverlayEntry.fromJson(Map<String, dynamic> json) {
    return OverlayEntry(
      mutationId: json['mutationId'] as String,
      clientId: json['clientId'] as String,
      table: json['table'] as String,
      recordId: json['recordId'] as String,
      operation: json['operation'] as String,
      consistencyPolicy: json['consistencyPolicy'] as String,
      status: json['status'] as String,
      payload: json['payload'] is Map
          ? Map<String, dynamic>.from(json['payload'] as Map)
          : null,
      revision: json['revision'] as String?,
      transformedPayload: json['transformedPayload'] is Map
          ? Map<String, dynamic>.from(json['transformedPayload'] as Map)
          : null,
    );
  }

  final String mutationId;
  final String clientId;
  final String table;
  final String recordId;
  final String operation;
  final Map<String, dynamic>? payload;
  final String? revision;
  final String consistencyPolicy;
  final String status;
  final Map<String, dynamic>? transformedPayload;
}

class ProjectedRow {
  const ProjectedRow({
    required this.table,
    required this.recordId,
    required this.revision,
    required this.operation,
    required this.provenance,
    this.payload,
  });

  final String table;
  final String recordId;
  final String revision;
  final String operation;
  final Map<String, dynamic>? payload;
  final String provenance;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'table': table,
    'recordId': recordId,
    'revision': revision,
    'operation': operation,
    if (payload != null) 'payload': payload,
    'provenance': provenance,
  };
}

class ConsistencyOutcome {
  const ConsistencyOutcome({
    required this.status,
    required this.consistencyPolicy,
    this.coveredMutationIds = const <String>[],
    this.message,
  });

  final String status;
  final String consistencyPolicy;
  final List<String> coveredMutationIds;
  final String? message;
}

String canonicalizeConsistencyPolicy(String identifier) {
  final canonical = consistencyPolicyAliases[identifier];
  if (canonical == null) {
    throw UnknownConsistencyPolicyException(identifier);
  }
  return canonical;
}

Object? _stable(Object? value) {
  if (value is List) return value.map(_stable).toList(growable: false);
  if (value is Map) {
    final entries =
        value.entries
            .map(
              (entry) => MapEntry(entry.key.toString(), _stable(entry.value)),
            )
            .toList(growable: false)
          ..sort((left, right) => left.key.compareTo(right.key));
    return Map<String, Object?>.fromEntries(entries);
  }
  return value;
}

String _stableJson(Object? value) => jsonEncode(_stable(value));

void assertQueuedIntentFrozen(
  MutationIntent existing,
  MutationIntent proposed,
) {
  final same =
      existing.clientId == proposed.clientId &&
      existing.mutationId == proposed.mutationId &&
      existing.table == proposed.table &&
      existing.recordId == proposed.recordId &&
      existing.operation == proposed.operation &&
      (existing.baseRevision ?? '') == (proposed.baseRevision ?? '') &&
      existing.resurrect == proposed.resurrect &&
      canonicalizeConsistencyPolicy(existing.consistencyPolicy) ==
          canonicalizeConsistencyPolicy(proposed.consistencyPolicy) &&
      _stableJson(existing.payload) == _stableJson(proposed.payload);
  if (!same) {
    throw FrozenMutationIntentException(
      'queued mutation ${existing.clientId}/${existing.mutationId} cannot change identity or content',
    );
  }
}

ConsistencyOutcome outcomeForNetwork({
  required String policy,
  required String network,
  List<String> coveredMutationIds = const <String>[],
}) {
  final consistencyPolicy = canonicalizeConsistencyPolicy(policy);
  if (network == 'cancelled') {
    return ConsistencyOutcome(
      status: 'cancelled',
      consistencyPolicy: consistencyPolicy,
    );
  }
  if (consistencyPolicy == consistencyPolicyQueuedLocalFirst) {
    return ConsistencyOutcome(
      status: 'pending',
      consistencyPolicy: consistencyPolicy,
    );
  }
  if (network == 'not-attempted') {
    return ConsistencyOutcome(
      status: 'pending',
      consistencyPolicy: consistencyPolicy,
    );
  }
  if (network == 'response-lost') {
    return ConsistencyOutcome(
      status: 'ambiguous',
      consistencyPolicy: consistencyPolicy,
      message: 'committed-but-response-lost',
    );
  }
  if (network == 'rejected') {
    return ConsistencyOutcome(
      status: 'rejected',
      consistencyPolicy: consistencyPolicy,
      coveredMutationIds: coveredMutationIds,
    );
  }
  if (network == 'transformed') {
    return ConsistencyOutcome(
      status: 'transformed',
      consistencyPolicy: consistencyPolicy,
      coveredMutationIds: coveredMutationIds,
    );
  }
  return ConsistencyOutcome(
    status: 'confirmed',
    consistencyPolicy: consistencyPolicy,
    coveredMutationIds: coveredMutationIds,
  );
}

int compareDecimal(String left, String right) {
  final decimal = RegExp(r'^(?:0|[1-9]\d*)$');
  final a = decimal.hasMatch(left) ? left : '0';
  final b = decimal.hasMatch(right) ? right : '0';
  if (a.length != b.length) return a.length < b.length ? -1 : 1;
  return a.compareTo(b);
}

String _recordKey(String table, String recordId) => '$table\u0000$recordId';

ProjectedRow _toProjected(BaseRow row, String provenance) => ProjectedRow(
  table: row.table,
  recordId: row.recordId,
  revision: row.revision,
  operation: row.operation,
  payload: row.payload == null ? null : Map<String, dynamic>.from(row.payload!),
  provenance: provenance,
);

BaseRow _selectRemoteWinner(List<BaseRow> rows) {
  return rows.reduce((winner, candidate) {
    final byRevision = compareDecimal(candidate.revision, winner.revision);
    if (byRevision > 0) return candidate;
    if (byRevision < 0) return winner;
    final candidateId = candidate.identity?.mutationId ?? '';
    final winnerId = winner.identity?.mutationId ?? '';
    if (candidateId != winnerId) {
      return candidateId.compareTo(winnerId) < 0 ? candidate : winner;
    }
    return winner;
  });
}

List<ProjectedRow> reconcileReadModel({
  required List<BaseRow> localBase,
  required List<OverlayEntry> overlay,
  List<BaseRow> remote = const <BaseRow>[],
  List<String> acknowledgedMutationIds = const <String>[],
}) {
  final working = <String, ProjectedRow>{};
  for (final row in localBase) {
    working[_recordKey(row.table, row.recordId)] = _toProjected(
      row,
      'authoritative',
    );
  }

  if (remote.isNotEmpty) {
    final grouped = <String, List<BaseRow>>{};
    for (final row in remote) {
      grouped
          .putIfAbsent(_recordKey(row.table, row.recordId), () => <BaseRow>[])
          .add(row);
    }
    for (final entry in grouped.entries) {
      final remoteRow = _selectRemoteWinner(entry.value);
      final local = working[entry.key];
      if (local == null) {
        working[entry.key] = _toProjected(remoteRow, 'authoritative');
        continue;
      }
      if (compareDecimal(remoteRow.revision, local.revision) <= 0) {
        continue;
      }
      working[entry.key] = _toProjected(remoteRow, 'authoritative');
    }
  }

  final acknowledged = acknowledgedMutationIds.toSet();
  for (final entry in overlay) {
    if (acknowledged.contains(entry.mutationId)) continue;
    final policy = canonicalizeConsistencyPolicy(entry.consistencyPolicy);
    if (entry.status == 'pending' &&
        policy == consistencyPolicyRemoteAcknowledged) {
      continue;
    }
    final payload = entry.status == 'transformed'
        ? entry.transformedPayload ?? entry.payload
        : entry.payload;
    working[_recordKey(entry.table, entry.recordId)] = ProjectedRow(
      table: entry.table,
      recordId: entry.recordId,
      revision:
          entry.revision ??
          working[_recordKey(entry.table, entry.recordId)]?.revision ??
          '0',
      operation: entry.operation,
      payload: payload == null ? null : Map<String, dynamic>.from(payload),
      provenance: entry.status,
    );
  }

  final records = working.values.toList(growable: false)
    ..sort((left, right) {
      final table = left.table.compareTo(right.table);
      if (table != 0) return table;
      return left.recordId.compareTo(right.recordId);
    });
  return records;
}
