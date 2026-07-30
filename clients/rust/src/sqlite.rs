//! First-party SQLite durability for protocol v1.
//!
//! The adapter stores the serialized [`ProtocolQueue`], an authoritative
//! record cache, and an optimistic local view. All mutating operations use
//! `BEGIN IMMEDIATE`, so independent processes cannot allocate the same
//! mutation id or race past queue limits.

use crate::protocol::{
    Change, Operation, ProtocolError, ProtocolQueue, PushRequest, PushResponse, ResultStatus,
    SnapshotRecord, DEFAULT_MAX_PENDING_MUTATIONS, DEFAULT_MAX_QUEUED_PAYLOAD_BYTES,
};
use crate::protocol_sync::AtomicProtocolSyncStore;
use crate::{reconcile, ReconcileOptions};
use rusqlite::{
    params, Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior,
};
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;
use std::time::Duration;

const SCHEMA_VERSION: i64 = 1;

#[derive(Debug)]
pub enum SqliteStoreError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    Protocol(ProtocolError),
    Application(String),
    ClientMismatch { expected: String, actual: String },
    UnsupportedSchema(i64),
    InvalidRecord(&'static str),
}

impl std::fmt::Display for SqliteStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(error) => write!(formatter, "SQLite operation failed: {error}"),
            Self::Json(error) => write!(formatter, "durable JSON state is invalid: {error}"),
            Self::Protocol(error) => write!(formatter, "{error}"),
            Self::Application(message) => {
                write!(formatter, "application transaction failed: {message}")
            }
            Self::ClientMismatch { expected, actual } => write!(
                formatter,
                "SQLite queue belongs to client {actual:?}, not {expected:?}"
            ),
            Self::UnsupportedSchema(version) => {
                write!(
                    formatter,
                    "unsupported opto-sync SQLite schema version {version}"
                )
            }
            Self::InvalidRecord(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for SqliteStoreError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Sqlite(error) => Some(error),
            Self::Json(error) => Some(error),
            Self::Protocol(error) => Some(error),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for SqliteStoreError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

impl From<serde_json::Error> for SqliteStoreError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl From<ProtocolError> for SqliteStoreError {
    fn from(value: ProtocolError) -> Self {
        Self::Protocol(value)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SqliteRecord {
    pub table: String,
    pub record_id: String,
    pub record: Value,
    pub revision: Option<String>,
}

pub struct SqliteProtocolStore {
    connection: Connection,
}

impl SqliteProtocolStore {
    pub fn open(
        path: impl AsRef<Path>,
        client_id: impl Into<String>,
    ) -> Result<Self, SqliteStoreError> {
        Self::open_with_limits(
            path,
            client_id,
            DEFAULT_MAX_PENDING_MUTATIONS,
            DEFAULT_MAX_QUEUED_PAYLOAD_BYTES,
        )
    }

    pub fn open_with_limits(
        path: impl AsRef<Path>,
        client_id: impl Into<String>,
        max_pending_mutations: usize,
        max_queued_payload_bytes: usize,
    ) -> Result<Self, SqliteStoreError> {
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
        )?;
        Self::initialize(
            connection,
            client_id.into(),
            max_pending_mutations,
            max_queued_payload_bytes,
        )
    }

    pub fn open_in_memory(client_id: impl Into<String>) -> Result<Self, SqliteStoreError> {
        Self::initialize(
            Connection::open_in_memory()?,
            client_id.into(),
            DEFAULT_MAX_PENDING_MUTATIONS,
            DEFAULT_MAX_QUEUED_PAYLOAD_BYTES,
        )
    }

    fn initialize(
        mut connection: Connection,
        client_id: String,
        max_pending_mutations: usize,
        max_queued_payload_bytes: usize,
    ) -> Result<Self, SqliteStoreError> {
        connection.busy_timeout(Duration::from_secs(10))?;
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA foreign_keys = ON;
             PRAGMA trusted_schema = OFF;",
        )?;

        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS _opto_sync_meta (
               key TEXT PRIMARY KEY NOT NULL,
               value TEXT NOT NULL
             ) STRICT;
             CREATE TABLE IF NOT EXISTS _opto_sync_protocol_state (
               singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
               queue_json TEXT NOT NULL CHECK (json_valid(queue_json))
             ) STRICT;
             CREATE TABLE IF NOT EXISTS _opto_sync_authoritative (
               table_name TEXT NOT NULL,
               record_id TEXT NOT NULL,
               record_json TEXT NOT NULL CHECK (json_valid(record_json)),
               revision TEXT NOT NULL,
               PRIMARY KEY (table_name, record_id)
             ) STRICT;
             CREATE TABLE IF NOT EXISTS _opto_sync_local (
               table_name TEXT NOT NULL,
               record_id TEXT NOT NULL,
               record_json TEXT NOT NULL CHECK (json_valid(record_json)),
               PRIMARY KEY (table_name, record_id)
             ) STRICT;
             CREATE TABLE IF NOT EXISTS _opto_sync_accepted_overlays (
               mutation_id INTEGER PRIMARY KEY NOT NULL CHECK (mutation_id > 0),
               table_name TEXT NOT NULL,
               record_id TEXT NOT NULL,
               operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
               payload_json TEXT CHECK (
                 (operation = 'upsert' AND payload_json IS NOT NULL
                   AND json_valid(payload_json))
                 OR
                 (operation = 'delete' AND payload_json IS NULL)
               ),
               acknowledgement_checkpoint TEXT NOT NULL
             ) STRICT;",
        )?;
        transaction.execute(
            "INSERT OR IGNORE INTO _opto_sync_meta(key, value)
             VALUES ('schema_version', ?1)",
            [SCHEMA_VERSION.to_string()],
        )?;
        let schema: String = transaction.query_row(
            "SELECT value FROM _opto_sync_meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )?;
        let schema = schema
            .parse::<i64>()
            .map_err(|_| SqliteStoreError::UnsupportedSchema(-1))?;
        if schema != SCHEMA_VERSION {
            return Err(SqliteStoreError::UnsupportedSchema(schema));
        }

        let initial = ProtocolQueue::with_limits(
            client_id.clone(),
            max_pending_mutations,
            max_queued_payload_bytes,
        )?;
        transaction.execute(
            "INSERT OR IGNORE INTO _opto_sync_protocol_state(singleton, queue_json)
             VALUES (1, ?1)",
            [serde_json::to_string(&initial)?],
        )?;
        let queue = load_queue_from(&transaction)?;
        if queue.client_id() != client_id {
            return Err(SqliteStoreError::ClientMismatch {
                expected: client_id,
                actual: queue.client_id().to_string(),
            });
        }
        transaction.commit()?;
        Ok(Self { connection })
    }

    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    pub fn connection_mut(&mut self) -> &mut Connection {
        &mut self.connection
    }

    pub fn load_queue(&self) -> Result<ProtocolQueue, SqliteStoreError> {
        load_queue_from(&self.connection)
    }

    /// Queue an upsert and let application SQL participate in the same commit.
    pub fn queue_upsert_with<F>(
        &mut self,
        table: impl Into<String>,
        record_id: impl Into<String>,
        payload: Value,
        base_revision: Option<String>,
        resurrect: bool,
        apply_optimistic: F,
    ) -> Result<String, SqliteStoreError>
    where
        F: FnOnce(&Transaction<'_>, &str, &Value) -> Result<(), SqliteStoreError>,
    {
        let table = table.into();
        let record_id = record_id.into();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut queue = load_queue_from(&transaction)?;
        let mutation_id =
            queue.queue_upsert(table, record_id, payload.clone(), base_revision, resurrect)?;
        apply_optimistic(&transaction, &mutation_id, &payload)?;
        persist_queue_in(&transaction, &queue)?;
        transaction.commit()?;
        Ok(mutation_id)
    }

    /// Queue a delete and let application SQL participate in the same commit.
    pub fn queue_delete_with<F>(
        &mut self,
        table: impl Into<String>,
        record_id: impl Into<String>,
        base_revision: Option<String>,
        apply_optimistic: F,
    ) -> Result<String, SqliteStoreError>
    where
        F: FnOnce(&Transaction<'_>, &str) -> Result<(), SqliteStoreError>,
    {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut queue = load_queue_from(&transaction)?;
        let mutation_id = queue.queue_delete(table, record_id, base_revision)?;
        apply_optimistic(&transaction, &mutation_id)?;
        persist_queue_in(&transaction, &queue)?;
        transaction.commit()?;
        Ok(mutation_id)
    }

    /// Queue and materialize an optimistic record in the reference local view.
    pub fn queue_upsert_record(
        &mut self,
        table: impl Into<String>,
        record_id: impl Into<String>,
        payload: Value,
        base_revision: Option<String>,
        resurrect: bool,
    ) -> Result<String, SqliteStoreError> {
        let table = table.into();
        let record_id = record_id.into();
        let table_for_write = table.clone();
        let id_for_write = record_id.clone();
        self.queue_upsert_with(
            table,
            record_id,
            payload,
            base_revision,
            resurrect,
            move |transaction, _, payload| {
                overlay_local_record(transaction, &table_for_write, &id_for_write, payload)
            },
        )
    }

    pub fn queue_delete_record(
        &mut self,
        table: impl Into<String>,
        record_id: impl Into<String>,
        base_revision: Option<String>,
    ) -> Result<String, SqliteStoreError> {
        let table = table.into();
        let record_id = record_id.into();
        let table_for_delete = table.clone();
        let id_for_delete = record_id.clone();
        self.queue_delete_with(table, record_id, base_revision, move |transaction, _| {
            transaction.execute(
                "DELETE FROM _opto_sync_local
                     WHERE table_name = ?1 AND record_id = ?2",
                params![table_for_delete, id_for_delete],
            )?;
            Ok(())
        })
    }

    pub fn local_record(
        &self,
        table: &str,
        record_id: &str,
    ) -> Result<Option<SqliteRecord>, SqliteStoreError> {
        read_record(
            &self.connection,
            "_opto_sync_local",
            table,
            record_id,
            false,
        )
    }

    pub fn authoritative_record(
        &self,
        table: &str,
        record_id: &str,
    ) -> Result<Option<SqliteRecord>, SqliteStoreError> {
        read_record(
            &self.connection,
            "_opto_sync_authoritative",
            table,
            record_id,
            true,
        )
    }
}

impl AtomicProtocolSyncStore for SqliteProtocolStore {
    type Error = SqliteStoreError;

    fn persist_queue(&mut self, queue: &mut ProtocolQueue) -> Result<(), Self::Error> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        queue.merge_concurrent_durable(&load_queue_from(&transaction)?)?;
        persist_queue_in(&transaction, queue)?;
        transaction.commit()?;
        Ok(())
    }

    fn persist_acknowledgement(
        &mut self,
        queue: &mut ProtocolQueue,
        request: &PushRequest,
        response: &PushResponse,
    ) -> Result<(), Self::Error> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        queue.merge_concurrent_durable(&load_queue_from(&transaction)?)?;
        let mut touched = BTreeSet::new();
        for (sent, result) in request.mutations.iter().zip(&response.results) {
            touched.insert((sent.table.clone(), sent.record_id.clone()));
            let was_accepted = result.status == ResultStatus::Applied
                || (result.status == ResultStatus::Duplicate
                    && result.original_status == Some(ResultStatus::Applied));
            if was_accepted {
                let checkpoint =
                    result
                        .checkpoint
                        .as_deref()
                        .ok_or(SqliteStoreError::InvalidRecord(
                            "accepted mutation result is missing its checkpoint",
                        ))?;
                if !is_canonical_decimal(checkpoint) {
                    return Err(SqliteStoreError::InvalidRecord(
                        "accepted mutation checkpoint is not a canonical decimal",
                    ));
                }
                let mutation_id = sent.mutation_id.parse::<i64>().map_err(|_| {
                    SqliteStoreError::InvalidRecord(
                        "accepted mutation id does not fit SQLite INTEGER",
                    )
                })?;
                let (operation, payload) = match sent.operation {
                    Operation::Upsert => (
                        "upsert",
                        Some(serde_json::to_string(sent.payload.as_ref().ok_or(
                            SqliteStoreError::InvalidRecord(
                                "accepted upsert is missing its payload",
                            ),
                        )?)?),
                    ),
                    Operation::Delete => ("delete", None),
                };
                transaction.execute(
                    "INSERT INTO _opto_sync_accepted_overlays(
                       mutation_id, table_name, record_id, operation,
                       payload_json, acknowledgement_checkpoint
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(mutation_id) DO UPDATE SET
                       table_name = excluded.table_name,
                       record_id = excluded.record_id,
                       operation = excluded.operation,
                       payload_json = excluded.payload_json,
                       acknowledgement_checkpoint =
                         excluded.acknowledgement_checkpoint",
                    params![
                        mutation_id,
                        sent.table,
                        sent.record_id,
                        operation,
                        payload,
                        checkpoint
                    ],
                )?;
            }
        }
        touched.extend(clear_accepted_overlays_through(
            &transaction,
            queue.checkpoint(),
        )?);
        for (table, record_id) in touched {
            rebuild_local_record(&transaction, &table, &record_id, queue)?;
        }
        persist_queue_in(&transaction, queue)?;
        transaction.commit()?;
        Ok(())
    }

    fn apply_changes_and_persist(
        &mut self,
        changes: &[Change],
        queue: &mut ProtocolQueue,
    ) -> Result<(), Self::Error> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        queue.merge_concurrent_durable(&load_queue_from(&transaction)?)?;
        let mut touched = clear_accepted_overlays_through(&transaction, queue.checkpoint())?;
        for change in changes {
            apply_authoritative_change(&transaction, change)?;
            touched.insert((change.table.clone(), change.record_id.clone()));
        }
        for (table, record_id) in touched {
            rebuild_local_record(&transaction, &table, &record_id, queue)?;
        }
        persist_queue_in(&transaction, queue)?;
        transaction.commit()?;
        Ok(())
    }

    fn replace_authoritative_and_persist(
        &mut self,
        records: &[SnapshotRecord],
        queue: &mut ProtocolQueue,
    ) -> Result<(), Self::Error> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        queue.merge_concurrent_durable(&load_queue_from(&transaction)?)?;
        clear_accepted_overlays_through(&transaction, queue.checkpoint())?;
        transaction.execute("DELETE FROM _opto_sync_authoritative", [])?;
        for record in records {
            if !record.record.is_object() {
                return Err(SqliteStoreError::InvalidRecord(
                    "snapshot record must be a JSON object",
                ));
            }
            transaction.execute(
                "INSERT INTO _opto_sync_authoritative(
                   table_name, record_id, record_json, revision
                 ) VALUES (?1, ?2, ?3, ?4)",
                params![
                    record.table,
                    record.record_id,
                    serde_json::to_string(&record.record)?,
                    record.revision
                ],
            )?;
        }
        rebuild_all_local(&transaction, queue)?;
        persist_queue_in(&transaction, queue)?;
        transaction.commit()?;
        Ok(())
    }
}

