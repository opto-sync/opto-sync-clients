use std::io;
use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum FmError {
    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },

    #[error("failed to parse manifest {path}: {source}")]
    ManifestSyntax {
        path: PathBuf,
        #[source]
        source: toml::de::Error,
    },

    #[error("manifest validation failed:\n{0}")]
    Validation(String),

    #[error("operation '{operation}' is not configured in {manifest}")]
    OperationNotConfigured {
        operation: &'static str,
        manifest: PathBuf,
    },

    #[error("adapter '{adapter}' is not configured")]
    UnknownAdapter { adapter: String },

    #[error("adapter '{adapter}' has no executable command")]
    AdapterCommandMissing { adapter: String },

    #[error("adapter protocol error: {0}")]
    AdapterProtocol(String),

    #[error("failed to serialize or deserialize JSON: {0}")]
    Json(#[from] serde_json::Error),

    #[error("failed to start '{program}': {source}")]
    Spawn {
        program: String,
        #[source]
        source: io::Error,
    },

    #[error("failed while waiting for '{program}': {source}")]
    Wait {
        program: String,
        #[source]
        source: io::Error,
    },

    #[error("failed to terminate '{program}' and its process group: {source}")]
    Terminate {
        program: String,
        #[source]
        source: io::Error,
    },

    #[error("failed to write stdin for '{program}': {source}")]
    WriteStdin {
        program: String,
        #[source]
        source: io::Error,
    },

    #[error("failed to read {stream} from '{program}': {source}")]
    Output {
        program: String,
        stream: &'static str,
        #[source]
        source: io::Error,
    },

    #[error("worker thread failed while collecting process output")]
    OutputWorkerPanicked,

    #[error("report publication failed: {0}")]
    ReportPublication(String),

    #[error("invalid JSON-RPC request: {0}")]
    InvalidRpc(String),
}

impl FmError {
    pub fn io(path: impl Into<PathBuf>, source: io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }

    pub fn report_publication(source: FmError) -> Self {
        Self::ReportPublication(source.to_string())
    }

    pub fn exit_code(&self) -> u8 {
        match self {
            Self::ManifestSyntax { .. } | Self::Validation(_) | Self::InvalidRpc(_) => 2,
            Self::OperationNotConfigured { .. }
            | Self::UnknownAdapter { .. }
            | Self::AdapterCommandMissing { .. }
            | Self::AdapterProtocol(_) => 3,
            Self::Spawn { .. }
            | Self::Wait { .. }
            | Self::Terminate { .. }
            | Self::WriteStdin { .. }
            | Self::Output { .. }
            | Self::OutputWorkerPanicked => 4,
            Self::Io { .. } | Self::Json(_) => 5,
            Self::ReportPublication(_) => 6,
        }
    }
}
