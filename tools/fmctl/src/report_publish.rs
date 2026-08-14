use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

#[cfg(unix)]
use std::fs::File;
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};

use serde::Serialize;

use crate::error::FmError;
use crate::resource::EffectiveResourcePolicy;
use crate::runner::CommandOutcome;

use super::{
    render_artifact_manifest_json, render_junit_xml, render_provenance_json, render_sarif_json,
    report_status, ArtifactEntry, ReportStatus,
};

const STAGING_PREFIX: &str = ".fm-report-staging-";
const RESERVATION_PREFIX: &str = ".fm-report-reservation-";
pub const MAX_REPORT_BUNDLE_ID_BYTES: usize = 128;
const MAX_REPORT_FILE_BYTES: usize = 64 * 1024 * 1024;
static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublishStep {
    Result,
    Junit,
    Sarif,
    ArtifactManifest,
    Provenance,
    BeforeRename,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PublishedReportBundle {
    pub bundle_id: String,
    pub directory: PathBuf,
    pub result: PathBuf,
    pub junit: PathBuf,
    pub sarif: PathBuf,
    pub artifact_manifest: PathBuf,
    pub provenance: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CleanupReport {
    pub staging_directories_removed: usize,
    pub reservations_removed: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct PublishedResult<'a> {
    schema: &'static str,
    schema_version: u32,
    project: &'a str,
    model: &'a str,
    operation: &'a str,
    status: ReportStatus,
    command: PublishedCommand,
    result: PublishedResultEvidence,
    artifacts: Vec<ArtifactEntry>,
    resource_policy: &'a EffectiveResourcePolicy,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct PublishedCommand {
    program: String,
    argument_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct PublishedResultEvidence {
    success: bool,
    timed_out: bool,
    exit_code: Option<i32>,
    duration_millis: u64,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

struct Reservation {
    path: PathBuf,
    committed: bool,
}

impl Reservation {
    fn acquire(root: &Path, bundle_id: &str) -> Result<Self, FmError> {
        let path = root.join(format!("{RESERVATION_PREFIX}{bundle_id}"));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&path).map_err(|source| {
            if source.kind() == io::ErrorKind::AlreadyExists {
                FmError::Validation(format!(
                    "report bundle id is already reserved or published: {bundle_id}"
                ))
            } else {
                FmError::io(&path, source)
            }
        })?;
        file.write_all(bundle_id.as_bytes())
            .map_err(|source| FmError::io(&path, source))?;
        file.sync_all()
            .map_err(|source| FmError::io(&path, source))?;
        Ok(Self {
            path,
            committed: false,
        })
    }

    fn commit(&mut self) {
        self.committed = true;
    }
}

impl Drop for Reservation {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

struct StagingDirectory {
    path: PathBuf,
    committed: bool,
}

impl StagingDirectory {
    fn create(root: &Path, bundle_id: &str) -> Result<Self, FmError> {
        let sequence = STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let name = format!(
            "{STAGING_PREFIX}{bundle_id}-{}-{sequence}",
            std::process::id()
        );
        let path = root.join(name);
        create_private_directory(&path)?;
        Ok(Self {
            path,
            committed: false,
        })
    }

    fn commit(&mut self) {
        self.committed = true;
    }
}

impl Drop for StagingDirectory {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

pub fn publish_report_bundle(
    outcome: &CommandOutcome,
    root: &Path,
    bundle_id: &str,
) -> Result<PublishedReportBundle, FmError> {
    publish_report_bundle_with_hook(outcome, root, bundle_id, |_| Ok(()))
}

pub fn publish_report_bundle_with_hook<F>(
    outcome: &CommandOutcome,
    root: &Path,
    bundle_id: &str,
    mut hook: F,
) -> Result<PublishedReportBundle, FmError>
where
    F: FnMut(PublishStep) -> io::Result<()>,
{
    validate_report_bundle_id(bundle_id)?;
    let root = ensure_private_root(root)?;
    let final_directory = root.join(bundle_id);
    reject_existing_or_symlink(&final_directory, "report bundle destination")?;

    let mut reservation = Reservation::acquire(&root, bundle_id)?;
    reject_existing_or_symlink(&final_directory, "report bundle destination")?;
    let mut staging = StagingDirectory::create(&root, bundle_id)?;

    let result_json = render_public_result_json(outcome)?;
    let junit_xml = render_junit_xml(outcome)?.into_bytes();
    let sarif_json = render_sarif_json(outcome)?;
    let artifact_manifest = render_artifact_manifest_json(outcome)?;
    let provenance = render_provenance_json(outcome)?;

    write_report_file(&staging.path, "result.json", &result_json)?;
    invoke_hook(&mut hook, PublishStep::Result)?;
    write_report_file(&staging.path, "junit.xml", &junit_xml)?;
    invoke_hook(&mut hook, PublishStep::Junit)?;
    write_report_file(&staging.path, "sarif.json", &sarif_json)?;
    invoke_hook(&mut hook, PublishStep::Sarif)?;
    write_report_file(&staging.path, "artifacts.json", &artifact_manifest)?;
    invoke_hook(&mut hook, PublishStep::ArtifactManifest)?;
    write_report_file(&staging.path, "provenance.json", &provenance)?;
    invoke_hook(&mut hook, PublishStep::Provenance)?;
    sync_directory(&staging.path)?;
    invoke_hook(&mut hook, PublishStep::BeforeRename)?;

    reject_existing_or_symlink(&final_directory, "report bundle destination")?;
    fs::rename(&staging.path, &final_directory)
        .map_err(|source| FmError::io(&final_directory, source))?;
    staging.commit();
    reservation.commit();
    sync_directory(&root)?;

    Ok(PublishedReportBundle {
        bundle_id: bundle_id.to_owned(),
        directory: final_directory.clone(),
        result: final_directory.join("result.json"),
        junit: final_directory.join("junit.xml"),
        sarif: final_directory.join("sarif.json"),
        artifact_manifest: final_directory.join("artifacts.json"),
        provenance: final_directory.join("provenance.json"),
    })
}

pub fn cleanup_stale_publication_state(
    root: &Path,
    minimum_age: Duration,
) -> Result<CleanupReport, FmError> {
    let root = ensure_private_root(root)?;
    let now = SystemTime::now();
    let mut report = CleanupReport::default();
    for entry in fs::read_dir(&root).map_err(|source| FmError::io(&root, source))? {
        let entry = entry.map_err(|source| FmError::io(&root, source))?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|source| FmError::io(entry.path(), source))?;
        if metadata.file_type().is_symlink() || !is_old_enough(&metadata, now, minimum_age) {
            continue;
        }
        if name.starts_with(STAGING_PREFIX) && metadata.is_dir() {
            fs::remove_dir_all(entry.path()).map_err(|source| FmError::io(entry.path(), source))?;
            report.staging_directories_removed += 1;
            continue;
        }
        if let Some(bundle_id) = name.strip_prefix(RESERVATION_PREFIX) {
            if metadata.is_file() && !root.join(bundle_id).exists() {
                fs::remove_file(entry.path())
                    .map_err(|source| FmError::io(entry.path(), source))?;
                report.reservations_removed += 1;
            }
        }
    }
    sync_directory(&root)?;
    Ok(report)
}

pub(crate) fn render_public_result_json(outcome: &CommandOutcome) -> Result<Vec<u8>, FmError> {
    let result = PublishedResult {
        schema: "fm.result.v1",
        schema_version: 1,
        project: &outcome.project,
        model: &outcome.model,
        operation: &outcome.operation,
        status: report_status(outcome),
        command: PublishedCommand {
            program: sanitized_program_name(&outcome.program),
            argument_count: outcome.args.len(),
        },
        result: PublishedResultEvidence {
            success: outcome.success,
            timed_out: outcome.timed_out,
            exit_code: outcome.exit_code,
            duration_millis: outcome.duration_millis,
            stdout_truncated: outcome.stdout_truncated,
            stderr_truncated: outcome.stderr_truncated,
        },
        artifacts: public_artifacts(outcome),
        resource_policy: &outcome.resource_policy,
    };
    Ok(serde_json::to_vec_pretty(&result)?)
}

fn public_artifacts(outcome: &CommandOutcome) -> Vec<ArtifactEntry> {
    let mut artifacts = vec![
        ArtifactEntry {
            kind: "result".to_owned(),
            path: artifact_basename(&outcome.artifacts.result),
        },
        ArtifactEntry {
            kind: "stderr".to_owned(),
            path: artifact_basename(&outcome.artifacts.stderr),
        },
        ArtifactEntry {
            kind: "stdout".to_owned(),
            path: artifact_basename(&outcome.artifacts.stdout),
        },
    ];
    if let Some(path) = &outcome.artifacts.trace_pattern {
        artifacts.push(ArtifactEntry {
            kind: "trace_pattern".to_owned(),
            path: artifact_basename(path),
        });
    }
    artifacts.sort_by(|left, right| left.kind.cmp(&right.kind));
    artifacts
}

fn artifact_basename(path: &Path) -> PathBuf {
    path.file_name()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("artifact"))
}

fn sanitized_program_name(program: &str) -> String {
    Path::new(program)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("program")
        .to_owned()
}

fn invoke_hook<F>(hook: &mut F, step: PublishStep) -> Result<(), FmError>
where
    F: FnMut(PublishStep) -> io::Result<()>,
{
    hook(step).map_err(|source| FmError::io("<report publication hook>", source))
}

fn write_report_file(directory: &Path, name: &str, bytes: &[u8]) -> Result<(), FmError> {
    if bytes.len() > MAX_REPORT_FILE_BYTES {
        return Err(FmError::Validation(format!(
            "report file {name} exceeds the {MAX_REPORT_FILE_BYTES}-byte limit"
        )));
    }
    let path = directory.join(name);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(&path)
        .map_err(|source| FmError::io(&path, source))?;
    file.write_all(bytes)
        .map_err(|source| FmError::io(&path, source))?;
    file.sync_all().map_err(|source| FmError::io(&path, source))
}

fn ensure_private_root(path: &Path) -> Result<PathBuf, FmError> {
    let expected = normalize_platform_root_alias(lexical_absolute(path)?)?;
    create_private_directory_all(&expected)?;
    let canonical = fs::canonicalize(&expected).map_err(|source| FmError::io(&expected, source))?;
    if canonical != expected {
        return Err(FmError::Validation(format!(
            "report bundle root contains a symlink or noncanonical component: {}",
            path.display()
        )));
    }
    let metadata =
        fs::symlink_metadata(&canonical).map_err(|source| FmError::io(&canonical, source))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(FmError::Validation(format!(
            "report bundle root must be a real directory: {}",
            path.display()
        )));
    }
    Ok(canonical)
}

#[cfg(target_os = "macos")]
fn normalize_platform_root_alias(path: PathBuf) -> Result<PathBuf, FmError> {
    // macOS intentionally exposes /var as a root-owned compatibility symlink
    // to /private/var, and the system temporary-directory API returns paths
    // below that alias. Trust only this exact platform mapping; components
    // below /private/var still pass the no-symlink walk in
    // create_private_directory_all.
    let alias = Path::new("/var");
    if !path.starts_with(alias) {
        return Ok(path);
    }
    let metadata = fs::symlink_metadata(alias).map_err(|source| FmError::io(alias, source))?;
    let canonical_alias = fs::canonicalize(alias).map_err(|source| FmError::io(alias, source))?;
    if !metadata.file_type().is_symlink() || canonical_alias != Path::new("/private/var") {
        return Err(FmError::Validation(
            "macOS /var does not resolve through the expected root-owned platform alias".to_owned(),
        ));
    }
    let remainder = path
        .strip_prefix(alias)
        .map_err(|_| FmError::Validation("failed to normalize the macOS /var alias".to_owned()))?;
    Ok(canonical_alias.join(remainder))
}

#[cfg(not(target_os = "macos"))]
fn normalize_platform_root_alias(path: PathBuf) -> Result<PathBuf, FmError> {
    Ok(path)
}

fn lexical_absolute(path: &Path) -> Result<PathBuf, FmError> {
    let source = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|source| FmError::io("<current directory>", source))?
            .join(path)
    };
    let mut result = PathBuf::new();
    for component in source.components() {
        match component {
            Component::Prefix(prefix) => result.push(prefix.as_os_str()),
            Component::RootDir => result.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(FmError::Validation(format!(
                    "report bundle root may not contain parent traversal: {}",
                    path.display()
                )));
            }
            Component::Normal(value) => result.push(value),
        }
    }
    Ok(result)
}

