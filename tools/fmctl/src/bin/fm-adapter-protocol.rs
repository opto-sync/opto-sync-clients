use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::Path;
use std::process::ExitCode;

#[allow(dead_code)]
#[path = "../adapter_stream_v1.rs"]
mod adapter_stream;

use adapter_stream::{
    canonical_json_bytes, parse_stream_message_line, validate_stream_transcript,
    MAX_STREAM_MESSAGE_BYTES,
};
use serde_json::{json, Value};

const MAX_TRANSCRIPT_BYTES: usize = 64 * 1024 * 1024;
const MAX_TRANSCRIPT_MESSAGES: usize = 100_000;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("fm-adapter-protocol: {error}");
            ExitCode::from(2)
        }
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = env::args_os();
    let _program = arguments.next();
    let command = arguments
        .next()
        .and_then(|value| value.into_string().ok())
        .ok_or_else(usage_error)?;
    let path = arguments.next().ok_or_else(usage_error)?;
    if arguments.next().is_some() {
        return Err(usage_error().into());
    }

    match command.as_str() {
        "validate-transcript" => {
            let source = read_bounded_file(Path::new(&path), MAX_TRANSCRIPT_BYTES)?;
            let source = std::str::from_utf8(&source).map_err(|error| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("transcript must be UTF-8: {error}"),
                )
            })?;
            let message_count = source.lines().count();
            if message_count > MAX_TRANSCRIPT_MESSAGES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "transcript contains {message_count} messages; maximum is {MAX_TRANSCRIPT_MESSAGES}"
                    ),
                )
                .into());
            }
            validate_stream_transcript(source)?;
            write_json(&json!({
                "valid": true,
                "kind": "stream-transcript",
                "messages": message_count,
                "path": path.to_string_lossy(),
            }))?;
        }
        "validate-message" => {
            let source = read_bounded_file(Path::new(&path), MAX_STREAM_MESSAGE_BYTES)?;
            let source = trim_one_line_terminator(&source);
            let message = parse_stream_message_line(source)?;
            write_json(&json!({
                "valid": true,
                "kind": "stream-message",
                "message": message,
            }))?;
        }
        "canonicalize-json" => {
            let source = read_bounded_file(Path::new(&path), MAX_STREAM_MESSAGE_BYTES)?;
            let value: Value = serde_json::from_slice(&source)?;
            let canonical = canonical_json_bytes(&value)?;
            io::stdout().write_all(&canonical)?;
            io::stdout().write_all(b"\n")?;
        }
        _ => return Err(usage_error().into()),
    }
    Ok(())
}

fn read_bounded_file(path: &Path, maximum: usize) -> Result<Vec<u8>, io::Error> {
    let metadata = fs::metadata(path)?;
    let maximum_u64 = u64::try_from(maximum).unwrap_or(u64::MAX);
    if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("input must be a regular file: {}", path.display()),
        ));
    }
    if metadata.len() > maximum_u64 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "input exceeds the {maximum}-byte limit: {}",
                path.display()
            ),
        ));
    }
    let source = fs::read(path)?;
    if source.len() > maximum {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "input grew beyond the {maximum}-byte limit while reading: {}",
                path.display()
            ),
        ));
    }
    Ok(source)
}

fn trim_one_line_terminator(source: &[u8]) -> &[u8] {
    source
        .strip_suffix(b"\r\n")
        .or_else(|| source.strip_suffix(b"\n"))
        .unwrap_or(source)
}

fn write_json(value: &Value) -> Result<(), Box<dyn std::error::Error>> {
    serde_json::to_writer(&mut io::stdout(), value)?;
    io::stdout().write_all(b"\n")?;
    Ok(())
}

fn usage_error() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        "usage: fm-adapter-protocol <validate-transcript|validate-message|canonicalize-json> <path>",
    )
}
