use std::ffi::c_void;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use sha2::{Digest, Sha256};

use crate::error::FmError;
use crate::runner::CommandOutcome;

#[path = "report_publish.rs"]
mod legacy;

pub use legacy::{
    validate_report_bundle_id, CleanupReport, PublishStep, PublishedReportBundle,
    MAX_REPORT_BUNDLE_ID_BYTES,
};
pub(crate) use legacy::render_public_result_json;

const LEASE_PREFIX: &str = ".fm-report-lease-";
const RESERVATION_PREFIX: &str = ".fm-report-reservation-";
const STAGING_PREFIX: &str = ".fm-report-staging-";

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
    hook: F,
) -> Result<PublishedReportBundle, FmError>
where
    F: FnMut(PublishStep) -> io::Result<()>,
{
    validate_report_bundle_id(bundle_id)?;
    let root = prepare_root(root)?;

    // Cleanup and lease creation share this short lock. Once the bundle lease is
    // held, different bundle ids may publish concurrently.
    let root_guard = RootGuard::acquire(&root)?;
    let lease = BundleLease::acquire(&root, bundle_id)?;
    drop(root_guard);

    let result = legacy::publish_report_bundle_with_hook(outcome, &root, bundle_id, hook);
    drop(lease);
    result
}

pub fn cleanup_stale_publication_state(
    root: &Path,
    minimum_age: Duration,
) -> Result<CleanupReport, FmError> {
    let root = prepare_root(root)?;
    let _root_guard = RootGuard::acquire(&root)?;
    let now = SystemTime::now();
    let mut report = CleanupReport::default();

    for entry in fs::read_dir(&root).map_err(|source| FmError::io(&root, source))? {
        let entry = entry.map_err(|source| FmError::io(&root, source))?;
        let path = entry.path();
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(source) if source.kind() == io::ErrorKind::NotFound => continue,
            Err(source) => return Err(FmError::io(&path, source)),
        };
        if metadata.file_type().is_symlink() || !is_old_enough(&metadata, now, minimum_age) {
            continue;
        }

        if metadata.is_dir() && name.starts_with(STAGING_PREFIX) {
            if let Some(bundle_id) = staging_bundle_id(&name) {
                match probe_bundle_lease(&root, bundle_id)? {
                    LockProbe::Active => continue,
                    LockProbe::Acquired(lock) => {
                        lock.release();
                        if remove_dir_all_if_present(&path)? {
                            report.staging_directories_removed += 1;
                        }
                    }
                    LockProbe::Missing => {
                        if remove_dir_all_if_present(&path)? {
                            report.staging_directories_removed += 1;
                        }
                    }
                }
            } else if remove_dir_all_if_present(&path)? {
                // Legacy/unparseable staging entries retain age-only cleanup.
                report.staging_directories_removed += 1;
            }
            continue;
        }

        if metadata.is_file() {
            if let Some(bundle_id) = name.strip_prefix(RESERVATION_PREFIX) {
                if root.join(bundle_id).exists() {
                    continue;
                }
                match probe_bundle_lease(&root, bundle_id)? {
                    LockProbe::Active => continue,
                    LockProbe::Acquired(lock) => {
                        lock.release();
                        if remove_file_if_present(&path)? {
                            report.reservations_removed += 1;
                        }
                    }
                    LockProbe::Missing => {
                        if remove_file_if_present(&path)? {
                            report.reservations_removed += 1;
                        }
                    }
                }
                continue;
            }

            if name.starts_with(LEASE_PREFIX) {
                match probe_file_lock(&path)? {
                    LockProbe::Active | LockProbe::Missing => {}
                    LockProbe::Acquired(lock) => {
                        lock.release();
                        let _ = remove_file_if_present(&path)?;
                    }
                }
            }
        }
    }

    sync_directory(&root)?;
    Ok(report)
}