fn create_private_directory(path: &Path) -> Result<(), FmError> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    builder.mode(0o700);
    builder
        .create(path)
        .map_err(|source| FmError::io(path, source))
}

fn create_private_directory_all(path: &Path) -> Result<(), FmError> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(FmError::Validation(format!(
                        "report bundle root contains a symlink: {}",
                        current.display()
                    )));
                }
                if !metadata.is_dir() {
                    return Err(FmError::Validation(format!(
                        "report bundle root ancestor is not a directory: {}",
                        current.display()
                    )));
                }
            }
            Err(source) if source.kind() == io::ErrorKind::NotFound => {
                create_private_directory(&current)?;
            }
            Err(source) => return Err(FmError::io(&current, source)),
        }
    }
    Ok(())
}

fn reject_existing_or_symlink(path: &Path, label: &str) -> Result<(), FmError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Err(FmError::Validation(format!(
            "{label} already exists{}: {}",
            if metadata.file_type().is_symlink() {
                " as a symlink"
            } else {
                ""
            },
            path.display()
        ))),
        Err(source) if source.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(FmError::io(path, source)),
    }
}

fn sync_directory(path: &Path) -> Result<(), FmError> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(|source| FmError::io(path, source))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

fn is_old_enough(metadata: &fs::Metadata, now: SystemTime, minimum_age: Duration) -> bool {
    minimum_age.is_zero()
        || metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age >= minimum_age)
}

