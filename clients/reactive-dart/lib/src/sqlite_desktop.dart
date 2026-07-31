import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:sqlite3/common.dart';
import 'package:sqlite3/sqlite3.dart';

import 'background_sync.dart';
import 'desktop_sync.dart';

const int sqliteDesktopCoordinationSchemaVersion = 1;
const String _coordinationTable = 'opto_sync_desktop_coordination_v1';
const int _maximumGeneration = 9223372036854775807;
const int _minimumLeaseTtlMs = 1000;
const int _maximumLeaseTtlMs = 15 * 60 * 1000;

final class SqliteDesktopCoordinatorOptions {
  const SqliteDesktopCoordinatorOptions({
    this.busyTimeout = const Duration(seconds: 5),
    this.initializePragmas = true,
  });

  final Duration busyTimeout;
  final bool initializePragmas;
}

final class SqliteDesktopAcquireRequest {
  const SqliteDesktopAcquireRequest({
    required this.key,
    required this.ownerId,
    required this.token,
    required this.leaseTtl,
  });

  final String key;
  final String ownerId;
  final String token;
  final Duration leaseTtl;
}

final class SqliteDesktopLeaseGrant {
  const SqliteDesktopLeaseGrant({
    required this.key,
    required this.ownerId,
    required this.token,
    required this.fence,
    required this.acquiredAtMs,
    required this.expiresAtMs,
    required this.wakeGeneration,
    required this.handledGeneration,
  });

  final String key;
  final String ownerId;
  final String token;
  final String fence;
  final int acquiredAtMs;
  final int expiresAtMs;
  final String wakeGeneration;
  final String handledGeneration;

  DesktopLeaseGrant get desktopGrant => DesktopLeaseGrant(
        key: key,
        ownerId: ownerId,
        token: token,
        fence: fence,
        expiresAt: DateTime.fromMillisecondsSinceEpoch(expiresAtMs),
      );

  SqliteDesktopLeaseGrant copyWith({
    int? expiresAtMs,
    String? wakeGeneration,
    String? handledGeneration,
  }) {
    return SqliteDesktopLeaseGrant(
      key: key,
      ownerId: ownerId,
      token: token,
      fence: fence,
      acquiredAtMs: acquiredAtMs,
      expiresAtMs: expiresAtMs ?? this.expiresAtMs,
      wakeGeneration: wakeGeneration ?? this.wakeGeneration,
      handledGeneration: handledGeneration ?? this.handledGeneration,
    );
  }
}

sealed class SqliteDesktopAcquireResult {
  const SqliteDesktopAcquireResult();
}

final class SqliteDesktopAcquired extends SqliteDesktopAcquireResult {
  const SqliteDesktopAcquired(this.grant);

  final SqliteDesktopLeaseGrant grant;
}

final class SqliteDesktopBusy extends SqliteDesktopAcquireResult {
  const SqliteDesktopBusy({
    required this.retryAfterMs,
    required this.wakeGeneration,
    required this.handledGeneration,
  });

  final int retryAfterMs;
  final String wakeGeneration;
  final String handledGeneration;
}

final class SqliteDesktopWakeReceipt {
  const SqliteDesktopWakeReceipt({
    required this.generation,
    required this.handledGeneration,
    required this.dirty,
    required this.retryAfterMs,
  });

  final String generation;
  final String handledGeneration;
  final bool dirty;
  final int retryAfterMs;
}

final class SqliteDesktopCompletion {
  const SqliteDesktopCompletion({
    required this.released,
    required this.currentWakeGeneration,
    required this.handledGeneration,
  });

  final bool released;
  final String currentWakeGeneration;
  final String handledGeneration;
}

final class SqliteDesktopState {
  const SqliteDesktopState({
    required this.key,
    required this.fence,
    required this.expiresAtMs,
    required this.wakeGeneration,
    required this.handledGeneration,
    required this.dirty,
    required this.owned,
    required this.retryAfterMs,
  });

  final String key;
  final String fence;
  final int expiresAtMs;
  final String wakeGeneration;
  final String handledGeneration;
  final bool dirty;
  final bool owned;
  final int retryAfterMs;
}

final class StaleSqliteDesktopFenceException implements Exception {
  const StaleSqliteDesktopFenceException([
    this.message = 'desktop SQLite fence is stale, expired, or no longer owned',
  ]);

  final String message;

  @override
  String toString() => 'StaleSqliteDesktopFenceException: $message';
}

