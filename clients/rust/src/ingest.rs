//! Shared JSON/blob ingestion for protocol v1.
//!
//! The canonical shape is `schemas/opto-sync-ingest.v1.schema.json`. This
//! module validates the complete input before cloning and updating a protocol
//! queue, so an invalid or over-quota batch cannot leave partial mutations.

use crate::protocol::{ProtocolError, ProtocolQueue};
use serde::Deserialize;
use serde_json::Value;

#[cfg(feature = "sqlite")]
use crate::protocol_sync::AtomicProtocolSyncStore;
#[cfg(feature = "sqlite")]
use crate::sqlite::{SqliteProtocolStore, SqliteStoreError};

pub const SYNC_INGEST_FORMAT: &str = "opto-sync.ingest.v1";
pub const SYNC_INGEST_SCHEMA_ID: &str =
    "https://opto-sync.dev/schemas/opto-sync-ingest.v1.schema.json";
pub const DEFAULT_MAX_INGEST_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncIngestDocument {
    pub format: String,
    pub batch_id: String,
    pub created_at: String,
    pub mutations: Vec<SyncIngestMutation>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "operation", rename_all = "lowercase", deny_unknown_fields)]
pub enum SyncIngestMutation {
    Upsert {
        table: String,
        #[serde(rename = "recordId")]
        record_id: String,
        record: Value,
        #[serde(rename = "baseRevision")]
        base_revision: Option<String>,
        #[serde(default)]
        resurrect: bool,
    },
    Delete {
        table: String,
        #[serde(rename = "recordId")]
        record_id: String,
        #[serde(rename = "deletedAt")]
        deleted_at: String,
        #[serde(rename = "baseRevision")]
        base_revision: Option<String>,
    },
}

#[derive(Debug)]
pub enum SyncIngestError {
    TooLarge { actual: usize, limit: usize },
    Json(serde_json::Error),
    Invalid { path: String, message: &'static str },
    Protocol(ProtocolError),
    #[cfg(feature = "sqlite")]
    Sqlite(SqliteStoreError),
}

impl std::fmt::Display for SyncIngestError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLarge { actual, limit } => {
                write!(formatter, "ingest document is {actual} bytes; limit is {limit}")
            }
            Self::Json(_) => formatter.write_str("ingest document is not valid JSON"),
            Self::Invalid { path, message } => {
                write!(formatter, "ingest document {path} {message}")
            }
            Self::Protocol(error) => error.fmt(formatter),
            #[cfg(feature = "sqlite")]
            Self::Sqlite(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for SyncIngestError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Json(error) => Some(error),
            Self::Protocol(error) => Some(error),
            #[cfg(feature = "sqlite")]
            Self::Sqlite(error) => Some(error),
            _ => None,
        }
    }
}

impl From<ProtocolError> for SyncIngestError {
    fn from(value: ProtocolError) -> Self {
        Self::Protocol(value)
    }
}

#[cfg(feature = "sqlite")]
impl From<SqliteStoreError> for SyncIngestError {
    fn from(value: SqliteStoreError) -> Self {
        Self::Sqlite(value)
    }
}

fn invalid(path: impl Into<String>, message: &'static str) -> SyncIngestError {
    SyncIngestError::Invalid {
        path: path.into(),
        message,
    }
}

fn canonical_decimal(value: &str) -> bool {
    value == "0"
        || (!value.is_empty()
            && !value.starts_with('0')
            && value.bytes().all(|byte| byte.is_ascii_digit()))
}

fn valid_scope_id(value: &str) -> bool {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    value.len() <= 128
        && first.is_ascii_alphanumeric()
        && bytes.all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-')
        })
}

fn valid_record_id(value: &str) -> bool {
    let length = value.chars().count();
    (1..=512).contains(&length)
}

fn fixed_decimal(bytes: &[u8], start: usize, width: usize) -> Option<u32> {
    let end = start.checked_add(width)?;
    let value = bytes.get(start..end)?;
    if !value.iter().all(u8::is_ascii_digit) {
        return None;
    }
    std::str::from_utf8(value).ok()?.parse().ok()
}

fn leap_year(year: u32) -> bool {
    year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400))
}

fn valid_rfc3339(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return false;
    }
    let Some(year) = fixed_decimal(bytes, 0, 4) else {
        return false;
    };
    let Some(month) = fixed_decimal(bytes, 5, 2) else {
        return false;
    };
    let Some(day) = fixed_decimal(bytes, 8, 2) else {
        return false;
    };
    let Some(hour) = fixed_decimal(bytes, 11, 2) else {
        return false;
    };
    let Some(minute) = fixed_decimal(bytes, 14, 2) else {
        return false;
    };
    let Some(second) = fixed_decimal(bytes, 17, 2) else {
        return false;
    };
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap_year(year) => 29,
        2 => 28,
        _ => return false,
    };
    if day == 0 || day > days || hour > 23 || minute > 59 || second > 59 {
        return false;
    }

    let mut cursor = 19;
    if bytes.get(cursor) == Some(&b'.') {
        cursor += 1;
        let fraction_start = cursor;
        while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        if cursor == fraction_start {
            return false;
        }
    }
    match bytes.get(cursor) {
        Some(b'Z') => cursor + 1 == bytes.len(),
        Some(b'+') | Some(b'-') => {
            let Some(offset_hour) = fixed_decimal(bytes, cursor + 1, 2) else {
                return false;
            };
            let Some(offset_minute) = fixed_decimal(bytes, cursor + 4, 2) else {
                return false;
            };
            bytes.get(cursor + 3) == Some(&b':')
                && cursor + 6 == bytes.len()
                && offset_hour <= 23
                && offset_minute <= 59
        }
        _ => false,
    }
}

