use std::io::{self, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand, ValueEnum};
use fmctl::error::FmError;
use fmctl::execution_report::PublishedExecution;
use fmctl::plan::{CommandPlan, Operation};
use fmctl::runner::command_display;
use fmctl::{rpc, App, DoctorReport, InitReport, InitRequest};
use serde::Serialize;
use serde_json::json;

#[derive(Debug, Parser)]
#[command(
    name = "fmctl",
    version,
    about = "Reproducible formal-methods CLI and JSON-RPC server"
)]
struct Cli {
    #[arg(long, global = true, default_value = ".")]
    workspace: PathBuf,

    #[arg(long, global = true, default_value = "formal/fm.toml")]
    manifest: PathBuf,

    #[arg(long, global = true, value_enum, default_value_t = OutputFormat::Human)]
    format: OutputFormat,

    #[arg(long, global = true)]
    dry_run: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum OutputFormat {
    Human,
    Json,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// Create a schema-v1 manifest and starter Quint specification.
    Init(InitArgs),
    /// Parse and validate the manifest, paths, and backend settings.
    Validate,
    /// Print the exact subprocess plan without executing it.
    Plan(PlanArgs),
    /// Typecheck the specification.
    Check,
    /// Run randomized state-machine simulation and witnesses.
    Simulate,
    /// Run the configured model checker.
    Verify,
    /// Generate implementation-replay traces.
    Trace(TraceArgs),
    /// Replay one or more traces through an active language adapter.
    Replay(ReplayArgs),
    /// Probe the pinned verifier toolchain.
    Doctor,
    /// Serve the same operations over JSON-RPC 2.0 on stdin/stdout.
    Serve,
}

#[derive(Debug, Args)]
struct InitArgs {
    #[arg(long)]
    project: String,

    #[arg(long)]
    model: String,

    #[arg(long, default_value = "formal/model.qnt")]
    spec: PathBuf,

    #[arg(long, default_value = "model")]
    main: String,

    #[arg(long)]
    force: bool,
}

#[derive(Debug, Args)]
struct PlanArgs {
    #[arg(value_enum)]
    operation: PlanOperation,

    #[arg(long)]
    output: Option<PathBuf>,

    #[arg(long)]
    adapter: Option<String>,

    #[arg(long = "trace")]
    traces: Vec<PathBuf>,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum PlanOperation {
    Check,
    Simulate,
    Verify,
    Trace,
    Replay,
}

#[derive(Debug, Args)]
struct TraceArgs {
    #[arg(long)]
    output: Option<PathBuf>,
}

#[derive(Debug, Args)]
struct ReplayArgs {
    #[arg(long)]
    adapter: String,

