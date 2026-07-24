use sqlx::postgres::PgRow;
use sqlx::Row;
use serde_json::Value;
use opto_sync_syncer::merge_json;

pub fn merge_jsonb_column(current: &str, incoming: &str) -> String {
    merge_json(current, incoming, |conflict| {
        conflict.incoming
    })
}
