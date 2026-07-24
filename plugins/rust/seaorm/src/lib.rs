use sea_orm::{ActiveModelBehavior, ActiveModelTrait, EntityTrait, IntoActiveModel, Set};
use serde_json::Value;
use opto_sync_syncer::merge_json;

pub trait SyncerMergeHook {
    fn sync_json_field(
        current_raw: &str,
        incoming_raw: &str,
    ) -> String {
        // Assume merge_json handles conflicts via CRDT timestamps or other strategy
        merge_json(current_raw, incoming_raw, |conflict| {
            // Default conflict resolution for SeaORM
            conflict.incoming
        })
    }
}
