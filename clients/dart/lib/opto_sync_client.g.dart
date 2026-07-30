// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'opto_sync_client.dart';

// ignore_for_file: type=lint
class $LocalMutationsTable extends LocalMutations
    with TableInfo<$LocalMutationsTable, Mutation> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalMutationsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _targetTableMeta = const VerificationMeta(
    'targetTable',
  );
  @override
  late final GeneratedColumn<String> targetTable = GeneratedColumn<String>(
    'table_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _recordIdMeta = const VerificationMeta(
    'recordId',
  );
  @override
  late final GeneratedColumn<String> recordId = GeneratedColumn<String>(
    'record_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _jsonPayloadMeta = const VerificationMeta(
    'jsonPayload',
  );
  @override
  late final GeneratedColumn<String> jsonPayload = GeneratedColumn<String>(
    'json_payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
    defaultValue: currentDateAndTime,
  );
  static const VerificationMeta _syncStatusMeta = const VerificationMeta(
    'syncStatus',
  );
  @override
  late final GeneratedColumn<int> syncStatus = GeneratedColumn<int>(
    'sync_status',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _clientIdMeta = const VerificationMeta(
    'clientId',
  );
  @override
  late final GeneratedColumn<String> clientId = GeneratedColumn<String>(
    'client_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _mutationIdMeta = const VerificationMeta(
    'mutationId',
  );
  @override
  late final GeneratedColumn<String> mutationId = GeneratedColumn<String>(
    'mutation_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _operationMeta = const VerificationMeta(
    'operation',
  );
  @override
  late final GeneratedColumn<String> operation = GeneratedColumn<String>(
    'operation',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('upsert'),
  );
  static const VerificationMeta _baseRevisionMeta = const VerificationMeta(
    'baseRevision',
  );
  @override
  late final GeneratedColumn<String> baseRevision = GeneratedColumn<String>(
    'base_revision',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _resurrectMeta = const VerificationMeta(
    'resurrect',
  );
  @override
  late final GeneratedColumn<bool> resurrect = GeneratedColumn<bool>(
    'resurrect',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("resurrect" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _attemptsMeta = const VerificationMeta(
    'attempts',
  );
  @override
  late final GeneratedColumn<int> attempts = GeneratedColumn<int>(
    'attempts',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _lastErrorMeta = const VerificationMeta(
    'lastError',
  );
  @override
  late final GeneratedColumn<String> lastError = GeneratedColumn<String>(
    'last_error',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    targetTable,
    recordId,
    jsonPayload,
    createdAt,
    syncStatus,
    clientId,
    mutationId,
    operation,
    baseRevision,
    resurrect,
    attempts,
    lastError,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_mutations';
  @override
  VerificationContext validateIntegrity(
    Insertable<Mutation> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('table_name')) {
      context.handle(
        _targetTableMeta,
        targetTable.isAcceptableOrUnknown(
          data['table_name']!,
          _targetTableMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_targetTableMeta);
    }
    if (data.containsKey('record_id')) {
      context.handle(
        _recordIdMeta,
        recordId.isAcceptableOrUnknown(data['record_id']!, _recordIdMeta),
      );
    } else if (isInserting) {
      context.missing(_recordIdMeta);
    }
    if (data.containsKey('json_payload')) {
      context.handle(
        _jsonPayloadMeta,
        jsonPayload.isAcceptableOrUnknown(
          data['json_payload']!,
          _jsonPayloadMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_jsonPayloadMeta);
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    }
    if (data.containsKey('sync_status')) {
      context.handle(
        _syncStatusMeta,
        syncStatus.isAcceptableOrUnknown(data['sync_status']!, _syncStatusMeta),
      );
    }
    if (data.containsKey('client_id')) {
      context.handle(
        _clientIdMeta,
        clientId.isAcceptableOrUnknown(data['client_id']!, _clientIdMeta),
      );
    }
    if (data.containsKey('mutation_id')) {
      context.handle(
        _mutationIdMeta,
        mutationId.isAcceptableOrUnknown(data['mutation_id']!, _mutationIdMeta),
      );
    }
    if (data.containsKey('operation')) {
      context.handle(
        _operationMeta,
        operation.isAcceptableOrUnknown(data['operation']!, _operationMeta),
      );
    }
    if (data.containsKey('base_revision')) {
      context.handle(
        _baseRevisionMeta,
        baseRevision.isAcceptableOrUnknown(
          data['base_revision']!,
          _baseRevisionMeta,
        ),
      );
    }
    if (data.containsKey('resurrect')) {
      context.handle(
        _resurrectMeta,
        resurrect.isAcceptableOrUnknown(data['resurrect']!, _resurrectMeta),
      );
    }
    if (data.containsKey('attempts')) {
      context.handle(
        _attemptsMeta,
        attempts.isAcceptableOrUnknown(data['attempts']!, _attemptsMeta),
      );
    }
    if (data.containsKey('last_error')) {
      context.handle(
        _lastErrorMeta,
        lastError.isAcceptableOrUnknown(data['last_error']!, _lastErrorMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  Mutation map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return Mutation(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      targetTable: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}table_name'],
      )!,
      recordId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}record_id'],
      )!,
      jsonPayload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}json_payload'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
      syncStatus: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}sync_status'],
      )!,
      clientId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}client_id'],
      ),
      mutationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}mutation_id'],
      ),
      operation: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}operation'],
      )!,
      baseRevision: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}base_revision'],
      ),
      resurrect: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}resurrect'],
      )!,
      attempts: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}attempts'],
      )!,
      lastError: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_error'],
      ),
    );
  }

  @override
  $LocalMutationsTable createAlias(String alias) {
    return $LocalMutationsTable(attachedDatabase, alias);
  }
}

