use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

pub const STREAM_ADAPTER_PROTOCOL: &str = "fm.adapter.stream.v1";
pub const STREAM_ADAPTER_PROTOCOL_VERSION: u32 = 1;
pub const MAX_STREAM_MESSAGE_BYTES: usize = 1024 * 1024;
pub const MAX_STREAM_GENERATION: u64 = 9_007_199_254_740_991;
const MAX_REQUEST_ID: u64 = MAX_STREAM_GENERATION;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
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

pub const STREAM_CAPABILITY_REGISTRY_V1: [StreamOperationName; 8] = [
    StreamOperationName::Reset,
    StreamOperationName::Apply,
    StreamOperationName::Observe,
    StreamOperationName::Settle,
    StreamOperationName::Snapshot,
    StreamOperationName::Restore,
    StreamOperationName::Fault,
    StreamOperationName::Close,
];

pub const STREAM_REQUIRED_CAPABILITIES_V1: [StreamOperationName; 4] = [
    StreamOperationName::Reset,
    StreamOperationName::Apply,
    StreamOperationName::Observe,
    StreamOperationName::Close,
];

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
    pub capabilities: Vec<StreamOperationName>,
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

impl StreamOperationName {
    fn wire_name(self) -> &'static str {
        match self {
            Self::Hello => "hello",
            Self::Reset => "reset",
            Self::Apply => "apply",
            Self::Observe => "observe",
            Self::Settle => "settle",
            Self::Snapshot => "snapshot",
            Self::Restore => "restore",
            Self::Fault => "fault",
            Self::Close => "close",
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
        validate_generation(self.generation)?;
        match &self.operation {
            StreamOperation::Hello
            | StreamOperation::Observe
            | StreamOperation::Snapshot
            | StreamOperation::Close => {}
            StreamOperation::Reset {
                initial_state,
                seed,
                logical_time,
            } => {
                canonicalize_json(initial_state)?;
                canonicalize_json(logical_time)?;
                if seed.as_ref().is_some_and(|value| value.trim().is_empty()) {
                    return invalid("reset seed must be absent or nonempty");
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
                    return invalid(format!(
                        "settle maxSteps must be between 1 and {MAX_SETTLE_STEPS}"
                    ));
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
}

impl StreamResponse {
    pub fn validate(&self) -> Result<(), StreamProtocolError> {
        validate_envelope(
            &self.protocol,
            self.protocol_version,
            &self.request_id,
            &self.machine,
        )?;
        validate_generation(self.generation)?;
        match (&self.operation, &self.outcome) {
            (StreamOperationName::Hello, StreamOutcome::Ok { value }) => {
                decode_hello_result(value)?.validate()?;
                canonicalize_json(value)?;
            }
            (_, StreamOutcome::Ok { value }) => {
                canonicalize_json(value)?;
            }
            (_, StreamOutcome::Error { error } | StreamOutcome::Unsupported { error }) => {
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
        validate_label("implementation version", &self.implementation.version, 256)?;
        validate_sha256(
            "canonicalStateSchemaHash",
            &self.canonical_state_schema_hash,
        )?;
        let canonical = canonicalize_capability_set_v1(&self.capabilities)?;
        if canonical != self.capabilities {
            return invalid(format!(
                "hello capabilities are not in canonical v1 order: got {:?}; expected {:?}",
                self.capabilities
                    .iter()
                    .map(|capability| capability.wire_name())
                    .collect::<Vec<_>>(),
                canonical
                    .iter()
                    .map(|capability| capability.wire_name())
                    .collect::<Vec<_>>()
            ));
        }
        Ok(())
    }
}

fn decode_hello_result(value: &Value) -> Result<HelloResult, StreamProtocolError> {
    serde_json::from_value(value.clone()).map_err(|error| {
        protocol_error(format!(
            "hello success value does not match the capability contract: {error}"
        ))
    })
}

pub fn canonicalize_capability_set_v1(
    capabilities: &[StreamOperationName],
) -> Result<Vec<StreamOperationName>, StreamProtocolError> {
    let mut seen = BTreeSet::new();
    for capability in capabilities {
        if *capability == StreamOperationName::Hello {
            return invalid("hello capabilities must not advertise hello");
        }
        if !seen.insert(*capability) {
            return invalid(format!(
                "hello capabilities contain duplicate {:?}",
                capability.wire_name()
            ));
        }
    }

    let missing = STREAM_REQUIRED_CAPABILITIES_V1
        .into_iter()
        .filter(|capability| !seen.contains(capability))
        .map(StreamOperationName::wire_name)
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return invalid(format!(
            "hello result is missing required capabilities: {}",
            missing.join(", ")
        ));
    }

    Ok(STREAM_CAPABILITY_REGISTRY_V1
        .into_iter()
        .filter(|capability| seen.contains(capability))
        .collect())
}

pub fn parse_stream_message_line(line: &[u8]) -> Result<StreamMessage, StreamProtocolError> {
    if line.len() > MAX_STREAM_MESSAGE_BYTES {
        return Err(StreamProtocolError::MessageTooLarge);
    }
    if line.is_empty() || line.iter().all(|byte| byte.is_ascii_whitespace()) {
        return invalid("stream adapter line must contain one JSON object");
    }
    if line.contains(&b'\n') || line.contains(&b'\r') {
        return invalid("stream adapter parser accepts one line without a terminator");
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
        Value::Number(number) if number.is_i64() || number.is_u64() => Ok(value.clone()),
        Value::Number(_) => invalid("canonical adapter JSON forbids floating-point numbers"),
        Value::Array(values) => Ok(Value::Array(
            values
                .iter()
                .map(canonicalize_json)
                .collect::<Result<Vec<_>, _>>()?,
        )),
        Value::Object(object) => canonicalize_object(object),
    }
}

fn canonicalize_object(object: &Map<String, Value>) -> Result<Value, StreamProtocolError> {
    if object.len() == 1 {
        if let Some(value) = object.get("#bigint") {
            let encoded = value
                .as_str()
                .ok_or_else(|| protocol_error("ITF #bigint must contain a string"))?;
            validate_decimal("ITF #bigint", encoded, true)?;
            return Ok(singleton("#bigint", Value::String(encoded.to_owned())));
        }
        if let Some(value) = object.get("#set") {
            return canonicalize_set(value);
        }
        if let Some(value) = object.get("#map") {
            return canonicalize_map(value);
        }
    }

    let mut sorted = BTreeMap::new();
    for (key, value) in object {
        sorted.insert(key.clone(), canonicalize_json(value)?);
    }
    let canonical: Map<String, Value> = sorted.into_iter().collect();
    Ok(Value::Object(canonical))
}

fn canonicalize_set(value: &Value) -> Result<Value, StreamProtocolError> {
    let values = value
        .as_array()
        .ok_or_else(|| protocol_error("ITF #set must contain an array"))?;
    let mut sorted = BTreeMap::new();
    for value in values {
        let canonical = canonicalize_json(value)?;
        let key = serde_json::to_string(&canonical)?;
        if sorted.insert(key, canonical).is_some() {
            return invalid("ITF #set contains duplicate canonical values");
        }
    }
    Ok(singleton(
        "#set",
        Value::Array(sorted.into_values().collect()),
    ))
}

fn canonicalize_map(value: &Value) -> Result<Value, StreamProtocolError> {
    let entries = value
        .as_array()
        .ok_or_else(|| protocol_error("ITF #map must contain an array"))?;
    let mut sorted = BTreeMap::new();
    for entry in entries {
        let pair = entry
            .as_array()
            .filter(|pair| pair.len() == 2)
            .ok_or_else(|| {
                protocol_error("each ITF #map entry must be a two-element [key, value] array")
            })?;
        let key = canonicalize_json(&pair[0])?;
        let value = canonicalize_json(&pair[1])?;
        let encoded_key = serde_json::to_string(&key)?;
        if sorted.insert(encoded_key, (key, value)).is_some() {
            return invalid("ITF #map contains duplicate canonical keys");
        }
    }
    let canonical = sorted
        .into_values()
        .map(|(key, value)| Value::Array(vec![key, value]))
        .collect();
    Ok(singleton("#map", Value::Array(canonical)))
}

fn singleton(key: &str, value: Value) -> Value {
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
    generation: u64,
    last_request_id: u64,
    pending: Option<PendingRequest>,
    capabilities: BTreeSet<StreamOperationName>,
}

impl Default for StreamTranscriptValidator {
    fn default() -> Self {
        Self {
            phase: SessionPhase::AwaitHello,
            generation: 0,
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
            return invalid(format!(
                "transcript ended before response to request {}",
                pending.request_id
            ));
        }
        if self.phase != SessionPhase::Closed {
            return invalid("complete transcript must end with a successful close response");
        }
        Ok(())
    }

    fn accept_request(&mut self, request: &StreamRequest) -> Result<(), StreamProtocolError> {
        if self.phase == SessionPhase::Closed {
            return invalid("request received after the session closed");
        }
        if let Some(pending) = &self.pending {
            return invalid(format!(
                "request {} arrived before response to request {}",
                request.request_id, pending.request_id
            ));
        }

        let request_id = parse_request_id(&request.request_id)?;
        if request_id <= self.last_request_id {
            return invalid(format!(
                "request id {} must be strictly greater than {}",
                request.request_id, self.last_request_id
            ));
        }

        let operation = request.operation.name();
        match self.phase {
            SessionPhase::AwaitHello => {
                if operation != StreamOperationName::Hello || request.generation != 0 {
                    return invalid("the first request must be hello at generation 0");
                }
            }
            SessionPhase::Ready => {
                if operation == StreamOperationName::Hello {
                    return invalid("hello may only occur before the session is ready");
                }
                let expected_generation = if operation == StreamOperationName::Reset {
                    if self.generation == MAX_STREAM_GENERATION {
                        return invalid("adapter generation cannot advance beyond 2^53-1");
                    }
                    self.generation + 1
                } else {
                    self.generation
                };
                if request.generation != expected_generation {
                    return invalid(format!(
                        "request {} uses generation {}; expected {expected_generation}",
                        request.request_id, request.generation
                    ));
                }
            }
            SessionPhase::Closed => unreachable!(),
        }

        self.last_request_id = request_id;
        self.pending = Some(PendingRequest {
            request_id: request.request_id.clone(),
            machine: request.machine.clone(),
            generation: request.generation,
            operation,
        });
        Ok(())
    }

    fn accept_response(&mut self, response: &StreamResponse) -> Result<(), StreamProtocolError> {
        let pending = self.pending.as_ref().cloned().ok_or_else(|| {
            protocol_error(format!(
                "response {} has no pending request",
                response.request_id
            ))
        })?;
        if response.request_id != pending.request_id
            || response.machine != pending.machine
            || response.generation != pending.generation
            || response.operation != pending.operation
        {
            return invalid("response does not echo the pending request identity");
        }

        let mut next_phase = self.phase;
        let mut next_generation = self.generation;
        let mut next_capabilities = self.capabilities.clone();

        match (&pending.operation, &response.outcome) {
            (StreamOperationName::Hello, StreamOutcome::Ok { value }) => {
                let hello = decode_hello_result(value)?;
                hello.validate()?;
                next_capabilities = hello.capabilities.iter().copied().collect();
                next_phase = SessionPhase::Ready;
            }
            (StreamOperationName::Hello, _) => {
                return invalid("hello must succeed");
            }
            (StreamOperationName::Reset, StreamOutcome::Ok { .. }) => {
                if self.generation == MAX_STREAM_GENERATION {
                    return invalid("adapter generation cannot advance beyond 2^53-1");
                }
                let expected = self.generation + 1;
                if pending.generation != expected {
                    return invalid(format!(
                        "successful reset response generation {} does not advance {} by one",
                        pending.generation, self.generation
                    ));
                }
                next_generation = pending.generation;
            }
            (StreamOperationName::Close, StreamOutcome::Ok { .. }) => {
                next_phase = SessionPhase::Closed;
            }
            (StreamOperationName::Close, _) => {
                return invalid("close must succeed");
            }
            (operation, StreamOutcome::Ok { .. }) if !self.capabilities.contains(operation) => {
                return invalid(format!(
                    "adapter succeeded for unadvertised capability {operation:?}"
                ));
            }
            (operation, StreamOutcome::Unsupported { .. })
                if self.capabilities.contains(operation) =>
            {
                return invalid(format!(
                    "adapter rejected advertised capability {operation:?} as unsupported"
                ));
            }
            _ => {}
        }

        self.phase = next_phase;
        self.generation = next_generation;
        self.capabilities = next_capabilities;
        self.pending = None;
        Ok(())
    }
}

pub fn validate_stream_transcript(source: &str) -> Result<(), StreamProtocolError> {
    let mut validator = StreamTranscriptValidator::default();
    for (index, line) in source.lines().enumerate() {
        if line.trim().is_empty() {
            return invalid(format!("transcript line {} is blank", index + 1));
        }
        let message = parse_stream_message_line(line.as_bytes())
            .map_err(|error| protocol_error(format!("transcript line {}: {error}", index + 1)))?;
        validator
            .accept(&message)
            .map_err(|error| protocol_error(format!("transcript line {}: {error}", index + 1)))?;
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
        return invalid(format!(
            "protocol must be exactly {STREAM_ADAPTER_PROTOCOL:?}"
        ));
    }
    if protocol_version != STREAM_ADAPTER_PROTOCOL_VERSION {
        return invalid(format!(
            "protocolVersion must be {STREAM_ADAPTER_PROTOCOL_VERSION}"
        ));
    }
    parse_request_id(request_id)?;
    validate_label("machine", machine, 256)
}

fn validate_generation(value: u64) -> Result<(), StreamProtocolError> {
    if value > MAX_STREAM_GENERATION {
        return invalid(format!(
            "generation must be between 0 and {MAX_STREAM_GENERATION}"
        ));
    }
    Ok(())
}

fn parse_request_id(value: &str) -> Result<u64, StreamProtocolError> {
    validate_decimal("requestId", value, false)?;
    let parsed = value
        .parse::<u64>()
        .map_err(|_| protocol_error("requestId exceeds the protocol integer range"))?;
    if parsed == 0 || parsed > MAX_REQUEST_ID {
        return invalid(format!("requestId must be between 1 and {MAX_REQUEST_ID}"));
    }
    Ok(parsed)
}

fn validate_decimal(
    label: &str,
    value: &str,
    allow_negative: bool,
) -> Result<(), StreamProtocolError> {
    let digits = value.strip_prefix('-').unwrap_or(value);
    if value.starts_with('-') && !allow_negative {
        return invalid(format!(
            "{label} must be an unsigned canonical decimal string"
        ));
    }
    if digits.is_empty()
        || !digits.bytes().all(|byte| byte.is_ascii_digit())
        || (digits.len() > 1 && digits.starts_with('0'))
        || value == "-0"
    {
        return invalid(format!("{label} must be a canonical decimal string"));
    }
    Ok(())
}

fn validate_label(label: &str, value: &str, max: usize) -> Result<(), StreamProtocolError> {
    if value.trim().is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return invalid(format!(
            "{label} must be nonempty, at most {max} bytes, and contain no control characters"
        ));
    }
    Ok(())
}

fn validate_sha256(label: &str, value: &str) -> Result<(), StreamProtocolError> {
    let digest = value
        .strip_prefix("sha256:")
        .ok_or_else(|| protocol_error(format!("{label} must use sha256:<hex>")))?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return invalid(format!(
            "{label} must contain exactly 64 lowercase hexadecimal digits"
        ));
    }
    Ok(())
}

fn invalid<T>(message: impl Into<String>) -> Result<T, StreamProtocolError> {
    Err(protocol_error(message))
}

fn protocol_error(message: impl Into<String>) -> StreamProtocolError {
    StreamProtocolError::Invalid(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const HAPPY: &str = include_str!("../../../formal/protocol-fixtures/stream/valid/happy.jsonl");
    const UNSUPPORTED: &str =
        include_str!("../../../formal/protocol-fixtures/stream/valid/unsupported.jsonl");
    const MINIMAL_CAPABILITIES: &str =
        include_str!("../../../formal/protocol-fixtures/stream/valid/minimal-capabilities.jsonl");
    const DUPLICATE_ID: &str =
        include_str!("../../../formal/protocol-fixtures/stream/invalid/duplicate-request-id.jsonl");
    const STALE_GENERATION: &str =
        include_str!("../../../formal/protocol-fixtures/stream/invalid/stale-generation.jsonl");
    const DUPLICATE_CAPABILITY: &str =
        include_str!("../../../formal/protocol-fixtures/stream/invalid/duplicate-capability.jsonl");
    const MISSING_REQUIRED_CAPABILITY: &str = include_str!(
        "../../../formal/protocol-fixtures/stream/invalid/missing-required-capability.jsonl"
    );
    const HELLO_CAPABILITY: &str =
        include_str!("../../../formal/protocol-fixtures/stream/invalid/hello-capability.jsonl");
    const UNKNOWN_CAPABILITY: &str =
        include_str!("../../../formal/protocol-fixtures/stream/invalid/unknown-capability.jsonl");
    const OUT_OF_ORDER_CAPABILITY: &str = include_str!(
        "../../../formal/protocol-fixtures/stream/invalid/out-of-order-capability.jsonl"
    );
    const CAPABILITY_REGISTRY: &str =
        include_str!("../../../formal/protocol-fixtures/stream/capabilities.v1.json");
    const SCHEMA: &str = include_str!("../../../formal/adapter-stream-protocol.schema.json");

    #[test]
    fn schema_and_positive_transcripts_are_valid() {
        serde_json::from_str::<Value>(SCHEMA).expect("schema JSON");
        validate_stream_transcript(HAPPY).expect("happy transcript");
        validate_stream_transcript(UNSUPPORTED).expect("unsupported transcript");
        validate_stream_transcript(MINIMAL_CAPABILITIES).expect("minimal capability transcript");
    }

    #[test]
    fn duplicate_request_ids_and_stale_generations_fail() {
        assert!(validate_stream_transcript(DUPLICATE_ID)
            .expect_err("duplicate id")
            .to_string()
            .contains("strictly greater"));
        assert!(validate_stream_transcript(STALE_GENERATION)
            .expect_err("stale generation")
            .to_string()
            .contains("generation"));
    }

    #[test]
    fn rust_registry_matches_the_shared_machine_readable_contract() {
        let fixture: Value =
            serde_json::from_str(CAPABILITY_REGISTRY).expect("capability registry JSON");
        assert_eq!(
            fixture["protocol"],
            Value::String(STREAM_ADAPTER_PROTOCOL.to_owned())
        );
        assert_eq!(
            fixture["protocolVersion"],
            Value::Number(STREAM_ADAPTER_PROTOCOL_VERSION.into())
        );
        assert_eq!(
            fixture["wireRule"],
            Value::String("strict-subsequence".to_owned())
        );
        assert_eq!(
            fixture["registry"],
            serde_json::to_value(STREAM_CAPABILITY_REGISTRY_V1).expect("registry value")
        );
        assert_eq!(
            fixture["required"],
            serde_json::to_value(STREAM_REQUIRED_CAPABILITIES_V1).expect("required value")
        );
    }

    #[test]
    fn canonicalizes_application_capability_sets_to_wire_order() {
        let actual = canonicalize_capability_set_v1(&[
            StreamOperationName::Close,
            StreamOperationName::Fault,
            StreamOperationName::Observe,
            StreamOperationName::Reset,
            StreamOperationName::Snapshot,
            StreamOperationName::Apply,
        ])
        .expect("valid capability set");
        assert_eq!(
            actual,
            vec![
                StreamOperationName::Reset,
                StreamOperationName::Apply,
                StreamOperationName::Observe,
                StreamOperationName::Snapshot,
                StreamOperationName::Fault,
                StreamOperationName::Close,
            ]
        );
    }

    #[test]
    fn malformed_capability_transcripts_fail_at_the_hello_boundary() {
        for (name, source, expected) in [
            ("duplicate", DUPLICATE_CAPABILITY, "duplicate"),
            (
                "missing required",
                MISSING_REQUIRED_CAPABILITY,
                "missing required",
            ),
            (
                "hello advertised",
                HELLO_CAPABILITY,
                "must not advertise hello",
            ),
            ("unknown", UNKNOWN_CAPABILITY, "unknown variant"),
            (
                "out of order",
                OUT_OF_ORDER_CAPABILITY,
                "canonical v1 order",
            ),
        ] {
            let error = validate_stream_transcript(source).expect_err(name);
            assert!(
                error.to_string().contains(expected),
                "{name}: expected {expected:?}, got {error}"
            );
        }
    }

    #[test]
    fn rejects_generations_above_the_javascript_safe_integer() {
        let message = StreamMessage::Request(StreamRequest {
            protocol: STREAM_ADAPTER_PROTOCOL.to_owned(),
            protocol_version: STREAM_ADAPTER_PROTOCOL_VERSION,
            request_id: "1".to_owned(),
            machine: "machine".to_owned(),
            generation: MAX_STREAM_GENERATION + 1,
            operation: StreamOperation::Observe,
        });
        assert!(message
            .validate()
            .expect_err("unsafe generation")
            .to_string()
            .contains("generation"));
    }

    #[test]
    fn rejected_response_retains_pending_request_for_a_valid_retry() {
        let mut validator = StreamTranscriptValidator::default();
        let request = StreamRequest {
            protocol: STREAM_ADAPTER_PROTOCOL.to_owned(),
            protocol_version: STREAM_ADAPTER_PROTOCOL_VERSION,
            request_id: "1".to_owned(),
            machine: "machine".to_owned(),
            generation: 0,
            operation: StreamOperation::Hello,
        };
        validator
            .accept(&StreamMessage::Request(request))
            .expect("hello request");

        let hello_value = json!({
            "implementation": {
                "language": "rust",
                "name": "test",
                "version": "1"
            },
            "capabilities": ["reset", "apply", "observe", "close"],
            "canonicalStateSchemaHash": format!("sha256:{}", "0".repeat(64))
        });
        let mut response = StreamResponse {
            protocol: STREAM_ADAPTER_PROTOCOL.to_owned(),
            protocol_version: STREAM_ADAPTER_PROTOCOL_VERSION,
            request_id: "2".to_owned(),
            machine: "machine".to_owned(),
            generation: 0,
            operation: StreamOperationName::Hello,
            outcome: StreamOutcome::Ok { value: hello_value },
        };
        validator
            .accept(&StreamMessage::Response(response.clone()))
            .expect_err("mismatched response");
        response.request_id = "1".to_owned();
        validator
            .accept(&StreamMessage::Response(response))
            .expect("valid retry");
    }

    #[test]
    fn rejected_hello_capabilities_leave_pending_state_for_a_valid_retry() {
        let mut validator = StreamTranscriptValidator::default();
        validator
            .accept(&StreamMessage::Request(StreamRequest {
                protocol: STREAM_ADAPTER_PROTOCOL.to_owned(),
                protocol_version: STREAM_ADAPTER_PROTOCOL_VERSION,
                request_id: "1".to_owned(),
                machine: "machine".to_owned(),
                generation: 0,
                operation: StreamOperation::Hello,
            }))
            .expect("hello request");

        let mut response = StreamResponse {
            protocol: STREAM_ADAPTER_PROTOCOL.to_owned(),
            protocol_version: STREAM_ADAPTER_PROTOCOL_VERSION,
            request_id: "1".to_owned(),
            machine: "machine".to_owned(),
            generation: 0,
            operation: StreamOperationName::Hello,
            outcome: StreamOutcome::Ok {
                value: hello_value(json!([
                    "reset", "apply", "observe", "snapshot", "settle", "close"
                ])),
            },
        };
        validator
            .accept(&StreamMessage::Response(response.clone()))
            .expect_err("out-of-order capabilities");

        response.outcome = StreamOutcome::Ok {
            value: hello_value(json!(["reset", "apply", "observe", "close"])),
        };
        validator
            .accept(&StreamMessage::Response(response))
            .expect("canonical retry");
    }

    #[test]
    fn canonical_hello_capability_bytes_round_trip_without_drift() {
        let message = StreamMessage::Response(StreamResponse {
            protocol: STREAM_ADAPTER_PROTOCOL.to_owned(),
            protocol_version: STREAM_ADAPTER_PROTOCOL_VERSION,
            request_id: "1".to_owned(),
            machine: "machine".to_owned(),
            generation: 0,
            operation: StreamOperationName::Hello,
            outcome: StreamOutcome::Ok {
                value: hello_value(json!([
                    "reset", "apply", "observe", "settle", "snapshot", "restore", "fault", "close"
                ])),
            },
        });
        message.validate().expect("canonical hello");
        let first = canonical_json_bytes(&serde_json::to_value(&message).expect("message value"))
            .expect("canonical bytes");
        let expected =
            br#""capabilities":["reset","apply","observe","settle","snapshot","restore","fault","close"]"#;
        assert!(
            first
                .windows(expected.len())
                .any(|window| window == expected),
            "missing canonical capability bytes: {}",
            String::from_utf8_lossy(&first)
        );
        let reparsed = parse_stream_message_line(&first).expect("reparse canonical hello");
        let second = canonical_json_bytes(&serde_json::to_value(reparsed).expect("reparsed value"))
            .expect("second canonical bytes");
        assert_eq!(first, second);
    }

    fn hello_value(capabilities: Value) -> Value {
        json!({
            "implementation": {
                "language": "rust",
                "name": "capability-test",
                "version": "1"
            },
            "capabilities": capabilities,
            "canonicalStateSchemaHash": format!("sha256:{}", "0".repeat(64))
        })
    }

    #[test]
    fn canonicalizes_itf_sets_maps_and_object_keys() {
        let value = json!({
            "z": 2,
            "set": {"#set": [3, 1, 2]},
            "map": {"#map": [["z", 1], ["a", 2]]},
            "a": {"b": 1, "a": 2}
        });
        let actual = canonicalize_json(&value).expect("canonical");
        let expected = json!({
            "a": {"a": 2, "b": 1},
            "map": {"#map": [["a", 2], ["z", 1]]},
            "set": {"#set": [1, 2, 3]},
            "z": 2
        });
        assert_eq!(actual, expected);
    }

    #[test]
    fn rejects_ambiguous_canonical_values() {
        assert!(canonicalize_json(&json!({
            "#set": [{"b": 2, "a": 1}, {"a": 1, "b": 2}]
        }))
        .expect_err("duplicate set")
        .to_string()
        .contains("duplicate canonical values"));
        assert!(canonicalize_json(&json!({"position": 1.25}))
            .expect_err("float")
            .to_string()
            .contains("floating-point"));
    }

    #[test]
    fn golden_messages_round_trip_canonically() {
        for line in HAPPY.lines() {
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