    #[arg(long = "trace", required = true)]
    traces: Vec<PathBuf>,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let format = cli.format;
    match run(cli) {
        Ok(code) => ExitCode::from(code),
        Err(error) => {
            print_error(format, &error);
            ExitCode::from(error.exit_code())
        }
    }
}

fn run(cli: Cli) -> Result<u8, FmError> {
    let app = App::new(cli.workspace, cli.manifest);

    match cli.command {
        Commands::Init(args) => {
            let report = app.init(&InitRequest {
                project: args.project,
                model: args.model,
                spec: args.spec,
                main: args.main,
                force: args.force,
            })?;
            print_init(cli.format, &report)?;
            Ok(0)
        }
        Commands::Validate => {
            let report = app.validate()?;
            print_serialized(cli.format, &report)?;
            Ok(0)
        }
        Commands::Plan(args) => {
            let operation = plan_operation(args)?;
            let plan = app.plan(&operation)?;
            print_plan(cli.format, &plan)?;
            Ok(0)
        }
        Commands::Check => execute_or_plan(&app, cli.format, cli.dry_run, Operation::Check),
        Commands::Simulate => execute_or_plan(&app, cli.format, cli.dry_run, Operation::Simulate),
        Commands::Verify => execute_or_plan(&app, cli.format, cli.dry_run, Operation::Verify),
        Commands::Trace(args) => execute_or_plan(
            &app,
            cli.format,
            cli.dry_run,
            Operation::Trace {
                output: args.output,
            },
        ),
        Commands::Replay(args) => execute_or_plan(
            &app,
            cli.format,
            cli.dry_run,
            Operation::Replay {
                adapter: args.adapter,
                traces: args.traces,
            },
        ),
        Commands::Doctor => {
            let report = app.doctor()?;
            print_doctor(cli.format, &report)?;
            Ok(if report.ready { 0 } else { 4 })
        }
        Commands::Serve => {
            rpc::serve_stdio(app)?;
            Ok(0)
        }
    }
}

fn plan_operation(args: PlanArgs) -> Result<Operation, FmError> {
    match args.operation {
        PlanOperation::Check => Ok(Operation::Check),
        PlanOperation::Simulate => Ok(Operation::Simulate),
        PlanOperation::Verify => Ok(Operation::Verify),
        PlanOperation::Trace => Ok(Operation::Trace {
            output: args.output,
        }),
        PlanOperation::Replay => Ok(Operation::Replay {
            adapter: args
                .adapter
                .ok_or_else(|| FmError::Validation("plan replay requires --adapter".to_owned()))?,
            traces: args.traces,
        }),
    }
}

fn execute_or_plan(
    app: &App,
    format: OutputFormat,
    dry_run: bool,
    operation: Operation,
) -> Result<u8, FmError> {
    if dry_run {
        let plan = app.plan(&operation)?;
        print_plan(format, &plan)?;
        return Ok(0);
    }

    let execution = app.execute_with_report_bundle(&operation)?;
    print_execution(format, &execution)?;
    Ok(execution.stable_exit_code())
}

fn print_init(format: OutputFormat, report: &InitReport) -> Result<(), FmError> {
    match format {
        OutputFormat::Json => print_serialized(format, report),
        OutputFormat::Human => {
            println!("created manifest: {}", report.manifest.display());
            println!("created specification: {}", report.specification.display());
            Ok(())
        }
    }
}

fn print_plan(format: OutputFormat, plan: &CommandPlan) -> Result<(), FmError> {
    match format {
        OutputFormat::Json => print_serialized(format, plan),
        OutputFormat::Human => {
            println!("operation: {}", plan.operation);
            println!("workspace: {}", plan.workspace.display());
            println!("working directory: {}", plan.cwd.display());
            println!("command: {}", command_display(&plan.program, &plan.args));
            println!("timeout: {}s", plan.timeout_seconds);
            println!("result: {}", plan.artifacts.result.display());
            Ok(())
        }
    }
}

fn print_execution(format: OutputFormat, execution: &PublishedExecution) -> Result<(), FmError> {
    match format {
        OutputFormat::Json => print_serialized(format, execution),
        OutputFormat::Human => {
            let outcome = &execution.outcome;
            let mut stdout = io::stdout().lock();
            let mut stderr = io::stderr().lock();
            if !outcome.stdout.is_empty() {
                stdout
                    .write_all(outcome.stdout.as_bytes())
                    .map_err(|source| FmError::io("<stdout>", source))?;
                if !outcome.stdout.ends_with('\n') {
                    stdout
                        .write_all(b"\n")
                        .map_err(|source| FmError::io("<stdout>", source))?;
                }
            }
            if !outcome.stderr.is_empty() {
                stderr
                    .write_all(outcome.stderr.as_bytes())
                    .map_err(|source| FmError::io("<stderr>", source))?;
                if !outcome.stderr.ends_with('\n') {
                    stderr
                        .write_all(b"\n")
                        .map_err(|source| FmError::io("<stderr>", source))?;
                }
            }
            eprintln!(
                "fmctl {}: {} ({} ms; result {}; bundle {})",
                outcome.operation,
                if outcome.success { "passed" } else { "failed" },
                outcome.duration_millis,
                outcome.artifacts.result.display(),
                execution.bundle.directory.display()
            );
            Ok(())
        }
    }
}

fn print_doctor(format: OutputFormat, report: &DoctorReport) -> Result<(), FmError> {
    match format {
        OutputFormat::Json => print_serialized(format, report),
        OutputFormat::Human => {
            println!(
                "toolchain: {}",
                if report.ready { "ready" } else { "not ready" }
            );
            println!("Quint: {}", report.configured_quint);
            println!("Java: {}", report.configured_java);
            for probe in &report.probes {
                let detail = if !probe.stdout.is_empty() {
                    &probe.stdout
                } else {
                    &probe.stderr
                };
                println!(
                    "- {}: {}{}",
                    probe.name,
                    if probe.available {
                        "ok"
                    } else {
                        "missing/failed"
                    },
                    if detail.is_empty() {
                        String::new()
                    } else {
                        format!(" ({})", detail.lines().next().unwrap_or_default())
                    }
                );
            }
            Ok(())
        }
    }
}

fn print_serialized<T: Serialize>(_format: OutputFormat, value: &T) -> Result<(), FmError> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

fn print_error(format: OutputFormat, error: &FmError) {
    match format {
        OutputFormat::Human => eprintln!("fmctl: {error}"),
        OutputFormat::Json => eprintln!(
            "{}",
            serde_json::to_string(&json!({
                "success": false,
                "exit_code": error.exit_code(),
                "error": error.to_string()
            }))
            .unwrap_or_else(|_| {
                "{\"success\":false,\"error\":\"serialization failure\"}".to_owned()
            })
        ),
    }
}