final class _CoordinationRow {
  const _CoordinationRow({
    required this.ownerToken,
    required this.fence,
    required this.expiresAtMs,
    required this.wakeGeneration,
    required this.handledGeneration,
  });

  final String? ownerToken;
  final String fence;
  final int expiresAtMs;
  final String wakeGeneration;
  final String handledGeneration;
}

void _validateIdentifier(String name, String value) {
  if (value.isEmpty || value.length > 512) {
    throw ArgumentError.value(value, name, 'must be 1 through 512 characters');
  }
}

int _validateDurationMs(
  String name,
  Duration value, {
  required int minimum,
  required int maximum,
}) {
  final milliseconds = value.inMilliseconds;
  if (milliseconds < minimum || milliseconds > maximum) {
    throw ArgumentError.value(
      value,
      name,
      'must be from $minimum through $maximum milliseconds',
    );
  }
  return milliseconds;
}

int _parseGeneration(String name, String value) {
  if (!RegExp(r'^(0|[1-9][0-9]*)$').hasMatch(value)) {
    throw ArgumentError.value(
      value,
      name,
      'must be a non-negative decimal integer',
    );
  }
  final parsed = BigInt.tryParse(value);
  if (parsed == null ||
      parsed.isNegative ||
      parsed > BigInt.from(_maximumGeneration)) {
    throw ArgumentError.value(
      value,
      name,
      "must fit SQLite's signed 64-bit integer range",
    );
  }
  return parsed.toInt();
}

int _asInt(Object? value, String name) {
  if (value is! int) {
    throw StateError('SQLite returned an invalid $name');
  }
  return value;
}

String _asString(Object? value, String name) {
  if (value is! String) {
    throw StateError('SQLite returned an invalid $name');
  }
  return value;
}

String? _asNullableString(Object? value, String name) {
  if (value != null && value is! String) {
    throw StateError('SQLite returned an invalid $name');
  }
  return value as String?;
}

int _nonNegativeDifference(int later, int earlier) {
  return later <= earlier ? 0 : later - earlier;
}

/// Shared, store-authoritative SQLite coordinator for native Dart and Flutter
/// desktop hosts.
///
/// Only coordination metadata is stored: lease key, opaque ephemeral owner
/// token, monotonic fence, expiry, and wake/handled generations. Credentials,
/// mutation payloads, database URLs, tenant secrets, and stable device
/// identifiers do not belong in this table.
final class SqliteDesktopCoordinator implements DesktopLeaseStore {
  SqliteDesktopCoordinator.open(
    String path, {
    SqliteDesktopCoordinatorOptions options =
        const SqliteDesktopCoordinatorOptions(),
  })  : _database = _openPath(path),
        _ownsDatabase = true {
    try {
      _initialize(options);
    } catch (_) {
      _database.close();
      _closed = true;
      rethrow;
    }
  }

  SqliteDesktopCoordinator.fromDatabase(
    Database database, {
    SqliteDesktopCoordinatorOptions options =
        const SqliteDesktopCoordinatorOptions(),
  })  : _database = database,
        _ownsDatabase = false {
    _initialize(options);
  }

  static Database _openPath(String path) {
    if (path.isEmpty) {
      throw ArgumentError.value(path, 'path', 'must not be empty');
    }
    return sqlite3.open(path);
  }

  final Database _database;
  final bool _ownsDatabase;
  bool _closed = false;

  void _initialize(SqliteDesktopCoordinatorOptions options) {
    final busyTimeoutMs = _validateDurationMs(
      'busyTimeout',
      options.busyTimeout,
      minimum: 0,
      maximum: 60000,
    );
    if (options.initializePragmas) {
      _database
        ..execute('PRAGMA busy_timeout = $busyTimeoutMs')
        ..execute('PRAGMA foreign_keys = ON')
        ..execute('PRAGMA journal_mode = WAL')
        ..execute('PRAGMA synchronous = FULL');
    }
    _database.execute('''
      CREATE TABLE IF NOT EXISTS $_coordinationTable (
        lease_key TEXT PRIMARY KEY NOT NULL,
        owner_token TEXT,
        fence INTEGER NOT NULL DEFAULT 0 CHECK (fence >= 0),
        expires_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (expires_at_ms >= 0),
        wake_generation INTEGER NOT NULL DEFAULT 0
          CHECK (wake_generation >= 0),
        handled_generation INTEGER NOT NULL DEFAULT 0 CHECK (
          handled_generation >= 0 AND handled_generation <= wake_generation
        ),
        updated_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (updated_at_ms >= 0)
      ) STRICT
    ''');
  }