fn load_queue_from(connection: &Connection) -> Result<ProtocolQueue, SqliteStoreError> {
    let json: String = connection.query_row(
        "SELECT queue_json FROM _opto_sync_protocol_state WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    let queue: ProtocolQueue = serde_json::from_str(&json)?;
    queue.validate()?;
    Ok(queue)
}

fn persist_queue_in(
    connection: &Connection,
    queue: &ProtocolQueue,
) -> Result<(), SqliteStoreError> {
    queue.validate()?;
    let changed = connection.execute(
        "UPDATE _opto_sync_protocol_state SET queue_json = ?1 WHERE singleton = 1",
        [serde_json::to_string(queue)?],
    )?;
    if changed != 1 {
        return Err(SqliteStoreError::InvalidRecord(
            "protocol queue singleton is missing",
        ));
    }
    Ok(())
}

fn overlay_local_record(
    connection: &Connection,
    table: &str,
    record_id: &str,
    payload: &Value,
) -> Result<(), SqliteStoreError> {
    let base: Option<String> = connection
        .query_row(
            "SELECT record_json FROM _opto_sync_local
             WHERE table_name = ?1 AND record_id = ?2",
            params![table, record_id],
            |row| row.get(0),
        )
        .optional()?;
    let options = ReconcileOptions {
        resolve_by_timestamp: false,
        ..ReconcileOptions::default()
    };
    let incoming = serde_json::to_string(payload)?;
    let merged = reconcile(base.as_deref().unwrap_or("{}"), &incoming, &options)
        .map_err(|_| SqliteStoreError::InvalidRecord("optimistic record merge failed"))?;
    write_local_record(connection, table, record_id, &merged)
}

fn apply_authoritative_change(
    connection: &Connection,
    change: &Change,
) -> Result<(), SqliteStoreError> {
    match change.operation {
        Operation::Upsert => {
            let record = change
                .record
                .as_ref()
                .filter(|record| record.is_object())
                .ok_or(SqliteStoreError::InvalidRecord(
                    "upsert change must contain an object record",
                ))?;
            connection.execute(
                "INSERT INTO _opto_sync_authoritative(
                   table_name, record_id, record_json, revision
                 ) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(table_name, record_id) DO UPDATE SET
                   record_json = excluded.record_json,
                   revision = excluded.revision",
                params![
                    change.table,
                    change.record_id,
                    serde_json::to_string(record)?,
                    change.revision
                ],
            )?;
        }
        Operation::Delete => {
            if change.record.is_some() {
                return Err(SqliteStoreError::InvalidRecord(
                    "delete change must not contain a record",
                ));
            }
            connection.execute(
                "DELETE FROM _opto_sync_authoritative
                 WHERE table_name = ?1 AND record_id = ?2",
                params![change.table, change.record_id],
            )?;
        }
    }
    Ok(())
}

