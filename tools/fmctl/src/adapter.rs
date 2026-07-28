use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::FmError;
use crate::plan::ReplayRequest;

pub const ADAPTER_PROTOCOL: &str = "fmctl.adapter.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdapterReplayResponse {
    pub protocol: String,
    pub success: bool,
    pub traces_total: u64,
    pub traces_passed: u64,
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
    pub expected: Value,
    pub actual: Value,
}

pub fn parse_replay_response(
    stdout: &str,
    request: &ReplayRequest,
) -> Result<AdapterReplayResponse, FmError> {
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
    validate_replay_response(&response, request)?;
    Ok(response)
}

fn validate_replay_response(
    response: &AdapterReplayResponse,
    request: &ReplayRequest,
) -> Result<(), FmError> {
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
    if response.implementation.language != request.adapter {
        return Err(FmError::AdapterProtocol(format!(
            "adapter {:?} identified its implementation language as {:?}",
            request.adapter, response.implementation.language
        )));
    }
    let expected_total = u64::try_from(request.traces.len()).map_err(|_| {
        FmError::AdapterProtocol("requested trace count exceeds protocol limits".to_owned())
    })?;
    if expected_total == 0 {
        return Err(FmError::AdapterProtocol(
            "replay request must contain at least one trace".to_owned(),
        ));
    }
    if response.traces_total != expected_total {
        return Err(FmError::AdapterProtocol(format!(
            "adapter reported {} total traces for a request containing {expected_total}",
            response.traces_total
        )));
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
    if !response.success && response.traces_passed == response.traces_total {
        return Err(FmError::AdapterProtocol(
            "failed response cannot report every trace as passed".to_owned(),
        ));
    }
    let requested_paths = request
        .traces
        .iter()
        .map(PathBuf::as_path)
        .collect::<BTreeSet<&Path>>();
    for mismatch in &response.mismatches {
        if !requested_paths.contains(mismatch.trace.as_path()) {
            return Err(FmError::AdapterProtocol(format!(
                "mismatch references trace outside the request: {}",
                mismatch.trace.display()
            )));
        }
        if mismatch.message.trim().is_empty() {
            return Err(FmError::AdapterProtocol(
                "mismatch message must not be empty".to_owned(),
            ));
        }
        if mismatch
            .action
            .as_ref()
            .is_some_and(|action| action.trim().is_empty())
        {
            return Err(FmError::AdapterProtocol(
                "mismatch action must be null or a nonempty string".to_owned(),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(traces: &[&str]) -> ReplayRequest {
        ReplayRequest {
            protocol: ADAPTER_PROTOCOL.to_owned(),
            project: "example".to_owned(),
            model: "machine".to_owned(),
            adapter: "typescript".to_owned(),
            specification: PathBuf::from("/workspace/formal/model.qnt"),
            traces: traces.iter().map(PathBuf::from).collect(),
        }
    }

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
            &request(&["trace-1.json", "trace-2.json"]),
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
                "implementation":{"language":"typescript","name":"example","version":"1"}
            }"#,
            &request(&["trace.json"]),
        )
        .expect_err("inconsistent response must fail");
        assert!(error.to_string().contains("successful response"));
    }

    #[test]
    fn rejects_vacuous_success() {
        let error = parse_replay_response(
            r#"{
                "protocol":"fmctl.adapter.v1",
                "success":true,
                "traces_total":0,
                "traces_passed":0,
                "mismatches":[],
                "implementation":{"language":"typescript","name":"example","version":"1"}
            }"#,
            &request(&["trace.json"]),
        )
        .expect_err("zero-trace success must fail");
        assert!(error.to_string().contains("request containing 1"));
    }

    #[test]
    fn rejects_mismatch_for_unrequested_trace() {
        let error = parse_replay_response(
            r#"{
                "protocol":"fmctl.adapter.v1",
                "success":false,
                "traces_total":1,
                "traces_passed":0,
                "mismatches":[{
                    "trace":"other.json",
                    "step":1,
                    "action":"send",
                    "message":"state differs",
                    "expected":{},
                    "actual":{}
                }],
                "implementation":{"language":"typescript","name":"example","version":"1"}
            }"#,
            &request(&["trace.json"]),
        )
        .expect_err("unrequested mismatch trace must fail");
        assert!(error.to_string().contains("outside the request"));
    }
}