  void close() {
    if (_closed) return;
    _closed = true;
    if (_ownsDatabase) _database.close();
  }

  SqliteDesktopWakeReceipt signalWake(String key) {
    _ensureOpen();
    _validateIdentifier('lease key', key);
    return _transaction<SqliteDesktopWakeReceipt>(() {
      final nowMs = _storeNowMs();
      _ensureRow(key, nowMs);
      final before = _readRow(key);
      if (_parseGeneration('wake generation', before.wakeGeneration) >=
          _maximumGeneration) {
        throw StateError(
          'wake generation exhausted SQLite signed 64-bit range',
        );
      }
      _database.execute(
        '''
        UPDATE $_coordinationTable
           SET wake_generation = wake_generation + 1,
               updated_at_ms = ?
         WHERE lease_key = ?
        ''',
        <Object?>[nowMs, key],
      );
      final row = _readRow(key);
      return SqliteDesktopWakeReceipt(
        generation: row.wakeGeneration,
        handledGeneration: row.handledGeneration,
        dirty: row.wakeGeneration != row.handledGeneration,
        retryAfterMs: row.ownerToken == null
            ? 0
            : _nonNegativeDifference(row.expiresAtMs, nowMs),
      );
    });
  }

  SqliteDesktopAcquireResult acquire(SqliteDesktopAcquireRequest request) {
    _ensureOpen();
    _validateIdentifier('lease key', request.key);
    _validateIdentifier('owner id', request.ownerId);
    _validateIdentifier('owner token', request.token);
    final leaseTtlMs = _validateDurationMs(
      'leaseTtl',
      request.leaseTtl,
      minimum: _minimumLeaseTtlMs,
      maximum: _maximumLeaseTtlMs,
    );

    return _transaction<SqliteDesktopAcquireResult>(() {
      final nowMs = _storeNowMs();
      _ensureRow(request.key, nowMs);
      final current = _readRow(request.key);
      if (current.ownerToken != null && current.expiresAtMs > nowMs) {
        return SqliteDesktopBusy(
          retryAfterMs: current.expiresAtMs - nowMs,
          wakeGeneration: current.wakeGeneration,
          handledGeneration: current.handledGeneration,
        );
      }
      if (_parseGeneration('fence', current.fence) >= _maximumGeneration) {
        throw StateError('lease fence exhausted SQLite signed 64-bit range');
      }

      final expiresAtMs = nowMs + leaseTtlMs;
      _database.execute(
        '''
        UPDATE $_coordinationTable
           SET owner_token = ?,
               fence = fence + 1,
               expires_at_ms = ?,
               updated_at_ms = ?
         WHERE lease_key = ?
        ''',
        <Object?>[
          request.token,
          expiresAtMs,
          nowMs,
          request.key,
        ],
      );
      final granted = _readRow(request.key);
      return SqliteDesktopAcquired(
        SqliteDesktopLeaseGrant(
          key: request.key,
          ownerId: request.ownerId,
          token: request.token,
          fence: granted.fence,
          acquiredAtMs: nowMs,
          expiresAtMs: granted.expiresAtMs,
          wakeGeneration: granted.wakeGeneration,
          handledGeneration: granted.handledGeneration,
        ),
      );
    });
  }

  @override
  Future<DesktopLeaseGrant?> tryAcquire(DesktopLeaseRequest request) async {
    final result = acquire(
      SqliteDesktopAcquireRequest(
        key: request.key,
        ownerId: request.ownerId,
        token: request.token,
        leaseTtl: request.expiresAt.difference(request.now),
      ),
    );
    return switch (result) {
      SqliteDesktopAcquired(:final grant) => grant.desktopGrant,
      SqliteDesktopBusy() => null,
    };
  }

  SqliteDesktopLeaseGrant? renew(
    SqliteDesktopLeaseGrant grant,
    Duration leaseTtl,
  ) {
    _ensureOpen();
    _validateGrant(grant.desktopGrant);
    final leaseTtlMs = _validateDurationMs(
      'leaseTtl',
      leaseTtl,
      minimum: _minimumLeaseTtlMs,
      maximum: _maximumLeaseTtlMs,
    );
    return _transaction<SqliteDesktopLeaseGrant?>(() {
      final nowMs = _storeNowMs();
      final expiresAtMs = nowMs + leaseTtlMs;
      _database.execute(
        '''
        UPDATE $_coordinationTable
           SET expires_at_ms = ?, updated_at_ms = ?
         WHERE lease_key = ?
           AND owner_token = ?
           AND fence = ?
           AND expires_at_ms > ?
        ''',
        <Object?>[
          expiresAtMs,
          nowMs,
          grant.key,
          grant.token,
          _parseGeneration('fence', grant.fence),
          nowMs,
        ],
      );
      if (_database.updatedRows != 1) return null;
      final row = _readRow(grant.key);
      return grant.copyWith(
        expiresAtMs: row.expiresAtMs,
        wakeGeneration: row.wakeGeneration,
        handledGeneration: row.handledGeneration,
      );
    });
  }