fn valid_hlc(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 20
        && fixed_decimal(bytes, 0, 13).is_some()
        && bytes.get(13) == Some(&b'-')
        && bytes
            .get(14..18)
            .is_some_and(|counter| counter.iter().all(u8::is_ascii_hexdigit))
        && bytes
            .get(14..18)
            .is_some_and(|counter| counter.iter().all(|byte| !byte.is_ascii_uppercase()))
        && bytes.get(18) == Some(&b'-')
        && bytes.get(19..).is_some_and(|node| {
            !node.is_empty()
                && node.iter().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':')
                })
        })
}

pub fn valid_sync_timestamp(value: &str) -> bool {
    valid_hlc(value) || canonical_decimal(value) || valid_rfc3339(value)
}

impl SyncIngestDocument {
    pub fn validate(&self) -> Result<(), SyncIngestError> {
        if self.format != SYNC_INGEST_FORMAT {
            return Err(invalid("$.format", "must equal opto-sync.ingest.v1"));
        }
        if !valid_scope_id(&self.batch_id) {
            return Err(invalid("$.batchId", "must be a valid scope id"));
        }
        if !valid_sync_timestamp(&self.created_at) {
            return Err(invalid("$.createdAt", "must be a sync timestamp string"));
        }
        if self.mutations.is_empty() || self.mutations.len() > 10_000 {
            return Err(invalid("$.mutations", "must contain 1-10000 mutations"));
        }
        for (index, mutation) in self.mutations.iter().enumerate() {
            let path = format!("$.mutations[{index}]");
            let (table, record_id, base_revision) = match mutation {
                SyncIngestMutation::Upsert {
                    table,
                    record_id,
                    base_revision,
                    ..
                }
                | SyncIngestMutation::Delete {
                    table,
                    record_id,
                    base_revision,
                    ..
                } => (table, record_id, base_revision),
            };
            if !valid_scope_id(table) {
                return Err(invalid(format!("{path}.table"), "must be a valid scope id"));
            }
            if !valid_record_id(record_id) {
                return Err(invalid(
                    format!("{path}.recordId"),
                    "must be a non-empty string of at most 512 characters",
                ));
            }
            if base_revision
                .as_deref()
                .is_some_and(|revision| !canonical_decimal(revision))
            {
                return Err(invalid(
                    format!("{path}.baseRevision"),
                    "must be a canonical unsigned decimal string",
                ));
            }
            match mutation {
                SyncIngestMutation::Delete { deleted_at, .. } => {
                    if !valid_sync_timestamp(deleted_at) {
                        return Err(invalid(
                            format!("{path}.deletedAt"),
                            "must be a sync timestamp string",
                        ));
                    }
                }
                SyncIngestMutation::Upsert { record, .. } => {
                    let Some(object) = record.as_object() else {
                        return Err(invalid(format!("{path}.record"), "must be a JSON object"));
                    };
                    for field in ["updatedAt", "createdAt", "syncedAt"] {
                        match object.get(field) {
                            Some(Value::String(timestamp)) if valid_sync_timestamp(timestamp) => {}
                            None if field != "updatedAt" => {}
                            _ => {
                                return Err(invalid(
                                    format!("{path}.record.{field}"),
                                    "must be a sync timestamp string",
                                ));
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

pub fn parse_sync_ingest_bytes(
    bytes: &[u8],
    max_bytes: usize,
) -> Result<SyncIngestDocument, SyncIngestError> {
    if bytes.len() > max_bytes {
        return Err(SyncIngestError::TooLarge {
            actual: bytes.len(),
            limit: max_bytes,
        });
    }
    let document: SyncIngestDocument =
        serde_json::from_slice(bytes).map_err(SyncIngestError::Json)?;
    document.validate()?;
    Ok(document)
}

pub fn parse_sync_ingest_str(input: &str) -> Result<SyncIngestDocument, SyncIngestError> {
    parse_sync_ingest_bytes(input.as_bytes(), DEFAULT_MAX_INGEST_BYTES)
}

/// Atomically update an in-memory queue by cloning it before applying rows.
pub fn queue_sync_ingest_document(
    queue: &mut ProtocolQueue,
    document: &SyncIngestDocument,
) -> Result<Vec<String>, SyncIngestError> {
    document.validate()?;
    let mut next = queue.clone();
    let mut ids = Vec::with_capacity(document.mutations.len());
    for mutation in &document.mutations {
        let id = match mutation {
            SyncIngestMutation::Upsert {
                table,
                record_id,
                record,
                base_revision,
                resurrect,
            } => next.queue_upsert(
                table.clone(),
                record_id.clone(),
                record.clone(),
                base_revision.clone(),
                *resurrect,
            )?,
            SyncIngestMutation::Delete {
                table,
                record_id,
                base_revision,
                ..
            } => next.queue_delete(table.clone(), record_id.clone(), base_revision.clone())?,
        };
        ids.push(id);
    }
    *queue = next;
    Ok(ids)
}

#[cfg(feature = "sqlite")]
pub fn queue_sync_ingest_sqlite(
    store: &mut SqliteProtocolStore,
    document: &SyncIngestDocument,
) -> Result<Vec<String>, SyncIngestError> {
    let mut queue = store.load_queue()?;
    let ids = queue_sync_ingest_document(&mut queue, document)?;
    store.persist_queue(&mut queue)?;
    Ok(ids)
}
