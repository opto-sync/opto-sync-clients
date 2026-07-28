use serde::Serialize;
use serde_json::Value;

use crate::plan::Plan;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    Ok,
    Failed,
    DryRun,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandOutcome {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
pub struct OperationResult {
    pub status: Status,
    pub operation: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<Plan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<CommandOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}