  SqliteDesktopCompletion complete(
    SqliteDesktopLeaseGrant grant,
    String observedWakeGeneration,
  ) {
    _ensureOpen();
    _validateGrant(grant.desktopGrant);
    final observed = _parseGeneration(
      'observed wake generation',
      observedWakeGeneration,
    );

    return _transaction<SqliteDesktopCompletion>(() {
      final nowMs = _storeNowMs();
      final row = _readOwnedUnexpiredRow(grant.desktopGrant, nowMs);
      final wake = _parseGeneration('wake generation', row.wakeGeneration);
      final handled = _parseGeneration(
        'handled generation',
        row.handledGeneration,
      );
      if (observed > wake) {
        throw ArgumentError.value(
          observedWakeGeneration,
          'observedWakeGeneration',
          'is ahead of durable state',
        );
      }
      final nextHandled = observed > handled ? observed : handled;
      final released = observed == wake;
      _database.execute(
        '''
        UPDATE $_coordinationTable
           SET handled_generation = ?,
               owner_token = CASE WHEN ? = 1 THEN NULL ELSE owner_token END,
               expires_at_ms = CASE WHEN ? = 1 THEN 0 ELSE expires_at_ms END,
               updated_at_ms = ?
         WHERE lease_key = ?
           AND owner_token = ?
           AND fence = ?
           AND expires_at_ms > ?
        ''',
        <Object?>[
          nextHandled,
          released ? 1 : 0,
          released ? 1 : 0,
          nowMs,
          grant.key,
          grant.token,
          _parseGeneration('fence', grant.fence),
          nowMs,
        ],
      );
      if (_database.updatedRows != 1) {
        throw const StaleSqliteDesktopFenceException();
      }
      return SqliteDesktopCompletion(
        released: released,
        currentWakeGeneration: wake.toString(),
        handledGeneration: nextHandled.toString(),
      );
    });
  }

  void releaseLease(DesktopLeaseGrant grant) {
    _ensureOpen();
    _validateGrant(grant);
    _transaction<void>(() {
      final nowMs = _storeNowMs();
      _database.execute(
        '''
        UPDATE $_coordinationTable
           SET owner_token = NULL, expires_at_ms = 0, updated_at_ms = ?
         WHERE lease_key = ?
           AND owner_token = ?
           AND fence = ?
        ''',
        <Object?>[
          nowMs,
          grant.key,
          grant.token,
          _parseGeneration('fence', grant.fence),
        ],
      );
    });
  }

  @override
  Future<void> release(DesktopLeaseGrant grant) async {
    releaseLease(grant);
  }

  T withFencedWrite<T>(
    DesktopLeaseGrant grant,
    T Function(CommonDatabase database) write,
  ) {
    _ensureOpen();
    _validateGrant(grant);
    return _transaction<T>(() {
      final beforeMs = _storeNowMs();
      _readOwnedUnexpiredRow(grant, beforeMs);
      final result = write(_database);
      final afterMs = _storeNowMs();
      _readOwnedUnexpiredRow(grant, afterMs);
      return result;
    });
  }

  void assertCurrentFence(DesktopLeaseGrant grant) {
    _ensureOpen();
    _validateGrant(grant);
    _transaction<void>(() {
      _readOwnedUnexpiredRow(grant, _storeNowMs());
    });
  }

  SqliteDesktopState readState(String key) {
    _ensureOpen();
    _validateIdentifier('lease key', key);
    return _transaction<SqliteDesktopState>(() {
      final nowMs = _storeNowMs();
      _ensureRow(key, nowMs);
      final row = _readRow(key);
      return SqliteDesktopState(
        key: key,
        fence: row.fence,
        expiresAtMs: row.expiresAtMs,
        wakeGeneration: row.wakeGeneration,
        handledGeneration: row.handledGeneration,
        dirty: row.wakeGeneration != row.handledGeneration,
        owned: row.ownerToken != null && row.expiresAtMs > nowMs,
        retryAfterMs: row.ownerToken == null
            ? 0
            : _nonNegativeDifference(row.expiresAtMs, nowMs),
      );
    });
  }

