use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

pub const STREAM_ADAPTER_PROTOCOL: &str = "fm.adapter.stream.v1";
pub const STREAM_ADAPTER_PROTOCOL_VERSION: u32 = 1;
pub const MAX_STREAM_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_REQUEST_ID: u64 = 9_007_199_254_740_991;
const MAX_SETTLE_STEPS: u32 = 1_000_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum StreamMessage {
    Request(StreamRequest),
    Response(StreamResponse),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamRequest {
    pub protocol: String,
    pub protocol_version: u32,
    pub request_id: String,
    pub machine: String,
    pub generation: u64,
    pub operation: StreamOperation,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "name", rename_all = "snake_case", deny_unknown_fields)]
pub enum StreamOperation {
    Hello,
    Reset {
        #[serde(rename = "initialState")]
        initial_state: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        seed: Option<String>,
        #[serde(rename = "logicalTime")]
        logical_time: Value,
    },
    Apply {
        action: String,
        #[serde(default)]
        arguments: Value,
        #[serde(rename = "logicalTime")]
        logical_time: Value,
    },
    Observe,
    Settle {
        #[serde(rename = "maxSteps")]
        max_steps: u32,
    },
    Snapshot,
    Restore {
        snapshot: Value,
        #[serde(rename = "schemaHash")]
        schema_hash: String,
    },
    Fault {
        fault: String,
        #[serde(default)]
        arguments: Value,
    },
    Close,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum StreamOperationName {
    Hello,
    Reset,
    Apply,
    Observe,
    Settle,
    Snapshot,
    Restore,
    Fault,
    Close,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamResponse {
    pub protocol: String,
    pub protocol_version: u32,
    pub request_id: String,
    pub machine: String,
    pub generation: u64,
    pub operation: StreamOperationName,
    pub outcome: StreamOutcome,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum StreamOutcome {
    Ok { value: Value },
    Error { error: StreamError },
    Unsupported { error: StreamError },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamImplementation {
    pub language: String,
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelloResult {
    pub implementation: StreamImplementation,
    pub capabilities: BTreeSet<StreamOperationName>,
    pub canonical_state_schema_hash: String,
}

#[derive(Debug, Error)]
pub enum StreamProtocolError {
    #[error("stream adapter message exceeds the {MAX_STREAM_MESSAGE_BYTES}-byte limit")]
    MessageTooLarge,
    #[error("invalid stream adapter JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid stream adapter message: {0}")]
    Invalid(String),
}

impl StreamOperation {
    pub fn name(&self) -> StreamOperationName {
        match self {
            Self::Hello => StreamOperationName::Hello,
            Self::Reset { .. } => StreamOperationName::Reset,
            Self::Apply { .. } => StreamOperationName::Apply,
            Self::Observe => StreamOperationName::Observe,
            Self::Settle { .. } => StreamOperationName::Settle,
            Self::Snapshot => StreamOperationName::Snapshot,
            Self::Restore { .. } => StreamOperationName::Restore,
            Self::Fault { .. } => StreamOperationName::Fault,
            Self::Close => StreamOperationName::Close,
        }
    }
}

impl StreamMessage {
    pub fn validate(&self) -> Result<(), StreamProtocolError> {
        match self {
            Self::Request(request) => request.validate(),
            Self::Response(response) => response.validate(),
        }
    }
}

impl StreamRequest {
    pub fn validate(&self) -> Result<(), StreamProtocolError> {
        validate_envelope(
            &self.protocol,
            self.protocol_version,
            &self.request_id,
            &self.machine,
        )?;
        match &self.operation {
            StreamOperation::Hello | StreamOperation::Observe | StreamOperation::Snapshot
            | StreamOperation::Close => {}
            StreamOperation::Reset {
                initial_state,
                seed,
                logical_time,
            } => {
                canonicalize_json(initial_state)?;
                canonicalize_json(logical_time)?;
                if seed.as_ref().is_some_and(|value| value.trim().is_empty()) {
                    return Err(StreamProtocolError::Invalid(
                        "reset seed must be absent or nonempty".to_owned(),
                    ));
                }
            }
            StreamOperation::Apply {
                action,
                arguments,
                logical_time,
            } => {
                validate_label("action", action, 256)?;
                canonicalize_json(arguments)?;
                canonicalize_json(logical_time)?;
            }
            StreamOperation::Settle { max_steps } => {
                if *max_steps == 0 || *max_steps > MAX_SETTLE_STEPS {
                    return Err(StreamProtocolError::Invalid(format!(
                        "settle maxSteps must be between 1 and {MAX_SETTLE_STEPS}"
                    )));
                }
            }
            StreamOperation::Restore {
                snapshot,
                schema_hash,
            } => {
                canonicalize_json(snapshot)?;
                validate_sha256("restore schemaHash", schema_hash)?;
            }
            StreamOperation::Fault { fault, arguments } => {
                validate_label("fault", fault, 256)?;
                canonicalize_json(arguments)?;
            }
        }
        Ok(())
    }

    fn numeric_request_id(&self) -> Result<u64, StreamProtocolError> {
        parse_request_id(&self.request_id)
    }
}

impl StreamResponse {
    pub fn validate(&self) -> Result<(), StreamProtocolError> {
        validate_envelope(
            &self.protocol,
            self.protocol_version,
            &self.request_id,
            &self.machine,
        )?;
        match &self.outcome {
            StreamOutcome::Ok { value } => {
                canonicalize_json(value)?;
            }
            StreamOutcome::Error { error } | StreamOutcome::Unsupported { error } => {
                error.validate()?;
            }
        }
        Ok(())
    }
}

impl StreamError {
    fn validate(&self) -> Result<(), StreamProtocolError> {
        validate_label("error code", &self.code, 128)?;
        validate_label("error message", &self.message, 4096)?;
        if let Some(data) = &self.data {
            canonicalize_json(data)?;
        }
        Ok(())
    }
}

impl HelloResult {
    fn validate(&self) -> Result<(), StreamProtocolError> {
        validate_label(
            "implementation language",
            &self.implementation.language,
            128,
        )?;
        validate_label("implementation name", &self.implementation.name, 256)?;
        validate_label(
            "implementation version",
            &self.implementation.version,
            256,
        )?;
        validate_sha256(
            "canonicalStateSchemaHash",
            &self.canonical_state_schema_hash,
        )?;
        let required = [
            StreamOperationName::Reset,
            StreamOperationName::Apply,
            StreamOperationName::Observe,
            StreamOperationName::Close,
        ];
        let missing = required
            .iter()
            .filter(|operation| !self.capabilities.contains(operation))
            .map(|operation| format!("{operation:?}").to_lowercase())
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(StreamProtocolError::Invalid(format!(
                "hello result is missing required capabilities: {}",
                missing.join(", ")
            )));
        }
        Ok(())
    }
}

pub fn parse_stream_message_line(line: &[u8]) -> Result<StreamMessage, StreamProtocolError> {
    if line.len() > MAX_STREAM_MESSAGE_BYTES {
        return Err(StreamProtocolError::MessageTooLarge);
    }
    if line.is_empty() || line.iter().all(u8::is_ascii_whitespace) {
        return Err(StreamProtocolError::Invalid(
            "stream adapter line must contain one JSON object".to_owned(),
        ));
    }
    if line.contains(&b'\n') || line.contains(&b'\r') {
        return Err(StreamProtocolError::Invalid(
            "stream adapter parser accepts exactly one line without a terminator".to_owned(),
        ));
    }
    let message: StreamMessage = serde_json::from_slice(line)?;
    message.validate()?;
    Ok(message)
}

pub fn canonical_json_bytes(value: &Value) -> Result<Vec<u8>, StreamProtocolError> {
    Ok(serde_json::to_vec(&canonicalize_json(value)?)?)
}

pub fn canonicalize_json(value: &Value) -> Result<Value, StreamProtocolError> {
    match value {
        Value::Null | Value::Bool(_) | Value::String(_) => Ok(value.clone()),
        Value::Number(number) => {
            if number.is_i64() || number.is_u64() {
                Ok(Value::Number(number.clone()))
            } else {
                Err(StreamProtocolError::Invalid(
                    "canonical adapter JSON forbids floating-point numbers".to_owned(),
                ))
            }
        }
        Value::Array(values) => values
            .iter()
            .map(canonicalize_json)
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        Value::Object(object) => canonicalize_object(object),
    }
}

fn canonicalize_object(object: &Map<String, Value>) -> Result<Value, StreamProtocolError> {
    if object.len() == 1 {
        if let Some(value) = object.get("#bigint") {
            let encoded = value.as_str().ok_or_else(|| {
                StreamProtocolError::Invalid("ITF #bigint must contain a string".to_owned())
            })?;
            validate_decimal_string("ITF #bigint", encoded, true)?;
            return Ok(singleton_object("#bigint", Value::String(encoded.to_owned())));
        }
        if let Some(value) = object.get("#set") {
            return canonicalize_set(value);
        }
        if let Some(value) = object.get("#map") {
            return canonicalize_map(value);
        }
    }

    let mut entries = BTreeMap::new();
    for (key, value) in object {
        entries.insert(key.clone(), canonicalize_json(value)?);
    }
    let mut result = Map::new();
    for (key, value) in entries {
        result.insert(key, value);
    }
    Ok(Value::Object(result))
}

fn canonicalize_set(value: &Value) -> Result<Value, StreamProtocolError> {
    let values = value.as_array().ok_or_else(|| {
        StreamProtocolError::Invalid("ITF #set must contain an array".to_owned())
    })?;
    let mut indexed = BTreeMap::new();
    for entry in values {
        let canonical = canonicalize_json(entry)?;
        let key = serde_json::to_string(&canonical)?;
        if indexed.insert(key, canonical).is_some() {
            return Err(StreamProtocolError::Invalid(
                "ITF #set contains duplicate canonical values".to_owned(),
            ));
        }
    }
    Ok(singleton_object(
        "#set",
        Value::Array(indexed.into_values().collect()),
    ))
}

fn canonicalize_map(value: &Value) -> Result<Value, StreamProtocolError> {
    let entries = value.as_array().ok_or_else(|| {
        StreamProtocolError::Invalid("ITF #map must contain an array".to_owned())
    })?;
    let mut indexed = BTreeMap::new();
    for entry in entries {
        let pair = entry.as_array().filter(|pair| pair.len() == 2).ok_or_else(|| {
            StreamProtocolError::Invalid(
                "each ITF #map entry must be a two-element [key, value] array".to_owned(),
            )
        })?;
        let key = canonicalize_json(&pair[0])?;
        let value = canonicalize_json(&pair[1])?;
        let index = serde_json::to_string(&key)?;
        if indexed.insert(index, (key, value)).is_some() {
            return Err(StreamProtocolError::Invalid(
                "ITF #map contains duplicate canonical keys".to_owned(),
            ));
        }
    }
    let entries = indexed
        .into_values()
        .map(|(key, value)| Value::Array(vec![key, value]))
        .collect();
    Ok(singleton_object("#map", Value::Array(entries)))
}

fn singleton_object(key: &str, value: Value) -> Value {
    let mut object = Map::new();
    object.insert(key.to_owned(), value);
    Value::Object(object)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionPhase {
    AwaitHello,
    Ready,
    Closed,
}

#[derive(Debug, Clone)]
struct PendingRequest {
    request_id: String,
    machine: String,
    generation: u64,
    operation: StreamOperationName,
}

#[derive(Debug, Clone)]
pub struct StreamTranscriptValidator {
    phase: SessionPhase,
    current_generation: u64,
    last_request_id: u64,
    pending: Option<PendingRequest>,
    capabilities: BTreeSet<StreamOperationName>,
}

impl Default for StreamTranscriptValidator {
    fn default() -> Self {
        Self {
            phase: SessionPhase::AwaitHello,
            current_generation: 0,
            last_request_id: 0,
            pending: None,
            capabilities: BTreeSet::new(),
        }
    }
}

impl StreamTranscriptValidator {
    pub fn accept(&mut self, message: &StreamMessage) -> Result<(), StreamProtocolError> {
        message.validate()?;
        match message {
            StreamMessage::Request(request) => self.accept_request(request),
            StreamMessage::Response(response) => self.accept_response(response),
        }
    }

    pub fn finish(&self) -> Result<(), StreamProtocolError> {
        if let Some(pending) = &self.pending {
            return Err(StreamProtocolError::Invalid(format!(
                "transcript ended before response to request {}",
                pending.request_id
            )));
        }
        if self.phase != SessionPhase::Closed {
            return Err(StreamProtocolError::Invalid(
                "complete transcript must end with a successful close response".to_owned(),
            ));
        }
        Ok(())
    }

    fn accept_request(&mut self, request: &StreamRequest) -> Result<(), StreamProtocolError> {
        if self.phase == SessionPhase::Closed {
            return Err(StreamProtocolError::Invalid(
                "request received after the session closed".to_owned(),
            ));
        }
        if let Some(pending) = &self.pending {
            return Err(StreamProtocolError::Invalid(format!(
                "request {} arrived before response to request {}",
                request.request_id, pending.request_id
            )));
        }
        let numeric_request_id = request.numeric_request_id()?;
        if numeric_request_id <= self.last_request_id {
            return Err(StreamProtocolError::Invalid(format!(
                "request id {} must be strictly greater than {}",
                request.request_id, self.last_request_id
            )));
        }

        let operation = request.operation.name();
        match self.phase {
            SessionPhase::AwaitHello => {
                if operation != StreamOperationName::Hello || request.generation != 0 {
                    return Err(StreamProtocolError::Invalid(
                        "the first request must be hello at generation 0".to_owned(),
                    ));
                }
            }
            SessionPhase::Ready => {
                if operation == StreamOperationName::Hello {
                    return Err(StreamProtocolError::Invalid(
                        "hello may only occur before the session is ready".to_owned(),
                    ));
                }
                let expected_generation = if operation == StreamOperationName::Reset {
                    self.current_generation.checked_add(1).ok_or_else(|| {
                        StreamProtocolError::Invalid(
                            "adapter session generation overflowed".to_owned(),
                        )
                    })?
                } else {
                    self.current_generation
                };
                if request.generation != expected_generation {
                    return Err(StreamProtocolError::Invalid(format!(
                        "request {} uses generation {}; expected {expected_generation}",
                        request.request_id, request.generation
                    )));
                }
            }
            SessionPhase::Closed => unreachable!("closed phase returned above"),
        }

        self.last_request_id = numeric_request_id;
        self.pending = Some(PendingRequest {
            request_id: request.request_id.clone(),
            machine: request.machine.clone(),
            generation: request.generation,
            operation,
        });
        Ok(())
    }

    fn accept_response(&mut self, response: &StreamResponse) -> Result<(), StreamProtocolError> {
        let pending = self.pending.take().ok_or_else(|| {
            StreamProtocolError::Invalid(format!(
                "response {} has no pending request",
                response.request_id
            ))
        })?;
        if response.request_id != pending.request_id
            || response.machine != pending.machine
            || response.generation != pending.generation
            || response.operation != pending.operation
        {
            self.pending = Some(pending);
            return Err(StreamProtocolError::Invalid(
                "response does not echo the pending request identity".to_owned(),
            ));
        }

        match (&pending.operation, &response.outcome) {
            (StreamOperationName::Hello, StreamOutcome::Ok { value }) => {
                let hello: HelloResult = serde_json::from_value(value.clone()).map_err(|error| {
                    StreamProtocolError::Invalid(format!(
                        "hello success value does not match the capability contract: {error}"
                    ))
                })?;
                hello.validate()?;
                self.capabilities = hello.capabilities;
                self.phase = SessionPhase::Ready;
            }
            (StreamOperationName::Hello, _) => {
                self.phase = SessionPhase::AwaitHello;
            }
            (StreamOperationName::Reset, StreamOutcome::Ok { .. }) => {
                self.current_generation = pending.generation;
            }
            (StreamOperationName::Close, StreamOutcome::Ok { .. }) => {
                self.phase = SessionPhase::Closed;
            }
            (operation, StreamOutcome::Ok { .. })
                if !self.capabilities.contains(operation) =>
            {
                return Err(StreamProtocolError::Invalid(format!(
                    "adapter succeeded for unadvertised capability {operation:?}"
                )));
            }
            _ => {}
        }
        Ok(())
    }
}

pub fn validate_stream_transcript(source: &str) -> Result<(), StreamProtocolError> {
    let mut validator = StreamTranscriptValidator::default();
    for (index, line) in source.lines().enumerate() {
        if line.trim().is_empty() {
            return Err(StreamProtocolError::Invalid(format!(
                "transcript line {} is blank",
                index + 1
            )));
        }
        let message = parse_stream_message_line(line.as_bytes()).map_err(|error| {
            StreamProtocolError::Invalid(format!("transcript line {}: {error}", index + 1))
        })?;
        validator.accept(&message).map_err(|error| {
            StreamProtocolError::Invalid(format!("transcript line {}: {error}", index + 1))
        })?;
    }
    validator.finish()
}

fn validate_envelope(
    protocol: &str,
    protocol_version: u32,
    request_id: &str,
    machine: &str,
) -> Result<(), StreamProtocolError> {
    if protocol != STREAM_ADAPTER_PROTOCOL {
        return Err(StreamProtocolError::Invalid(format!(
            "protocol must be exactly {STREAM_ADAPTER_PROTOCOL:?}"
        )));
    }
    if protocol_version != STREAM_ADAPTER_PROTOCOL_VERSION {
        return Err(StreamProtocolError::Invalid(format!(
            "protocolVersion must be {STREAM_ADAPTER_PROTOCOL_VERSION}"
        )));
    }
    parse_request_id(request_id)?;
    validate_label("machine", machine, 256)
}

fn parse_request_id(request_id: &str) -> Result<u64, StreamProtocolError> {
    validate_decimal_string("requestId", request_id, false)?;
    let value = request_id.parse::<u64>().map_err(|_| {
        StreamProtocolError::Invalid("requestId exceeds the protocol integer range".to_owned())
    })?;
    if value == 0 || value > MAX_REQUEST_ID {
        return Err(StreamProtocolError::Invalid(format!(
            "requestId must be between 1 and {MAX_REQUEST_ID}"
        )));
    }
    Ok(value)
}

fn validate_decimal_string(
    label: &str,
    value: &str,
    allow_negative: bool,
) -> Result<(), StreamProtocolError> {
    let digits = value.strip_prefix('-').unwrap_or(value);
    if value.starts_with('-') && !allow_negative {
        return Err(StreamProtocolError::Invalid(format!(
            "{label} must be an unsigned canonical decimal string"
        )));
    }
    if digits.is_empty()
        || !digits.bytes().all(|byte| byte.is_ascii_digit())
        || (digits.len() > 1 && digits.starts_with('0'))
        || value == "-0"
    {
        return Err(StreamProtocolError::Invalid(format!(
            "{label} must be a canonical decimal string"
        )));
    }
    Ok(())
}

fn validate_label(label: &str, value: &str, max_length: usize) -> Result<(), StreamProtocolError> {
    if value.trim().is_empty() || value.len() > max_length || value.chars().any(char::is_control) {
        return Err(StreamProtocolError::Invalid(format!(
            "{label} must be nonempty, at most {max_length} bytes, and contain no control characters"
        )));
    }
    Ok(())
}

fn validate_sha256(label: &str, value: &str) -> Result<(), StreamProtocolError> {
    let digest = value.strip_prefix("sha256:").ok_or_else(|| {
        StreamProtocolError::Invalid(format!("{label} must use the sha256:<hex> form"))
    })?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(StreamProtocolError::Invalid(format!(
            "{label} must contain exactly 64 lowercase hexadecimal digits"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const HAPPY_TRANSCRIPT: &str = include_str!(
        "../../../formal/protocol-fixtures/stream/valid/happy.jsonl"
    );
    const UNSUPPORTED_TRANSCRIPT: &str = include_str!(
        "../../../formal/protocol-fixtures/stream/valid/unsupported.jsonl"
    );
    const DUPLICATE_ID_TRANSCRIPT: &str = include_str!(
        "../../../formal/protocol-fixtures/stream/invalid/duplicate-request-id.jsonl"
    );
    const STALE_GENERATION_TRANSCRIPT: &str = include_str!(
        "../../../formal/protocol-fixtures/stream/invalid/stale-generation.jsonl"
    );

    #[test]
    fn accepts_golden_transcripts() {
        validate_stream_transcript(HAPPY_TRANSCRIPT).expect("happy transcript");
        validate_stream_transcript(UNSUPPORTED_TRANSCRIPT).expect("unsupported transcript");
    }

    #[test]
    fn rejects_duplicate_request_ids() {
        let error = validate_stream_transcript(DUPLICATE_ID_TRANSCRIPT)
            .expect_err("duplicate request id must fail");
        assert!(error.to_string().contains("strictly greater"));
    }

    #[test]
    fn rejects_stale_generations() {
        let error = validate_stream_transcript(STALE_GENERATION_TRANSCRIPT)
            .expect_err("stale generation must fail");
        assert!(error.to_string().contains("generation"));
    }

    #[test]
    fn canonicalizes_itf_sets_maps_and_object_keys() {
        let value = json!({
            "z": 2,
            "set": {"#set": [3, 1, 2]},
            "map": {"#map": [["z", 1], ["a", 2]]},
            "a": {"b": 1, "a": 2}
        });
        let encoded = String::from_utf8(canonical_json_bytes(&value).expect("canonical"))
            .expect("utf8");
        assert_eq!(
            encoded,
            r#"{"a":{"a":2,"b":1},"map":{"#map":[["a",2],["z",1]]},"set":{"#set":[1,2,3]},"z":2}"#
        );
    }

    #[test]
    fn rejects_duplicate_canonical_set_values() {
        let error = canonicalize_json(&json!({"#set": [{"b": 2, "a": 1}, {"a": 1, "b": 2}]}))
            .expect_err("canonical duplicates must fail");
        assert!(error.to_string().contains("duplicate canonical values"));
    }

    #[test]
    fn rejects_floating_point_state() {
        let error = canonicalize_json(&json!({"position": 1.25}))
            .expect_err("floats must fail closed");
        assert!(error.to_string().contains("floating-point"));
    }

    #[test]
    fn golden_messages_round_trip_canonically() {
        for line in HAPPY_TRANSCRIPT.lines() {
            let message = parse_stream_message_line(line.as_bytes()).expect("message");
            let first = canonical_json_bytes(&serde_json::to_value(&message).expect("value"))
                .expect("canonical");
            let reparsed = parse_stream_message_line(&first).expect("reparse");
            let second = canonical_json_bytes(&serde_json::to_value(reparsed).expect("value"))
                .expect("canonical");
            assert_eq!(first, second);
        }
    }
}
