use serde::Serialize;
use serde_json::Value;

use crate::plan::CommandPlan;
use crate::runner::CommandOutcome;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    Ok,
    Failed,
    DryRun,
}

#[derive(Debug, Clone, Serialize)]
pub struct OperationResult {
    pub status: Status,
    pub operation: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<CommandPlan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<CommandOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dry_run_envelope_has_stable_status_and_omits_empty_payloads() {
        let value = serde_json::to_value(OperationResult {
            status: Status::DryRun,
            operation: "verify".to_owned(),
            message: "planned".to_owned(),
            plan: None,
            outcome: None,
            details: None,
        })
        .expect("serialize result envelope");

        assert_eq!(value["status"], "dry-run");
        assert_eq!(value["operation"], "verify");
        assert!(value.get("plan").is_none());
        assert!(value.get("outcome").is_none());
        assert!(value.get("details").is_none());
    }
}