  void _validateGrant(DesktopLeaseGrant grant) {
    _validateIdentifier('lease key', grant.key);
    _validateIdentifier('owner token', grant.token);
    _parseGeneration('fence', grant.fence);
  }

  _CoordinationRow _readOwnedUnexpiredRow(
    DesktopLeaseGrant grant,
    int nowMs,
  ) {
    final row = _readRow(grant.key);
    if (row.ownerToken != grant.token ||
        row.fence != grant.fence ||
        row.expiresAtMs <= nowMs) {
      throw const StaleSqliteDesktopFenceException();
    }
    return row;
  }

  void _ensureRow(String key, int nowMs) {
    _database.execute(
      '''
      INSERT INTO $_coordinationTable (
        lease_key, owner_token, fence, expires_at_ms,
        wake_generation, handled_generation, updated_at_ms
      ) VALUES (?, NULL, 0, 0, 0, 0, ?)
      ON CONFLICT(lease_key) DO NOTHING
      ''',
      <Object?>[key, nowMs],
    );
  }

  _CoordinationRow _readRow(String key) {
    final rows = _database.select(
      '''
      SELECT owner_token,
             CAST(fence AS TEXT) AS fence,
             expires_at_ms,
             CAST(wake_generation AS TEXT) AS wake_generation,
             CAST(handled_generation AS TEXT) AS handled_generation
        FROM $_coordinationTable
       WHERE lease_key = ?
      ''',
      <Object?>[key],
    );
    if (rows.length != 1) {
      throw StateError('SQLite coordination row disappeared');
    }
    final row = rows.single;
    return _CoordinationRow(
      ownerToken: _asNullableString(row['owner_token'], 'owner token'),
      fence: _asString(row['fence'], 'fence'),
      expiresAtMs: _asInt(row['expires_at_ms'], 'lease expiry'),
      wakeGeneration: _asString(row['wake_generation'], 'wake generation'),
      handledGeneration: _asString(
        row['handled_generation'],
        'handled generation',
      ),
    );
  }

  int _storeNowMs() {
    final rows = _database.select(
      "SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now_ms",
    );
    if (rows.length != 1) {
      throw StateError('SQLite store clock returned no row');
    }
    return _asInt(rows.single['now_ms'], 'store clock');
  }

  T _transaction<T>(T Function() work) {
    _database.execute('BEGIN IMMEDIATE');
    try {
      final result = work();
      _database.execute('COMMIT');
      return result;
    } catch (_) {
      try {
        _database.execute('ROLLBACK');
      } catch (_) {
        // Preserve the original failure. Subsequent work will fail rather than
        // turning a transaction error into a false acknowledgement.
      }
      rethrow;
    }
  }

  void _ensureOpen() {
    if (_closed) {
      throw StateError('desktop SQLite coordinator is closed');
    }
  }
}

final class SqliteDesktopSyncCycleContext {
  const SqliteDesktopSyncCycleContext({
    required this.cancellation,
    required this.reasons,
    required this.ownerId,
    required this.leaseKey,
    required this.fence,
    required this.wakeGeneration,
    required this.grant,
    required this.coordinator,
  });

  final BackgroundSyncContext cancellation;
  final List<DesktopWakeReason> reasons;
  final String ownerId;
  final String leaseKey;
  final String fence;
  final String wakeGeneration;
  final SqliteDesktopLeaseGrant grant;
  final SqliteDesktopCoordinator coordinator;
  DateTime get deadline => cancellation.deadline;
}

typedef SqliteDesktopSyncCycle<R> = Future<R> Function(
  SqliteDesktopSyncCycleContext context,
);

enum SqliteDesktopFailurePhase { acquire, cycle, complete, renew, release }

final class SqliteDesktopSyncOutcome<R> {
  const SqliteDesktopSyncOutcome({
    required this.status,
    required this.reasons,
    required this.startedAt,
    required this.finishedAt,
    this.fence,
    this.wakeGeneration,
    this.handledGeneration,
    this.result,
    this.retryAfterMs,
    this.failurePhase,
    this.error,
    this.stackTrace,
  });

  final DesktopSyncOutcomeStatus status;
  final List<DesktopWakeReason> reasons;
  final DateTime startedAt;
  final DateTime finishedAt;
  final String? fence;
  final String? wakeGeneration;
  final String? handledGeneration;
  final R? result;
  final int? retryAfterMs;
  final SqliteDesktopFailurePhase? failurePhase;
  final Object? error;
  final StackTrace? stackTrace;
}