pub fn validate_report_bundle_id(bundle_id: &str) -> Result<(), FmError> {
    if bundle_id.is_empty() || bundle_id.len() > MAX_REPORT_BUNDLE_ID_BYTES {
        return invalid_bundle_id(bundle_id);
    }

    let reserved_basename = bundle_id.split('.').next().unwrap_or(bundle_id);
    if is_windows_device_basename(reserved_basename) {
        return Err(FmError::Validation(format!(
            "report bundle id uses a reserved Windows device basename: {bundle_id:?}"
        )));
    }

    let bytes = bundle_id.as_bytes();
    let first = bytes[0];
    let last = bytes[bytes.len() - 1];
    if !is_lower_ascii_alphanumeric(first)
        || !is_lower_ascii_alphanumeric(last)
        || !bytes
            .iter()
            .copied()
            .all(|byte| is_lower_ascii_alphanumeric(byte) || matches!(byte, b'-' | b'_'))
    {
        return invalid_bundle_id(bundle_id);
    }
    Ok(())
}

fn is_lower_ascii_alphanumeric(byte: u8) -> bool {
    byte.is_ascii_lowercase() || byte.is_ascii_digit()
}

fn is_windows_device_basename(value: &str) -> bool {
    if value.eq_ignore_ascii_case("con")
        || value.eq_ignore_ascii_case("prn")
        || value.eq_ignore_ascii_case("aux")
        || value.eq_ignore_ascii_case("nul")
        || value.eq_ignore_ascii_case("clock$")
    {
        return true;
    }
    let bytes = value.as_bytes();
    if bytes.len() != 4 || !matches!(bytes[3], b'1'..=b'9') {
        return false;
    }
    bytes[..3].eq_ignore_ascii_case(b"com") || bytes[..3].eq_ignore_ascii_case(b"lpt")
}

fn invalid_bundle_id<T>(bundle_id: &str) -> Result<T, FmError> {
    Err(FmError::Validation(format!(
        "invalid report bundle id {bundle_id:?}; use 1..={MAX_REPORT_BUNDLE_ID_BYTES} lower-case ASCII alphanumeric bytes with interior '-' or '_' only"
    )))
}