class Mutation extends DataClass implements Insertable<Mutation> {
  final int id;
  final String targetTable;
  final String recordId;
  final String jsonPayload;
  final DateTime createdAt;

  /// 0 = pending, 1 = synced, 2 = failed.
  final int syncStatus;
  final String? clientId;
  final String? mutationId;
  final String operation;
  final String? baseRevision;
  final bool resurrect;
  final int attempts;
  final String? lastError;
  const Mutation({
    required this.id,
    required this.targetTable,
    required this.recordId,
    required this.jsonPayload,
    required this.createdAt,
    required this.syncStatus,
    this.clientId,
    this.mutationId,
    required this.operation,
    this.baseRevision,
    required this.resurrect,
    required this.attempts,
    this.lastError,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['table_name'] = Variable<String>(targetTable);
    map['record_id'] = Variable<String>(recordId);
    map['json_payload'] = Variable<String>(jsonPayload);
    map['created_at'] = Variable<DateTime>(createdAt);
    map['sync_status'] = Variable<int>(syncStatus);
    if (!nullToAbsent || clientId != null) {
      map['client_id'] = Variable<String>(clientId);
    }
    if (!nullToAbsent || mutationId != null) {
      map['mutation_id'] = Variable<String>(mutationId);
    }
    map['operation'] = Variable<String>(operation);
    if (!nullToAbsent || baseRevision != null) {
      map['base_revision'] = Variable<String>(baseRevision);
    }
    map['resurrect'] = Variable<bool>(resurrect);
    map['attempts'] = Variable<int>(attempts);
    if (!nullToAbsent || lastError != null) {
      map['last_error'] = Variable<String>(lastError);
    }
    return map;
  }

  LocalMutationsCompanion toCompanion(bool nullToAbsent) {
    return LocalMutationsCompanion(
      id: Value(id),
      targetTable: Value(targetTable),
      recordId: Value(recordId),
      jsonPayload: Value(jsonPayload),
      createdAt: Value(createdAt),
      syncStatus: Value(syncStatus),
      clientId: clientId == null && nullToAbsent
          ? const Value.absent()
          : Value(clientId),
      mutationId: mutationId == null && nullToAbsent
          ? const Value.absent()
          : Value(mutationId),
      operation: Value(operation),
      baseRevision: baseRevision == null && nullToAbsent
          ? const Value.absent()
          : Value(baseRevision),
      resurrect: Value(resurrect),
      attempts: Value(attempts),
      lastError: lastError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastError),
    );
  }