final class SqliteDesktopDrainResult<R> {
  const SqliteDesktopDrainResult(this.outcomes);

  final List<SqliteDesktopSyncOutcome<R>> outcomes;
}

final Random _secureRandom = Random.secure();

String _secureToken() {
  final bytes = List<int>.generate(
    18,
    (_) => _secureRandom.nextInt(256),
    growable: false,
  );
  return base64Url.encode(bytes).replaceAll('=', '');
}

/// Persistent native Dart/Flutter runner that commits every wake before
/// acquisition, retries busy leases through the current lease horizon, and
/// rechecks the durable generation before release.
final class SqliteCoordinatedDesktopSyncRunner<R> {
  SqliteCoordinatedDesktopSyncRunner({
    required SqliteDesktopCoordinator coordinator,
    required String leaseKey,
    required String ownerId,
    required SqliteDesktopSyncCycle<R> syncOnce,
    this.budget = const Duration(seconds: 25),
    Duration? leaseTtl,
    this.busyRetryCap = const Duration(seconds: 1),
    Duration? busyWaitBudget,
    DateTime Function()? now,
    String Function()? tokenFactory,
    void Function(SqliteDesktopSyncOutcome<R> outcome)? onOutcome,
  })  : _coordinator = coordinator,
        _leaseKey = leaseKey,
        _ownerId = ownerId,
        _syncOnce = syncOnce,
        leaseTtl = leaseTtl ?? budget + const Duration(seconds: 5),
        busyWaitBudget = busyWaitBudget ??
            (leaseTtl ?? budget + const Duration(seconds: 5)) +
                const Duration(seconds: 1),
        _now = now ?? DateTime.now,
        _tokenFactory = tokenFactory ?? _secureToken,
        _onOutcome = onOutcome {
    _validateIdentifier('leaseKey', leaseKey);
    _validateIdentifier('ownerId', ownerId);
    _validateDurationMs(
      'budget',
      budget,
      minimum: 1000,
      maximum: 10 * 60 * 1000,
    );
    _validateDurationMs(
      'leaseTtl',
      this.leaseTtl,
      minimum: _minimumLeaseTtlMs,
      maximum: _maximumLeaseTtlMs,
    );
    if (this.leaseTtl < budget + const Duration(seconds: 1)) {
      throw ArgumentError.value(
        this.leaseTtl,
        'leaseTtl',
        'must cover budget plus one second',
      );
    }
    final busyRetryCapMs = _validateDurationMs(
      'busyRetryCap',
      busyRetryCap,
      minimum: 1,
      maximum: this.leaseTtl.inMilliseconds,
    );
    final busyWaitBudgetMs = _validateDurationMs(
      'busyWaitBudget',
      this.busyWaitBudget,
      minimum: busyRetryCapMs,
      maximum: 2 * _maximumLeaseTtlMs,
    );
    if (busyWaitBudgetMs < busyRetryCapMs) {
      throw ArgumentError.value(
        this.busyWaitBudget,
        'busyWaitBudget',
        'must cover busyRetryCap',
      );
    }
  }

  final SqliteDesktopCoordinator _coordinator;
  final String _leaseKey;
  final String _ownerId;
  final SqliteDesktopSyncCycle<R> _syncOnce;
  final DateTime Function() _now;
  final String Function() _tokenFactory;
  final void Function(SqliteDesktopSyncOutcome<R> outcome)? _onOutcome;
  final Duration budget;
  final Duration leaseTtl;
  final Duration busyRetryCap;
  final Duration busyWaitBudget;
  final Set<DesktopWakeReason> _pendingReasons = <DesktopWakeReason>{};
  Future<SqliteDesktopDrainResult<R>>? _drain;
  BackgroundSyncContext? _activeContext;
  bool _closed = false;

  bool get isClosed => _closed;

  Future<SqliteDesktopDrainResult<R>> wake([
    DesktopWakeReason reason = DesktopWakeReason.manual,
  ]) {
    if (_closed) {
      return Future<SqliteDesktopDrainResult<R>>.error(
        StateError('desktop SQLite sync runner is closed'),
      );
    }
    try {
      _coordinator.signalWake(_leaseKey);
    } catch (error, stackTrace) {
      final now = _now();
      final outcome = SqliteDesktopSyncOutcome<R>(
        status: DesktopSyncOutcomeStatus.failed,
        reasons: <DesktopWakeReason>[reason],
        startedAt: now,
        finishedAt: now,
        failurePhase: SqliteDesktopFailurePhase.acquire,
        error: error,
        stackTrace: stackTrace,
      );
      _onOutcome?.call(outcome);
      return Future<SqliteDesktopDrainResult<R>>.value(
        SqliteDesktopDrainResult<R>(
          List<SqliteDesktopSyncOutcome<R>>.unmodifiable(
            <SqliteDesktopSyncOutcome<R>>[outcome],
          ),
        ),
      );
    }

    _pendingReasons.add(reason);
    final current = _drain;
    if (current != null) return current;
    final running = _drainPending();
    _drain = running;
    unawaited(
      running.then<void>(
        (_) => _clearDrain(running),
        onError: (_, __) => _clearDrain(running),
      ),
    );
    return running;
  }

