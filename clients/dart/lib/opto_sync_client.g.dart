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
  @override
  List<GeneratedColumn> get $columns => [
    id,
    targetTable,
    recordId,
    jsonPayload,
    createdAt,
    syncStatus,
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
  const Mutation({
    required this.id,
    required this.targetTable,
    required this.recordId,
    required this.jsonPayload,
    required this.createdAt,
    required this.syncStatus,
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
    };
  }

  Mutation copyWith({
    int? id,
    String? targetTable,
    String? recordId,
    String? jsonPayload,
    DateTime? createdAt,
    int? syncStatus,
  }) => Mutation(
    id: id ?? this.id,
    targetTable: targetTable ?? this.targetTable,
    recordId: recordId ?? this.recordId,
    jsonPayload: jsonPayload ?? this.jsonPayload,
    createdAt: createdAt ?? this.createdAt,
    syncStatus: syncStatus ?? this.syncStatus,
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
          ..write('syncStatus: $syncStatus')
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
          other.syncStatus == this.syncStatus);
}

class LocalMutationsCompanion extends UpdateCompanion<Mutation> {
  final Value<int> id;
  final Value<String> targetTable;
  final Value<String> recordId;
  final Value<String> jsonPayload;
  final Value<DateTime> createdAt;
  final Value<int> syncStatus;
  const LocalMutationsCompanion({
    this.id = const Value.absent(),
    this.targetTable = const Value.absent(),
    this.recordId = const Value.absent(),
    this.jsonPayload = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.syncStatus = const Value.absent(),
  });
  LocalMutationsCompanion.insert({
    this.id = const Value.absent(),
    required String targetTable,
    required String recordId,
    required String jsonPayload,
    this.createdAt = const Value.absent(),
    this.syncStatus = const Value.absent(),
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
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (targetTable != null) 'table_name': targetTable,
      if (recordId != null) 'record_id': recordId,
      if (jsonPayload != null) 'json_payload': jsonPayload,
      if (createdAt != null) 'created_at': createdAt,
      if (syncStatus != null) 'sync_status': syncStatus,
    });
  }

  LocalMutationsCompanion copyWith({
    Value<int>? id,
    Value<String>? targetTable,
    Value<String>? recordId,
    Value<String>? jsonPayload,
    Value<DateTime>? createdAt,
    Value<int>? syncStatus,
  }) {
    return LocalMutationsCompanion(
      id: id ?? this.id,
      targetTable: targetTable ?? this.targetTable,
      recordId: recordId ?? this.recordId,
      jsonPayload: jsonPayload ?? this.jsonPayload,
      createdAt: createdAt ?? this.createdAt,
      syncStatus: syncStatus ?? this.syncStatus,
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
          ..write('syncStatus: $syncStatus')
          ..write(')'))
        .toString();
  }
}

abstract class _$OptoSyncDatabase extends GeneratedDatabase {
  _$OptoSyncDatabase(QueryExecutor e) : super(e);
  $OptoSyncDatabaseManager get managers => $OptoSyncDatabaseManager(this);
  late final $LocalMutationsTable localMutations = $LocalMutationsTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [localMutations];
}

typedef $$LocalMutationsTableCreateCompanionBuilder =
    LocalMutationsCompanion Function({
      Value<int> id,
      required String targetTable,
      required String recordId,
      required String jsonPayload,
      Value<DateTime> createdAt,
      Value<int> syncStatus,
    });
typedef $$LocalMutationsTableUpdateCompanionBuilder =
    LocalMutationsCompanion Function({
      Value<int> id,
      Value<String> targetTable,
      Value<String> recordId,
      Value<String> jsonPayload,
      Value<DateTime> createdAt,
      Value<int> syncStatus,
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
              }) => LocalMutationsCompanion(
                id: id,
                targetTable: targetTable,
                recordId: recordId,
                jsonPayload: jsonPayload,
                createdAt: createdAt,
                syncStatus: syncStatus,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required String targetTable,
                required String recordId,
                required String jsonPayload,
                Value<DateTime> createdAt = const Value.absent(),
                Value<int> syncStatus = const Value.absent(),
              }) => LocalMutationsCompanion.insert(
                id: id,
                targetTable: targetTable,
                recordId: recordId,
                jsonPayload: jsonPayload,
                createdAt: createdAt,
                syncStatus: syncStatus,
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

class $OptoSyncDatabaseManager {
  final _$OptoSyncDatabase _db;
  $OptoSyncDatabaseManager(this._db);
  $$LocalMutationsTableTableManager get localMutations =>
      $$LocalMutationsTableTableManager(_db, _db.localMutations);
}
