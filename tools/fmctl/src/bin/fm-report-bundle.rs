use std::fs;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, ValueEnum};
use fmctl::result::report::{
    render_artifact_manifest_json, render_junit_xml, render_provenance_json,
    render_report_bundle_json, render_sarif_json,
};
use fmctl::runner::CommandOutcome;

const MAX_RESULT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Parser)]
#[command(
    name = "fm-report-bundle",
    about = "Render deterministic, secret-free reports from one fmctl result.json"
)]
struct Cli {
    #[arg(value_name = "RESULT_JSON")]
    result: PathBuf,

    #[arg(long, value_enum, default_value_t = ReportFormat::Bundle)]
    format: ReportFormat,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum ReportFormat {
    Bundle,
    Junit,
    Sarif,
    ArtifactManifest,
    Provenance,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("fm-report-bundle: {error}");
            ExitCode::from(2)
        }
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let outcome = read_outcome(&cli.result)?;
    let bytes = match cli.format {
        ReportFormat::Bundle => render_report_bundle_json(&outcome)?,
        ReportFormat::Junit => render_junit_xml(&outcome)?.into_bytes(),
        ReportFormat::Sarif => render_sarif_json(&outcome)?,
        ReportFormat::ArtifactManifest => render_artifact_manifest_json(&outcome)?,
        ReportFormat::Provenance => render_provenance_json(&outcome)?,
    };
    let mut stdout = io::stdout().lock();
    stdout.write_all(&bytes)?;
    if !bytes.ends_with(b"\n") {
        stdout.write_all(b"\n")?;
    }
    Ok(())
}

fn read_outcome(path: &PathBuf) -> Result<CommandOutcome, Box<dyn std::error::Error>> {
    let file = fs::File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(format!("result input must be a regular file: {}", path.display()).into());
    }
    let reported = usize::try_from(metadata.len()).unwrap_or(usize::MAX);
    if reported > MAX_RESULT_BYTES {
        return Err(format!(
            "result input exceeds the {MAX_RESULT_BYTES}-byte limit before reading: {}",
            path.display()
        )
        .into());
    }
    let read_limit = u64::try_from(MAX_RESULT_BYTES)
        .unwrap_or(u64::MAX)
        .saturating_add(1);
    let mut bytes = Vec::with_capacity(reported.min(MAX_RESULT_BYTES));
    file.take(read_limit).read_to_end(&mut bytes)?;
    if bytes.len() > MAX_RESULT_BYTES {
        return Err(format!(
            "result input grew beyond the {MAX_RESULT_BYTES}-byte limit while reading: {}",
            path.display()
        )
        .into());
    }
    Ok(serde_json::from_slice(&bytes)?)
}