  factory Mutation.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return Mutation(
      id: serializer.fromJson<int>(json['id']),
      targetTable: serializer.fromJson<String>(json['targetTable']),
      recordId: serializer.fromJson<String>(json['recordId']),
      jsonPayload: serializer.fromJson<String>(json['jsonPayload']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      syncStatus: serializer.fromJson<int>(json['syncStatus']),
      clientId: serializer.fromJson<String?>(json['clientId']),
      mutationId: serializer.fromJson<String?>(json['mutationId']),
      operation: serializer.fromJson<String>(json['operation']),
      baseRevision: serializer.fromJson<String?>(json['baseRevision']),
      resurrect: serializer.fromJson<bool>(json['resurrect']),
      attempts: serializer.fromJson<int>(json['attempts']),
      lastError: serializer.fromJson<String?>(json['lastError']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'targetTable': serializer.toJson<String>(targetTable),
      'recordId': serializer.toJson<String>(recordId),
      'jsonPayload': serializer.toJson<String>(jsonPayload),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'syncStatus': serializer.toJson<int>(syncStatus),
      'clientId': serializer.toJson<String?>(clientId),
      'mutationId': serializer.toJson<String?>(mutationId),
      'operation': serializer.toJson<String>(operation),
      'baseRevision': serializer.toJson<String?>(baseRevision),
      'resurrect': serializer.toJson<bool>(resurrect),
      'attempts': serializer.toJson<int>(attempts),
      'lastError': serializer.toJson<String?>(lastError),
    };
  }

  Mutation copyWith({
    int? id,
    String? targetTable,
    String? recordId,
    String? jsonPayload,
    DateTime? createdAt,
    int? syncStatus,
    Value<String?> clientId = const Value.absent(),
    Value<String?> mutationId = const Value.absent(),
    String? operation,
    Value<String?> baseRevision = const Value.absent(),
    bool? resurrect,
    int? attempts,
    Value<String?> lastError = const Value.absent(),
  }) => Mutation(
    id: id ?? this.id,
    targetTable: targetTable ?? this.targetTable,
    recordId: recordId ?? this.recordId,
    jsonPayload: jsonPayload ?? this.jsonPayload,
    createdAt: createdAt ?? this.createdAt,
    syncStatus: syncStatus ?? this.syncStatus,
    clientId: clientId.present ? clientId.value : this.clientId,
    mutationId: mutationId.present ? mutationId.value : this.mutationId,
    operation: operation ?? this.operation,
    baseRevision: baseRevision.present ? baseRevision.value : this.baseRevision,
    resurrect: resurrect ?? this.resurrect,
    attempts: attempts ?? this.attempts,
    lastError: lastError.present ? lastError.value : this.lastError,
  );
  Mutation copyWithCompanion(LocalMutationsCompanion data) {
    return Mutation(
      id: data.id.present ? data.id.value : this.id,
      targetTable: data.targetTable.present
          ? data.targetTable.value
          : this.targetTable,
      recordId: data.recordId.present ? data.recordId.value : this.recordId,
      jsonPayload: data.jsonPayload.present
          ? data.jsonPayload.value
          : this.jsonPayload,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      syncStatus: data.syncStatus.present
          ? data.syncStatus.value
          : this.syncStatus,
      clientId: data.clientId.present ? data.clientId.value : this.clientId,
      mutationId: data.mutationId.present
          ? data.mutationId.value
          : this.mutationId,
      operation: data.operation.present ? data.operation.value : this.operation,
      baseRevision: data.baseRevision.present
          ? data.baseRevision.value
          : this.baseRevision,
      resurrect: data.resurrect.present ? data.resurrect.value : this.resurrect,
      attempts: data.attempts.present ? data.attempts.value : this.attempts,
      lastError: data.lastError.present ? data.lastError.value : this.lastError,
    );
  }

  @override
  String toString() {
    return (StringBuffer('Mutation(')
          ..write('id: $id, ')
          ..write('targetTable: $targetTable, ')
          ..write('recordId: $recordId, ')
          ..write('jsonPayload: $jsonPayload, ')
          ..write('createdAt: $createdAt, ')
          ..write('syncStatus: $syncStatus, ')
          ..write('clientId: $clientId, ')
          ..write('mutationId: $mutationId, ')
          ..write('operation: $operation, ')
          ..write('baseRevision: $baseRevision, ')
          ..write('resurrect: $resurrect, ')
          ..write('attempts: $attempts, ')
          ..write('lastError: $lastError')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    targetTable,
    recordId,
    jsonPayload,
    createdAt,
    syncStatus,
    clientId,
    mutationId,
    operation,
    baseRevision,
    resurrect,
    attempts,
    lastError,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is Mutation &&
          other.id == this.id &&
          other.targetTable == this.targetTable &&
          other.recordId == this.recordId &&
          other.jsonPayload == this.jsonPayload &&
          other.createdAt == this.createdAt &&
          other.syncStatus == this.syncStatus &&
          other.clientId == this.clientId &&
          other.mutationId == this.mutationId &&
          other.operation == this.operation &&
          other.baseRevision == this.baseRevision &&
          other.resurrect == this.resurrect &&
          other.attempts == this.attempts &&
          other.lastError == this.lastError);
}

class LocalMutationsCompanion extends UpdateCompanion<Mutation> {
  final Value<int> id;
  final Value<String> targetTable;
  final Value<String> recordId;
  final Value<String> jsonPayload;
  final Value<DateTime> createdAt;
  final Value<int> syncStatus;
  final Value<String?> clientId;
  final Value<String?> mutationId;
  final Value<String> operation;
  final Value<String?> baseRevision;
  final Value<bool> resurrect;
  final Value<int> attempts;
  final Value<String?> lastError;
  const LocalMutationsCompanion({
    this.id = const Value.absent(),
    this.targetTable = const Value.absent(),
    this.recordId = const Value.absent(),
    this.jsonPayload = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.syncStatus = const Value.absent(),
    this.clientId = const Value.absent(),
    this.mutationId = const Value.absent(),
    this.operation = const Value.absent(),
    this.baseRevision = const Value.absent(),
    this.resurrect = const Value.absent(),
    this.attempts = const Value.absent(),
    this.lastError = const Value.absent(),
  });
  LocalMutationsCompanion.insert({
    this.id = const Value.absent(),
    required String targetTable,
    required String recordId,
    required String jsonPayload,
    this.createdAt = const Value.absent(),
    this.syncStatus = const Value.absent(),
    this.clientId = const Value.absent(),
    this.mutationId = const Value.absent(),
    this.operation = const Value.absent(),
    this.baseRevision = const Value.absent(),
    this.resurrect = const Value.absent(),
    this.attempts = const Value.absent(),
    this.lastError = const Value.absent(),
  }) : targetTable = Value(targetTable),
       recordId = Value(recordId),
       jsonPayload = Value(jsonPayload);
  static Insertable<Mutation> custom({
    Expression<int>? id,
    Expression<String>? targetTable,
    Expression<String>? recordId,
    Expression<String>? jsonPayload,
    Expression<DateTime>? createdAt,
    Expression<int>? syncStatus,
    Expression<String>? clientId,
    Expression<String>? mutationId,
    Expression<String>? operation,
    Expression<String>? baseRevision,
    Expression<bool>? resurrect,
    Expression<int>? attempts,
    Expression<String>? lastError,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (targetTable != null) 'table_name': targetTable,
      if (recordId != null) 'record_id': recordId,
      if (jsonPayload != null) 'json_payload': jsonPayload,
      if (createdAt != null) 'created_at': createdAt,
      if (syncStatus != null) 'sync_status': syncStatus,
      if (clientId != null) 'client_id': clientId,
      if (mutationId != null) 'mutation_id': mutationId,
      if (operation != null) 'operation': operation,
      if (baseRevision != null) 'base_revision': baseRevision,
      if (resurrect != null) 'resurrect': resurrect,
      if (attempts != null) 'attempts': attempts,
      if (lastError != null) 'last_error': lastError,
    });
  }

  LocalMutationsCompanion copyWith({
    Value<int>? id,
    Value<String>? targetTable,
    Value<String>? recordId,
    Value<String>? jsonPayload,
    Value<DateTime>? createdAt,
    Value<int>? syncStatus,
    Value<String?>? clientId,
    Value<String?>? mutationId,
    Value<String>? operation,
    Value<String?>? baseRevision,
    Value<bool>? resurrect,
    Value<int>? attempts,
    Value<String?>? lastError,
  }) {
    return LocalMutationsCompanion(
      id: id ?? this.id,
      targetTable: targetTable ?? this.targetTable,
      recordId: recordId ?? this.recordId,
      jsonPayload: jsonPayload ?? this.jsonPayload,
      createdAt: createdAt ?? this.createdAt,
      syncStatus: syncStatus ?? this.syncStatus,
      clientId: clientId ?? this.clientId,
      mutationId: mutationId ?? this.mutationId,
      operation: operation ?? this.operation,
      baseRevision: baseRevision ?? this.baseRevision,
      resurrect: resurrect ?? this.resurrect,
      attempts: attempts ?? this.attempts,
      lastError: lastError ?? this.lastError,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (targetTable.present) {
      map['table_name'] = Variable<String>(targetTable.value);
    }
    if (recordId.present) {
      map['record_id'] = Variable<String>(recordId.value);
    }
    if (jsonPayload.present) {
      map['json_payload'] = Variable<String>(jsonPayload.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (syncStatus.present) {
      map['sync_status'] = Variable<int>(syncStatus.value);
    }
    if (clientId.present) {
      map['client_id'] = Variable<String>(clientId.value);
    }
    if (mutationId.present) {
      map['mutation_id'] = Variable<String>(mutationId.value);
    }
    if (operation.present) {
      map['operation'] = Variable<String>(operation.value);
    }
    if (baseRevision.present) {
      map['base_revision'] = Variable<String>(baseRevision.value);
    }
    if (resurrect.present) {
      map['resurrect'] = Variable<bool>(resurrect.value);
    }
    if (attempts.present) {
      map['attempts'] = Variable<int>(attempts.value);
    }
    if (lastError.present) {
      map['last_error'] = Variable<String>(lastError.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalMutationsCompanion(')
          ..write('id: $id, ')
          ..write('targetTable: $targetTable, ')
          ..write('recordId: $recordId, ')
          ..write('jsonPayload: $jsonPayload, ')
          ..write('createdAt: $createdAt, ')
          ..write('syncStatus: $syncStatus, ')
          ..write('clientId: $clientId, ')
          ..write('mutationId: $mutationId, ')
          ..write('operation: $operation, ')
          ..write('baseRevision: $baseRevision, ')
          ..write('resurrect: $resurrect, ')
          ..write('attempts: $attempts, ')
          ..write('lastError: $lastError')
          ..write(')'))
        .toString();
  }
}

class $MetaTable extends Meta with TableInfo<$MetaTable, MetaEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $MetaTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _valueMeta = const VerificationMeta('value');
  @override
  late final GeneratedColumn<String> value = GeneratedColumn<String>(
    'value',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [key, value];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'meta';
  @override
  VerificationContext validateIntegrity(
    Insertable<MetaEntry> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('value')) {
      context.handle(
        _valueMeta,
        value.isAcceptableOrUnknown(data['value']!, _valueMeta),
      );
    } else if (isInserting) {
      context.missing(_valueMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  MetaEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return MetaEntry(
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      value: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}value'],
      )!,
    );
  }

  @override
  $MetaTable createAlias(String alias) {
    return $MetaTable(attachedDatabase, alias);
  }
}

class MetaEntry extends DataClass implements Insertable<MetaEntry> {
  final String key;
  final String value;
  const MetaEntry({required this.key, required this.value});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['value'] = Variable<String>(value);
    return map;
  }

  MetaCompanion toCompanion(bool nullToAbsent) {
    return MetaCompanion(key: Value(key), value: Value(value));
  }

  factory MetaEntry.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return MetaEntry(
      key: serializer.fromJson<String>(json['key']),
      value: serializer.fromJson<String>(json['value']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'value': serializer.toJson<String>(value),
    };
  }

  MetaEntry copyWith({String? key, String? value}) =>
      MetaEntry(key: key ?? this.key, value: value ?? this.value);
  MetaEntry copyWithCompanion(MetaCompanion data) {
    return MetaEntry(
      key: data.key.present ? data.key.value : this.key,
      value: data.value.present ? data.value.value : this.value,
    );
  }

  @override
  String toString() {
    return (StringBuffer('MetaEntry(')
          ..write('key: $key, ')
          ..write('value: $value')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, value);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is MetaEntry &&
          other.key == this.key &&
          other.value == this.value);
}

class MetaCompanion extends UpdateCompanion<MetaEntry> {
  final Value<String> key;
  final Value<String> value;
  final Value<int> rowid;
  const MetaCompanion({
    this.key = const Value.absent(),
    this.value = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  MetaCompanion.insert({
    required String key,
    required String value,
    this.rowid = const Value.absent(),
  }) : key = Value(key),
       value = Value(value);
  static Insertable<MetaEntry> custom({
    Expression<String>? key,
    Expression<String>? value,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (value != null) 'value': value,
      if (rowid != null) 'rowid': rowid,
    });
  }

  MetaCompanion copyWith({
    Value<String>? key,
    Value<String>? value,
    Value<int>? rowid,
  }) {
    return MetaCompanion(
      key: key ?? this.key,
      value: value ?? this.value,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (value.present) {
      map['value'] = Variable<String>(value.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('MetaCompanion(')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$OptoSyncDatabase extends GeneratedDatabase {
  _$OptoSyncDatabase(QueryExecutor e) : super(e);
  $OptoSyncDatabaseManager get managers => $OptoSyncDatabaseManager(this);
  late final $LocalMutationsTable localMutations = $LocalMutationsTable(this);
  late final $MetaTable meta = $MetaTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [localMutations, meta];
}

typedef $$LocalMutationsTableCreateCompanionBuilder =
    LocalMutationsCompanion Function({
      Value<int> id,
      required String targetTable,
      required String recordId,
      required String jsonPayload,
      Value<DateTime> createdAt,
      Value<int> syncStatus,
      Value<String?> clientId,
      Value<String?> mutationId,
      Value<String> operation,
      Value<String?> baseRevision,
      Value<bool> resurrect,
      Value<int> attempts,
      Value<String?> lastError,
    });
typedef $$LocalMutationsTableUpdateCompanionBuilder =
    LocalMutationsCompanion Function({
      Value<int> id,
      Value<String> targetTable,
      Value<String> recordId,
      Value<String> jsonPayload,
      Value<DateTime> createdAt,
      Value<int> syncStatus,
      Value<String?> clientId,
      Value<String?> mutationId,
      Value<String> operation,
      Value<String?> baseRevision,
      Value<bool> resurrect,
      Value<int> attempts,
      Value<String?> lastError,
    });

class $$LocalMutationsTableFilterComposer
    extends Composer<_$OptoSyncDatabase, $LocalMutationsTable> {
  $$LocalMutationsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get targetTable => $composableBuilder(
    column: $table.targetTable,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get recordId => $composableBuilder(
    column: $table.recordId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get jsonPayload => $composableBuilder(
    column: $table.jsonPayload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get syncStatus => $composableBuilder(
    column: $table.syncStatus,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get clientId => $composableBuilder(
    column: $table.clientId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get mutationId => $composableBuilder(
    column: $table.mutationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get operation => $composableBuilder(
    column: $table.operation,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get baseRevision => $composableBuilder(
    column: $table.baseRevision,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get resurrect => $composableBuilder(
    column: $table.resurrect,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnFilters(column),
  );
}

class $$LocalMutationsTableOrderingComposer
    extends Composer<_$OptoSyncDatabase, $LocalMutationsTable> {
  $$LocalMutationsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get targetTable => $composableBuilder(
    column: $table.targetTable,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get recordId => $composableBuilder(
    column: $table.recordId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get jsonPayload => $composableBuilder(
    column: $table.jsonPayload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get syncStatus => $composableBuilder(
    column: $table.syncStatus,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get clientId => $composableBuilder(
    column: $table.clientId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get mutationId => $composableBuilder(
    column: $table.mutationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get operation => $composableBuilder(
    column: $table.operation,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get baseRevision => $composableBuilder(
    column: $table.baseRevision,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get resurrect => $composableBuilder(
    column: $table.resurrect,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LocalMutationsTableAnnotationComposer
    extends Composer<_$OptoSyncDatabase, $LocalMutationsTable> {
  $$LocalMutationsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get targetTable => $composableBuilder(
    column: $table.targetTable,
    builder: (column) => column,
  );

  GeneratedColumn<String> get recordId =>
      $composableBuilder(column: $table.recordId, builder: (column) => column);

  GeneratedColumn<String> get jsonPayload => $composableBuilder(
    column: $table.jsonPayload,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<int> get syncStatus => $composableBuilder(
    column: $table.syncStatus,
    builder: (column) => column,
  );

  GeneratedColumn<String> get clientId =>
      $composableBuilder(column: $table.clientId, builder: (column) => column);

  GeneratedColumn<String> get mutationId => $composableBuilder(
    column: $table.mutationId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get operation =>
      $composableBuilder(column: $table.operation, builder: (column) => column);

  GeneratedColumn<String> get baseRevision => $composableBuilder(
    column: $table.baseRevision,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get resurrect =>
      $composableBuilder(column: $table.resurrect, builder: (column) => column);

  GeneratedColumn<int> get attempts =>
      $composableBuilder(column: $table.attempts, builder: (column) => column);

  GeneratedColumn<String> get lastError =>
      $composableBuilder(column: $table.lastError, builder: (column) => column);
}

class $$LocalMutationsTableTableManager
    extends
        RootTableManager<
          _$OptoSyncDatabase,
          $LocalMutationsTable,
          Mutation,
          $$LocalMutationsTableFilterComposer,
          $$LocalMutationsTableOrderingComposer,
          $$LocalMutationsTableAnnotationComposer,
          $$LocalMutationsTableCreateCompanionBuilder,
          $$LocalMutationsTableUpdateCompanionBuilder,
          (
            Mutation,
            BaseReferences<_$OptoSyncDatabase, $LocalMutationsTable, Mutation>,
          ),
          Mutation,
          PrefetchHooks Function()
        > {
  $$LocalMutationsTableTableManager(
    _$OptoSyncDatabase db,
    $LocalMutationsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalMutationsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalMutationsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalMutationsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<String> targetTable = const Value.absent(),
                Value<String> recordId = const Value.absent(),
                Value<String> jsonPayload = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<int> syncStatus = const Value.absent(),
                Value<String?> clientId = const Value.absent(),
                Value<String?> mutationId = const Value.absent(),
                Value<String> operation = const Value.absent(),
                Value<String?> baseRevision = const Value.absent(),
                Value<bool> resurrect = const Value.absent(),
                Value<int> attempts = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
              }) => LocalMutationsCompanion(
                id: id,
                targetTable: targetTable,
                recordId: recordId,
                jsonPayload: jsonPayload,
                createdAt: createdAt,
                syncStatus: syncStatus,
                clientId: clientId,
                mutationId: mutationId,
                operation: operation,
                baseRevision: baseRevision,
                resurrect: resurrect,
                attempts: attempts,
                lastError: lastError,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required String targetTable,
                required String recordId,
                required String jsonPayload,
                Value<DateTime> createdAt = const Value.absent(),
                Value<int> syncStatus = const Value.absent(),
                Value<String?> clientId = const Value.absent(),
                Value<String?> mutationId = const Value.absent(),
                Value<String> operation = const Value.absent(),
                Value<String?> baseRevision = const Value.absent(),
                Value<bool> resurrect = const Value.absent(),
                Value<int> attempts = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
              }) => LocalMutationsCompanion.insert(
                id: id,
                targetTable: targetTable,
                recordId: recordId,
                jsonPayload: jsonPayload,
                createdAt: createdAt,
                syncStatus: syncStatus,
                clientId: clientId,
                mutationId: mutationId,
                operation: operation,
                baseRevision: baseRevision,
                resurrect: resurrect,
                attempts: attempts,
                lastError: lastError,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$LocalMutationsTableProcessedTableManager =
    ProcessedTableManager<
      _$OptoSyncDatabase,
      $LocalMutationsTable,
      Mutation,
      $$LocalMutationsTableFilterComposer,
      $$LocalMutationsTableOrderingComposer,
      $$LocalMutationsTableAnnotationComposer,
      $$LocalMutationsTableCreateCompanionBuilder,
      $$LocalMutationsTableUpdateCompanionBuilder,
      (
        Mutation,
        BaseReferences<_$OptoSyncDatabase, $LocalMutationsTable, Mutation>,
      ),
      Mutation,
      PrefetchHooks Function()
    >;
typedef $$MetaTableCreateCompanionBuilder =
    MetaCompanion Function({
      required String key,
      required String value,
      Value<int> rowid,
    });
typedef $$MetaTableUpdateCompanionBuilder =
    MetaCompanion Function({
      Value<String> key,
      Value<String> value,
      Value<int> rowid,
    });

class $$MetaTableFilterComposer
    extends Composer<_$OptoSyncDatabase, $MetaTable> {
  $$MetaTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnFilters(column),
  );
}

class $$MetaTableOrderingComposer
    extends Composer<_$OptoSyncDatabase, $MetaTable> {
  $$MetaTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$MetaTableAnnotationComposer
    extends Composer<_$OptoSyncDatabase, $MetaTable> {
  $$MetaTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get value =>
      $composableBuilder(column: $table.value, builder: (column) => column);
}

class $$MetaTableTableManager
    extends
        RootTableManager<
          _$OptoSyncDatabase,
          $MetaTable,
          MetaEntry,
          $$MetaTableFilterComposer,
          $$MetaTableOrderingComposer,
          $$MetaTableAnnotationComposer,
          $$MetaTableCreateCompanionBuilder,
          $$MetaTableUpdateCompanionBuilder,
          (
            MetaEntry,
            BaseReferences<_$OptoSyncDatabase, $MetaTable, MetaEntry>,
          ),
          MetaEntry,
          PrefetchHooks Function()
        > {
  $$MetaTableTableManager(_$OptoSyncDatabase db, $MetaTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$MetaTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$MetaTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$MetaTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> key = const Value.absent(),
                Value<String> value = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MetaCompanion(key: key, value: value, rowid: rowid),
          createCompanionCallback:
              ({
                required String key,
                required String value,
                Value<int> rowid = const Value.absent(),
              }) => MetaCompanion.insert(key: key, value: value, rowid: rowid),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$MetaTableProcessedTableManager =
    ProcessedTableManager<
      _$OptoSyncDatabase,
      $MetaTable,
      MetaEntry,
      $$MetaTableFilterComposer,
      $$MetaTableOrderingComposer,
      $$MetaTableAnnotationComposer,
      $$MetaTableCreateCompanionBuilder,
      $$MetaTableUpdateCompanionBuilder,
      (MetaEntry, BaseReferences<_$OptoSyncDatabase, $MetaTable, MetaEntry>),
      MetaEntry,
      PrefetchHooks Function()
    >;

class $OptoSyncDatabaseManager {
  final _$OptoSyncDatabase _db;
  $OptoSyncDatabaseManager(this._db);
  $$LocalMutationsTableTableManager get localMutations =>
      $$LocalMutationsTableTableManager(_db, _db.localMutations);
  $$MetaTableTableManager get meta => $$MetaTableTableManager(_db, _db.meta);
}
