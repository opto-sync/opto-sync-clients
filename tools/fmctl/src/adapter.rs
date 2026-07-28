use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::FmError;

pub const ADAPTER_PROTOCOL: &str = "fmctl.adapter.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdapterReplayResponse {
    pub protocol: String,
    pub success: bool,
    pub traces_total: u64,
    pub traces_passed: u64,
    #[serde(default)]
    pub mismatches: Vec<AdapterMismatch>,
    pub implementation: AdapterImplementation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdapterImplementation {
    pub language: String,
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdapterMismatch {
    pub trace: PathBuf,
    pub step: Option<u64>,
    pub action: Option<String>,
    pub message: String,
    pub expected: Option<Value>,
    pub actual: Option<Value>,
}

pub fn parse_replay_response(stdout: &str) -> Result<AdapterReplayResponse, FmError> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(FmError::AdapterProtocol(
            "adapter returned no JSON response on stdout".to_owned(),
        ));
    }
    let response: AdapterReplayResponse = serde_json::from_str(trimmed).map_err(|error| {
        FmError::AdapterProtocol(format!(
            "stdout must contain exactly one adapter response JSON object: {error}"
        ))
    })?;
    validate_replay_response(&response)?;
    Ok(response)
}

fn validate_replay_response(response: &AdapterReplayResponse) -> Result<(), FmError> {
    if response.protocol != ADAPTER_PROTOCOL {
        return Err(FmError::AdapterProtocol(format!(
            "expected protocol {ADAPTER_PROTOCOL:?}, got {:?}",
            response.protocol
        )));
    }
    if response.implementation.language.trim().is_empty()
        || response.implementation.name.trim().is_empty()
        || response.implementation.version.trim().is_empty()
    {
        return Err(FmError::AdapterProtocol(
            "implementation language, name, and version are required".to_owned(),
        ));
    }
    if response.traces_passed > response.traces_total {
        return Err(FmError::AdapterProtocol(format!(
            "traces_passed ({}) exceeds traces_total ({})",
            response.traces_passed, response.traces_total
        )));
    }
    if response.success
        && (response.traces_passed != response.traces_total || !response.mismatches.is_empty())
    {
        return Err(FmError::AdapterProtocol(
            "successful response must pass every trace and contain no mismatches".to_owned(),
        ));
    }
    if !response.success && response.mismatches.is_empty() {
        return Err(FmError::AdapterProtocol(
            "failed response must include at least one mismatch".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_complete_success_response() {
        let response = parse_replay_response(
            r#"{
                "protocol":"fmctl.adapter.v1",
                "success":true,
                "traces_total":2,
                "traces_passed":2,
                "mismatches":[],
                "implementation":{"language":"typescript","name":"example","version":"1"}
            }"#,
        )
        .expect("valid response");
        assert!(response.success);
    }

    #[test]
    fn rejects_success_with_mismatches() {
        let error = parse_replay_response(
            r#"{
                "protocol":"fmctl.adapter.v1",
                "success":true,
                "traces_total":1,
                "traces_passed":0,
                "mismatches":[{
                    "trace":"trace.json",
                    "step":1,
                    "action":"send",
                    "message":"state differs",
                    "expected":{},
                    "actual":{}
                }],
                "implementation":{"language":"dart","name":"example","version":"1"}
            }"#,
        )
        .expect_err("inconsistent response must fail");
        assert!(error.to_string().contains("successful response"));
    }
}