fn prepare_root(root: &Path) -> Result<PathBuf, FmError> {
    // Reuse the already-audited root creation, ancestor-symlink rejection, and
    // private-permission checks without deleting anything.
    let _ = legacy::cleanup_stale_publication_state(root, Duration::MAX)?;
    fs::canonicalize(root).map_err(|source| FmError::io(root, source))
}

struct RootGuard {
    file: Option<File>,
}

impl RootGuard {
    fn acquire(root: &Path) -> Result<Self, FmError> {
        let path = root_guard_path(root)?;
        let file = open_private_lock_file(&path, false)?;
        lock_exclusive(&file, false).map_err(|source| FmError::io(&path, source))?;
        Ok(Self { file: Some(file) })
    }
}

impl Drop for RootGuard {
    fn drop(&mut self) {
        if let Some(file) = self.file.take() {
            let _ = unlock(&file);
        }
    }
}

struct BundleLease {
    path: PathBuf,
    file: Option<File>,
}

impl BundleLease {
    fn acquire(root: &Path, bundle_id: &str) -> Result<Self, FmError> {
        let path = root.join(format!("{LEASE_PREFIX}{bundle_id}"));
        let file = open_private_lock_file(&path, false)?;
        match lock_exclusive(&file, true) {
            Ok(()) => Ok(Self {
                path,
                file: Some(file),
            }),
            Err(source) if lock_is_contended(&source) => Err(FmError::Validation(format!(
                "report bundle id is actively publishing: {bundle_id}"
            ))),
            Err(source) => Err(FmError::io(&path, source)),
        }
    }
}

impl Drop for BundleLease {
    fn drop(&mut self) {
        if let Some(file) = self.file.take() {
            let _ = unlock(&file);
            drop(file);
        }
        let _ = fs::remove_file(&self.path);
    }
}

enum LockProbe {
    Missing,
    Active,
    Acquired(CleanupLock),
}

struct CleanupLock {
    file: Option<File>,
}

impl CleanupLock {
    fn release(mut self) {
        if let Some(file) = self.file.take() {
            let _ = unlock(&file);
            drop(file);
        }
    }
}

impl Drop for CleanupLock {
    fn drop(&mut self) {
        if let Some(file) = self.file.take() {
            let _ = unlock(&file);
        }
    }
}

fn probe_bundle_lease(root: &Path, bundle_id: &str) -> Result<LockProbe, FmError> {
    probe_file_lock(&root.join(format!("{LEASE_PREFIX}{bundle_id}")))
}

fn probe_file_lock(path: &Path) -> Result<LockProbe, FmError> {
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    let file = match options.open(path) {
        Ok(file) => file,
        Err(source) if source.kind() == io::ErrorKind::NotFound => return Ok(LockProbe::Missing),
        Err(source) => return Err(FmError::io(path, source)),
    };
    match lock_exclusive(&file, true) {
        Ok(()) => Ok(LockProbe::Acquired(CleanupLock { file: Some(file) })),
        Err(source) if lock_is_contended(&source) => Ok(LockProbe::Active),
        Err(source) => Err(FmError::io(path, source)),
    }
}

fn root_guard_path(root: &Path) -> Result<PathBuf, FmError> {
    let parent = root.parent().ok_or_else(|| {
        FmError::Validation(format!(
            "report bundle root has no parent directory: {}",
            root.display()
        ))
    })?;
    let mut digest = Sha256::new();
    digest.update(root.to_string_lossy().as_bytes());
    let hex = digest
        .finalize()
        .iter()
        .take(12)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(parent.join(format!(".fm-report-publication-guard-{hex}")))
}

fn staging_bundle_id(name: &str) -> Option<&str> {
    let value = name.strip_prefix(STAGING_PREFIX)?;
    let (value, sequence) = value.rsplit_once('-')?;
    sequence.parse::<u64>().ok()?;
    let (bundle_id, process_id) = value.rsplit_once('-')?;
    process_id.parse::<u32>().ok()?;
    validate_report_bundle_id(bundle_id).ok()?;
    Some(bundle_id)
}