fn rebuild_all_local(
    connection: &Connection,
    queue: &ProtocolQueue,
) -> Result<(), SqliteStoreError> {
    let mut keys = BTreeSet::new();
    {
        let mut statement =
            connection.prepare("SELECT table_name, record_id FROM _opto_sync_authoritative")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            keys.insert(row?);
        }
    }
    for mutation in queue.pending() {
        keys.insert((mutation.table.clone(), mutation.record_id.clone()));
    }
    {
        let mut statement =
            connection.prepare("SELECT table_name, record_id FROM _opto_sync_accepted_overlays")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            keys.insert(row?);
        }
    }
    connection.execute("DELETE FROM _opto_sync_local", [])?;
    for (table, record_id) in keys {
        rebuild_local_record(connection, &table, &record_id, queue)?;
    }
    Ok(())
}

fn rebuild_local_record(
    connection: &Connection,
    table: &str,
    record_id: &str,
    queue: &ProtocolQueue,
) -> Result<(), SqliteStoreError> {
    let mut view: Option<String> = connection
        .query_row(
            "SELECT record_json FROM _opto_sync_authoritative
             WHERE table_name = ?1 AND record_id = ?2",
            params![table, record_id],
            |row| row.get(0),
        )
        .optional()?;
    let options = ReconcileOptions {
        resolve_by_timestamp: false,
        ..ReconcileOptions::default()
    };
    {
        let mut statement = connection.prepare(
            "SELECT operation, payload_json
               FROM _opto_sync_accepted_overlays
              WHERE table_name = ?1 AND record_id = ?2
              ORDER BY mutation_id",
        )?;
        let overlays = statement.query_map(params![table, record_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?;
        for overlay in overlays {
            let (operation, payload) = overlay?;
            apply_overlay(&mut view, &operation, payload.as_deref(), &options)?;
        }
    }
    for mutation in queue
        .pending()
        .filter(|mutation| mutation.table == table && mutation.record_id == record_id)
    {
        match mutation.operation {
            Operation::Delete => view = None,
            Operation::Upsert => {
                let incoming = serde_json::to_string(mutation.payload.as_ref().ok_or(
                    SqliteStoreError::InvalidRecord("pending upsert is missing its payload"),
                )?)?;
                apply_overlay(&mut view, "upsert", Some(&incoming), &options)?;
            }
        }
    }
    match view {
        Some(record) => write_local_record(connection, table, record_id, &record),
        None => {
            connection.execute(
                "DELETE FROM _opto_sync_local
                 WHERE table_name = ?1 AND record_id = ?2",
                params![table, record_id],
            )?;
            Ok(())
        }
    }
}

fn apply_overlay(
    view: &mut Option<String>,
    operation: &str,
    payload: Option<&str>,
    options: &ReconcileOptions,
) -> Result<(), SqliteStoreError> {
    match operation {
        "delete" if payload.is_none() => *view = None,
        "upsert" => {
            let payload = payload.ok_or(SqliteStoreError::InvalidRecord(
                "upsert overlay is missing its payload",
            ))?;
            *view = Some(
                reconcile(view.as_deref().unwrap_or("{}"), payload, options)
                    .map_err(|_| SqliteStoreError::InvalidRecord("record overlay failed"))?,
            );
        }
        _ => {
            return Err(SqliteStoreError::InvalidRecord(
                "durable accepted overlay is invalid",
            ));
        }
    }
    Ok(())
}

fn clear_accepted_overlays_through(
    connection: &Connection,
    checkpoint: &str,
) -> Result<BTreeSet<(String, String)>, SqliteStoreError> {
    let through = checkpoint.parse::<u64>().map_err(|_| {
        SqliteStoreError::InvalidRecord("pull checkpoint is not a canonical decimal")
    })?;
    let mut cleared = BTreeSet::new();
    let mut mutation_ids = Vec::new();
    {
        let mut statement = connection.prepare(
            "SELECT mutation_id, table_name, record_id, acknowledgement_checkpoint
               FROM _opto_sync_accepted_overlays",
        )?;
        let overlays = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        for overlay in overlays {
            let (mutation_id, table, record_id, acknowledged_at) = overlay?;
            let acknowledged_at = acknowledged_at.parse::<u64>().map_err(|_| {
                SqliteStoreError::InvalidRecord("durable acknowledgement checkpoint is invalid")
            })?;
            if acknowledged_at <= through {
                mutation_ids.push(mutation_id);
                cleared.insert((table, record_id));
            }
        }
    }
    for mutation_id in mutation_ids {
        connection.execute(
            "DELETE FROM _opto_sync_accepted_overlays WHERE mutation_id = ?1",
            [mutation_id],
        )?;
    }
    Ok(cleared)
}

fn is_canonical_decimal(value: &str) -> bool {
    !value.is_empty()
        && (value == "0" || !value.starts_with('0'))
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && value.parse::<u64>().is_ok()
}

fn write_local_record(
    connection: &Connection,
    table: &str,
    record_id: &str,
    record_json: &str,
) -> Result<(), SqliteStoreError> {
    connection.execute(
        "INSERT INTO _opto_sync_local(table_name, record_id, record_json)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(table_name, record_id) DO UPDATE SET
           record_json = excluded.record_json",
        params![table, record_id, record_json],
    )?;
    Ok(())
}

fn read_record(
    connection: &Connection,
    table_name: &str,
    table: &str,
    record_id: &str,
    has_revision: bool,
) -> Result<Option<SqliteRecord>, SqliteStoreError> {
    let sql = if has_revision {
        "SELECT record_json, revision FROM _opto_sync_authoritative
         WHERE table_name = ?1 AND record_id = ?2"
    } else {
        "SELECT record_json, NULL FROM _opto_sync_local
         WHERE table_name = ?1 AND record_id = ?2"
    };
    debug_assert!(
        matches!(table_name, "_opto_sync_local" | "_opto_sync_authoritative"),
        "table selection is static"
    );
    let row: Option<(String, Option<String>)> = connection
        .query_row(sql, params![table, record_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()?;
    row.map(|(json, revision)| {
        Ok(SqliteRecord {
            table: table.to_string(),
            record_id: record_id.to_string(),
            record: serde_json::from_str(&json)?,
            revision,
        })
    })
    .transpose()
}