  Future<SqliteDesktopDrainResult<R>> runNow() => wake();

  void close() {
    if (_closed) return;
    _closed = true;
    _pendingReasons.clear();
    _activeContext?.cancel('desktop SQLite sync runner closed');
  }

  void _clearDrain(Future<SqliteDesktopDrainResult<R>> running) {
    if (identical(_drain, running)) _drain = null;
  }

  Future<SqliteDesktopDrainResult<R>> _drainPending() async {
    final outcomes = <SqliteDesktopSyncOutcome<R>>[];
    while (!_closed && _pendingReasons.isNotEmpty) {
      final reasons = _sortedReasons(_pendingReasons);
      _pendingReasons.clear();
      final produced = await _runUntilReleased(reasons);
      for (final outcome in produced) {
        outcomes.add(outcome);
        _onOutcome?.call(outcome);
      }
    }
    return SqliteDesktopDrainResult<R>(List.unmodifiable(outcomes));
  }

  Future<List<SqliteDesktopSyncOutcome<R>>> _runUntilReleased(
    List<DesktopWakeReason> initialReasons,
  ) async {
    final outcomes = <SqliteDesktopSyncOutcome<R>>[];
    final cycleReasons = <DesktopWakeReason>{...initialReasons};
    final waitWatch = Stopwatch()..start();

    List<DesktopWakeReason> currentReasons() => _sortedReasons(cycleReasons);

    void absorbPendingReasons() {
      cycleReasons.addAll(_pendingReasons);
      _pendingReasons.clear();
    }

    SqliteDesktopLeaseGrant? grant;
    while (grant == null) {
      absorbPendingReasons();
      if (_closed) {
        final now = _now();
        return <SqliteDesktopSyncOutcome<R>>[
          SqliteDesktopSyncOutcome<R>(
            status: DesktopSyncOutcomeStatus.failed,
            reasons: currentReasons(),
            startedAt: now,
            finishedAt: now,
            failurePhase: SqliteDesktopFailurePhase.acquire,
            error: StateError('desktop SQLite sync runner is closed'),
          ),
        ];
      }
      final token = _tokenFactory();
      _validateIdentifier('tokenFactory result', token);
      SqliteDesktopAcquireResult acquisition;
      try {
        acquisition = _coordinator.acquire(
          SqliteDesktopAcquireRequest(
            key: _leaseKey,
            ownerId: _ownerId,
            token: token,
            leaseTtl: leaseTtl,
          ),
        );
      } catch (error, stackTrace) {
        final now = _now();
        return <SqliteDesktopSyncOutcome<R>>[
          SqliteDesktopSyncOutcome<R>(
            status: DesktopSyncOutcomeStatus.failed,
            reasons: currentReasons(),
            startedAt: now,
            finishedAt: now,
            failurePhase: SqliteDesktopFailurePhase.acquire,
            error: error,
            stackTrace: stackTrace,
          ),
        ];
      }

      switch (acquisition) {
        case SqliteDesktopAcquired(grant: final acquiredGrant):
          grant = acquiredGrant;
        case SqliteDesktopBusy(
            :final retryAfterMs,
            :final wakeGeneration,
            :final handledGeneration,
          ):
          if (waitWatch.elapsed >= busyWaitBudget) {
            final now = _now();
            return <SqliteDesktopSyncOutcome<R>>[
              SqliteDesktopSyncOutcome<R>(
                status: DesktopSyncOutcomeStatus.busy,
                reasons: currentReasons(),
                startedAt: now.subtract(waitWatch.elapsed),
                finishedAt: now,
                wakeGeneration: wakeGeneration,
                handledGeneration: handledGeneration,
                retryAfterMs: retryAfterMs,
              ),
            ];
          }
          final remainingMs =
              busyWaitBudget.inMilliseconds - waitWatch.elapsedMilliseconds;
          final delayMs = min(
            busyRetryCap.inMilliseconds,
            min(retryAfterMs <= 0 ? busyRetryCap.inMilliseconds : retryAfterMs,
                remainingMs),
          );
          await Future<void>.delayed(Duration(milliseconds: max(1, delayMs)));
      }
    }

    absorbPendingReasons();
    while (true) {
      final startedAt = _now();
      final cancellation = BackgroundSyncContext(budget);
      _activeContext = cancellation;
      Timer? deadline;
      R? result;
      Object? cycleError;
      StackTrace? cycleStackTrace;
      try {
        deadline = Timer(
          budget,
          () => cancellation.cancel('desktop SQLite sync deadline exceeded'),
        );
        result = await _syncOnce(
          SqliteDesktopSyncCycleContext(
            cancellation: cancellation,
            reasons: currentReasons(),
            ownerId: _ownerId,
            leaseKey: _leaseKey,
            fence: grant.fence,
            wakeGeneration: grant.wakeGeneration,
            grant: grant,
            coordinator: _coordinator,
          ),
        );
        cancellation.throwIfCancelled();
      } catch (error, stackTrace) {
        cycleError = error;
        cycleStackTrace = stackTrace;
      } finally {
        deadline?.cancel();
        if (identical(_activeContext, cancellation)) _activeContext = null;
      }

      if (cycleError != null) {
        Object? releaseError;
        StackTrace? releaseStackTrace;
        try {
          _coordinator.releaseLease(grant.desktopGrant);
        } catch (error, stackTrace) {
          releaseError = error;
          releaseStackTrace = stackTrace;
        }
        outcomes.add(
          SqliteDesktopSyncOutcome<R>(
            status: DesktopSyncOutcomeStatus.failed,
            reasons: currentReasons(),
            startedAt: startedAt,
            finishedAt: _now(),
            fence: grant.fence,
            wakeGeneration: grant.wakeGeneration,
            handledGeneration: grant.handledGeneration,
            failurePhase: releaseError == null
                ? SqliteDesktopFailurePhase.cycle
                : SqliteDesktopFailurePhase.release,
            error: releaseError ?? cycleError,
            stackTrace: releaseStackTrace ?? cycleStackTrace,
          ),
        );
        return outcomes;
      }

      SqliteDesktopCompletion completion;
      try {
        completion = _coordinator.complete(grant, grant.wakeGeneration);
      } catch (error, stackTrace) {
        outcomes.add(
          SqliteDesktopSyncOutcome<R>(
            status: DesktopSyncOutcomeStatus.failed,
            reasons: currentReasons(),
            startedAt: startedAt,
            finishedAt: _now(),
            fence: grant.fence,
            wakeGeneration: grant.wakeGeneration,
            handledGeneration: grant.handledGeneration,
            result: result,
            failurePhase: SqliteDesktopFailurePhase.complete,
            error: error,
            stackTrace: stackTrace,
          ),
        );
        return outcomes;
      }
      outcomes.add(
        SqliteDesktopSyncOutcome<R>(
          status: DesktopSyncOutcomeStatus.completed,
          reasons: currentReasons(),
          startedAt: startedAt,
          finishedAt: _now(),
          fence: grant.fence,
          wakeGeneration: grant.wakeGeneration,
          handledGeneration: completion.handledGeneration,
          result: result,
        ),
      );
      if (completion.released) return outcomes;

      absorbPendingReasons();
      final renewed = _coordinator.renew(grant, leaseTtl);
      if (renewed == null) {
        final now = _now();
        outcomes.add(
          SqliteDesktopSyncOutcome<R>(
            status: DesktopSyncOutcomeStatus.failed,
            reasons: currentReasons(),
            startedAt: now,
            finishedAt: now,
            fence: grant.fence,
            wakeGeneration: completion.currentWakeGeneration,
            handledGeneration: completion.handledGeneration,
            failurePhase: SqliteDesktopFailurePhase.renew,
            error: const StaleSqliteDesktopFenceException(
              'lease renewal failed before trailing cycle',
            ),
          ),
        );
        return outcomes;
      }
      grant = renewed.copyWith(
        wakeGeneration: completion.currentWakeGeneration,
        handledGeneration: completion.handledGeneration,
      );
    }
  }
}

List<DesktopWakeReason> _sortedReasons(Iterable<DesktopWakeReason> reasons) {
  final sorted = reasons.toList(growable: false)
    ..sort((left, right) => left.index.compareTo(right.index));
  return List<DesktopWakeReason>.unmodifiable(sorted);
}