fn open_private_lock_file(path: &Path, truncate: bool) -> Result<File, FmError> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(truncate);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(|source| FmError::io(path, source))
}

fn is_old_enough(metadata: &fs::Metadata, now: SystemTime, minimum_age: Duration) -> bool {
    minimum_age.is_zero()
        || metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age >= minimum_age)
}

fn remove_file_if_present(path: &Path) -> Result<bool, FmError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(source) if source.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(source) => Err(FmError::io(path, source)),
    }
}

fn remove_dir_all_if_present(path: &Path) -> Result<bool, FmError> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(true),
        Err(source) if source.kind() == io::ErrorKind::NotFound => Ok(false),
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

#[cfg(unix)]
fn lock_exclusive(file: &File, nonblocking: bool) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    let operation = libc::LOCK_EX | if nonblocking { libc::LOCK_NB } else { 0 };
    // SAFETY: flock receives a live file descriptor and does not retain it.
    if unsafe { libc::flock(file.as_raw_fd(), operation) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(unix)]
fn unlock(file: &File) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    // SAFETY: flock receives a live file descriptor and does not retain it.
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(unix)]
fn lock_is_contended(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::WouldBlock
        || matches!(error.raw_os_error(), Some(libc::EAGAIN) | Some(libc::EWOULDBLOCK))
}

#[cfg(windows)]
#[repr(C)]
struct Overlapped {
    internal: usize,
    internal_high: usize,
    offset: u32,
    offset_high: u32,
    event: *mut c_void,
}

#[cfg(windows)]
#[link(name = "Kernel32")]
extern "system" {
    fn LockFileEx(
        file: *mut c_void,
        flags: u32,
        reserved: u32,
        bytes_low: u32,
        bytes_high: u32,
        overlapped: *mut Overlapped,
    ) -> i32;
    fn UnlockFileEx(
        file: *mut c_void,
        reserved: u32,
        bytes_low: u32,
        bytes_high: u32,
        overlapped: *mut Overlapped,
    ) -> i32;
}

#[cfg(windows)]
fn lock_exclusive(file: &File, nonblocking: bool) -> io::Result<()> {
    use std::mem::zeroed;
    use std::os::windows::io::AsRawHandle;
    const LOCKFILE_FAIL_IMMEDIATELY: u32 = 0x0000_0001;
    const LOCKFILE_EXCLUSIVE_LOCK: u32 = 0x0000_0002;
    let flags = LOCKFILE_EXCLUSIVE_LOCK
        | if nonblocking {
            LOCKFILE_FAIL_IMMEDIATELY
        } else {
            0
        };
    // SAFETY: OVERLAPPED is zero-initializable for a synchronous byte-range
    // lock and the handle remains live for the duration of the call.
    let mut overlapped: Overlapped = unsafe { zeroed() };
    let result = unsafe {
        LockFileEx(
            file.as_raw_handle(),
            flags,
            0,
            u32::MAX,
            u32::MAX,
            &mut overlapped,
        )
    };
    if result != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn unlock(file: &File) -> io::Result<()> {
    use std::mem::zeroed;
    use std::os::windows::io::AsRawHandle;
    // SAFETY: see lock_exclusive; this unlocks the same byte range.
    let mut overlapped: Overlapped = unsafe { zeroed() };
    let result = unsafe {
        UnlockFileEx(
            file.as_raw_handle(),
            0,
            u32::MAX,
            u32::MAX,
            &mut overlapped,
        )
    };
    if result != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn lock_is_contended(error: &io::Error) -> bool {
    const ERROR_LOCK_VIOLATION: i32 = 33;
    error.kind() == io::ErrorKind::WouldBlock || error.raw_os_error() == Some(ERROR_LOCK_VIOLATION)
}
