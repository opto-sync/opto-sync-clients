use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::FmError;
use crate::plan::Operation;
use crate::App;

const JSON_RPC_VERSION: &str = "2.0";
const MAX_REQUEST_BYTES: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
struct RpcRequest {
    jsonrpc: String,
    #[serde(default)]
    id: RequestId,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Default)]
struct RequestId(Option<Value>);

impl<'de> Deserialize<'de> for RequestId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Value::deserialize(deserializer).map(|value| Self(Some(value)))
    }
}

enum BoundedLine {
    Eof,
    Line,
    Oversized,
}

#[derive(Debug, Serialize)]
struct RpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
struct RpcError {
    code: i32,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct OperationParams {
    operation: Option<String>,
    dry_run: bool,
    output: Option<PathBuf>,
    adapter: Option<String>,
    traces: Vec<PathBuf>,
}

pub fn serve_stdio(app: App) -> Result<(), FmError> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    run_server(app, stdin.lock(), stdout.lock())
}

pub fn run_server<R: BufRead, W: Write>(
    app: App,
    mut reader: R,
    mut writer: W,
) -> Result<(), FmError> {
    let mut line = Vec::new();
    loop {
        match read_bounded_line(&mut reader, &mut line)
            .map_err(|source| FmError::io("<json-rpc stdin>", source))?
        {
            BoundedLine::Eof => break,
            BoundedLine::Oversized => {
                write_response(
                    &mut writer,
                    RpcResponse::error(
                        Value::Null,
                        -32600,
                        format!("request exceeds {MAX_REQUEST_BYTES} bytes"),
                        None,
                    ),
                )?;
                continue;
            }
            BoundedLine::Line => {}
        }
        if line.iter().all(|byte| byte.is_ascii_whitespace()) {
            continue;
        }

        let value: Value = match serde_json::from_slice(&line) {
            Ok(value) => value,
            Err(error) => {
                write_response(
                    &mut writer,
                    RpcResponse::error(
                        Value::Null,
                        -32700,
                        "parse error".to_owned(),
                        Some(json!({ "detail": error.to_string() })),
                    ),
                )?;
                continue;
            }
        };
        let request: RpcRequest = match serde_json::from_value(value) {
            Ok(request) => request,
            Err(error) => {
                write_response(
                    &mut writer,
                    RpcResponse::error(
                        Value::Null,
                        -32600,
                        "invalid request".to_owned(),
                        Some(json!({ "detail": error.to_string() })),
                    ),
                )?;
                continue;
            }
        };
        let id = request.id.0.clone().unwrap_or(Value::Null);
        let notification = request.id.0.is_none();
        if !matches!(&id, Value::Null | Value::String(_) | Value::Number(_)) {
            if !notification {
                write_response(
                    &mut writer,
                    RpcResponse::error(
                        Value::Null,
                        -32600,
                        "request id must be a string, number, or null".to_owned(),
                        None,
                    ),
                )?;
            }
            continue;
        }

        if request.jsonrpc != JSON_RPC_VERSION {
            if !notification {
                write_response(
                    &mut writer,
                    RpcResponse::error(
                        id,
                        -32600,
                        "jsonrpc must be exactly '2.0'".to_owned(),
                        None,
                    ),
                )?;
            }
            continue;
        }

        let shutdown = request.method == "fm.shutdown";
        let response = match dispatch(&app, &request.method, request.params) {
            Ok(result) => RpcResponse::success(id, result),
            Err(error) => RpcResponse::error(id, error.code, error.message, error.data),
        };
        if !notification {
            write_response(&mut writer, response)?;
        }
        if shutdown {
            break;
        }
    }
    Ok(())
}

fn read_bounded_line<R: BufRead>(reader: &mut R, line: &mut Vec<u8>) -> io::Result<BoundedLine> {
    line.clear();
    let mut oversized = false;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if line.is_empty() && !oversized {
                Ok(BoundedLine::Eof)
            } else if oversized {
                Ok(BoundedLine::Oversized)
            } else {
                Ok(BoundedLine::Line)
            };
        }
        let consumed = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        let newline = available[consumed - 1] == b'\n';
        if !oversized {
            let remaining = MAX_REQUEST_BYTES.saturating_sub(line.len());
            let copied = consumed.min(remaining);
            line.extend_from_slice(&available[..copied]);
            oversized = copied < consumed;
        }
        reader.consume(consumed);
        if newline {
            return Ok(if oversized {
                BoundedLine::Oversized
            } else {
                BoundedLine::Line
            });
        }
    }
}

fn dispatch(app: &App, method: &str, params: Value) -> Result<Value, RpcFault> {
    match method {
        "fm.capabilities" => Ok(json!({
            "schema_version": 1,
            "transport": "json-rpc-2.0-stdio",
            "adapter_protocol": "fmctl.adapter.v1",
            "methods": [
                "fm.capabilities",
                "fm.validate",
                "fm.doctor",
                "fm.plan",
                "fm.check",
                "fm.simulate",
                "fm.verify",
                "fm.trace",
                "fm.replay",
                "fm.shutdown"
            ],
            "execution": "serial",
            "report_bundle_schema": "fm.report-bundle.v1"
        })),
        "fm.validate" => serde_json::to_value(app.validate().map_err(RpcFault::from_fm)?)
            .map_err(RpcFault::from_json),
        "fm.doctor" => serde_json::to_value(app.doctor().map_err(RpcFault::from_fm)?)
            .map_err(RpcFault::from_json),
        "fm.plan" => {
            let params = parse_params(params)?;
            let name = params.operation.as_deref().ok_or_else(|| RpcFault {
                code: -32602,
                message: "fm.plan requires params.operation".to_owned(),
                data: None,
            })?;
            let operation = operation_from_name(name, &params)?;
            let plan = app.plan(&operation).map_err(RpcFault::from_fm)?;
            Ok(json!({ "kind": "plan", "plan": plan }))
        }
        "fm.check" | "fm.simulate" | "fm.verify" | "fm.trace" | "fm.replay" => {
            let params = parse_params(params)?;
            let operation = operation_from_name(method.trim_start_matches("fm."), &params)?;
            if params.dry_run {
                let plan = app.plan(&operation).map_err(RpcFault::from_fm)?;
                Ok(json!({ "kind": "plan", "plan": plan }))
            } else {
                let execution = app
                    .execute_with_report_bundle(&operation)
                    .map_err(RpcFault::from_fm)?;
                Ok(json!({ "kind": "execution", "execution": execution }))
            }
        }
        "fm.shutdown" => Ok(json!({ "shutdown": true })),
        _ => Err(RpcFault {
            code: -32601,
            message: format!("method not found: {method}"),
            data: None,
        }),
    }
}

