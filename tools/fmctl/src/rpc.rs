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
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
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
    let mut line = String::new();
    loop {
        line.clear();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|source| FmError::io("<json-rpc stdin>", source))?;
        if bytes == 0 {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }
        if bytes > MAX_REQUEST_BYTES {
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

        let request: RpcRequest = match serde_json::from_str(&line) {
            Ok(request) => request,
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
        let id = request.id.clone().unwrap_or(Value::Null);
        let notification = request.id.is_none();

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
            "execution": "serial"
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
                let outcome = app.execute(&operation).map_err(RpcFault::from_fm)?;
                Ok(json!({ "kind": "outcome", "outcome": outcome }))
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
}