fn parse_params(params: Value) -> Result<OperationParams, RpcFault> {
    if params.is_null() {
        return Ok(OperationParams::default());
    }
    serde_json::from_value(params).map_err(|error| RpcFault {
        code: -32602,
        message: "invalid params".to_owned(),
        data: Some(json!({ "detail": error.to_string() })),
    })
}

fn operation_from_name(name: &str, params: &OperationParams) -> Result<Operation, RpcFault> {
    match name {
        "check" => Ok(Operation::Check),
        "simulate" => Ok(Operation::Simulate),
        "verify" => Ok(Operation::Verify),
        "trace" => Ok(Operation::Trace {
            output: params.output.clone(),
        }),
        "replay" => Ok(Operation::Replay {
            adapter: params.adapter.clone().ok_or_else(|| RpcFault {
                code: -32602,
                message: "replay requires params.adapter".to_owned(),
                data: None,
            })?,
            traces: params.traces.clone(),
        }),
        _ => Err(RpcFault {
            code: -32602,
            message: format!("unsupported operation: {name}"),
            data: None,
        }),
    }
}

fn write_response<W: Write>(writer: &mut W, response: RpcResponse) -> Result<(), FmError> {
    serde_json::to_writer(&mut *writer, &response)?;
    writer
        .write_all(b"\n")
        .map_err(|source| FmError::io("<json-rpc stdout>", source))?;
    writer
        .flush()
        .map_err(|source| FmError::io("<json-rpc stdout>", source))
}

impl RpcResponse {
    fn success(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: JSON_RPC_VERSION,
            id,
            result: Some(result),
            error: None,
        }
    }

    fn error(id: Value, code: i32, message: String, data: Option<Value>) -> Self {
        Self {
            jsonrpc: JSON_RPC_VERSION,
            id,
            result: None,
            error: Some(RpcError {
                code,
                message,
                data,
            }),
        }
    }
}

struct RpcFault {
    code: i32,
    message: String,
    data: Option<Value>,
}

impl RpcFault {
    fn from_fm(error: FmError) -> Self {
        Self {
            code: -32000 - i32::from(error.exit_code()),
            message: error.to_string(),
            data: Some(json!({ "exit_code": error.exit_code() })),
        }
    }

    fn from_json(error: serde_json::Error) -> Self {
        Self {
            code: -32603,
            message: "internal JSON serialization error".to_owned(),
            data: Some(json!({ "detail": error.to_string() })),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{App, InitRequest};
    use std::io::Cursor;
    use tempfile::TempDir;

    #[test]
    fn stdio_server_uses_the_same_validation_core() {
        let directory = TempDir::new().expect("tempdir");
        let app = App::new(directory.path(), "formal/fm.toml");
        app.init(&InitRequest {
            project: "example".to_owned(),
            model: "counter".to_owned(),
            spec: PathBuf::from("formal/counter.qnt"),
            main: "counter".to_owned(),
            force: false,
        })
        .expect("init");

        let input = Cursor::new(
            b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"fm.validate\"}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"fm.shutdown\"}\n",
        );
        let mut output = Vec::new();
        run_server(app, input, &mut output).expect("server");
        let lines = String::from_utf8(output).expect("utf8");
        assert!(lines.contains("\"valid\":true"));
        assert!(lines.contains("\"shutdown\":true"));
    }

    #[test]
    fn explicit_null_id_is_not_a_notification() {
        let directory = TempDir::new().expect("tempdir");
        let app = App::new(directory.path(), "formal/fm.toml");
        app.init(&InitRequest {
            project: "example".to_owned(),
            model: "counter".to_owned(),
            spec: PathBuf::from("formal/counter.qnt"),
            main: "counter".to_owned(),
            force: false,
        })
        .expect("init");
        let input =
            Cursor::new(b"{\"jsonrpc\":\"2.0\",\"id\":null,\"method\":\"fm.capabilities\"}\n");
        let mut output = Vec::new();
        run_server(app, input, &mut output).expect("server");
        let response: Value = serde_json::from_slice(&output).expect("response");
        assert!(response.get("id").is_some_and(Value::is_null));
        assert!(response.get("result").is_some());
    }

    #[test]
    fn oversized_request_is_drained_before_the_next_request() {
        let directory = TempDir::new().expect("tempdir");
        let app = App::new(directory.path(), "formal/fm.toml");
        let mut input = vec![b'x'; MAX_REQUEST_BYTES + 1];
        input.extend_from_slice(b"\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"fm.shutdown\"}\n");
        let mut output = Vec::new();
        run_server(app, Cursor::new(input), &mut output).expect("server");
        let lines = String::from_utf8(output).expect("utf8");
        assert!(lines.contains("request exceeds"));
        assert!(lines.contains("\"shutdown\":true"));
    }
}
