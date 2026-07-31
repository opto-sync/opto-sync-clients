//! TCP NDJSON implementation of [`ProtocolTransport`] (wire contract v1).
//!
//! Native-only sibling of the WebSocket transport: the same frames as
//! newline-delimited JSON (UTF-8, one JSON object per line, no raw newline
//! inside a frame) over a plain TCP connection to the server's
//! `SYNCER_TCP_PORT` listener. Browsers cannot open raw TCP sockets and use
//! the WebSocket endpoint instead.
//!
//! A raw socket has no URL to carry a bearer token, so authentication is an
//! optional per-frame `"token"` field, read from the [`AuthTokenProvider`]
//! for every request; the server verifies each distinct token once per
//! connection. Everything else — lazy dialing, `requestId` correlation,
//! retryable timeouts, fail-all on close, jittered reconnect backoff via
//! `retry_after`, HTTP fallback on dial failure, snapshot preferring the
//! fallback — matches the WebSocket transport.

use super::{
    decode_pull, decode_push, decode_snapshot, dispatch_frame, erase, lock, pull_body, push_body,
    AuthTokenProvider, ChangedHandler, Core, FrameCodes, FrameSink, Link, PendingMap, RandomSource,
    RequestError, SyncTransportError, DEFAULT_CONNECT_TIMEOUT, DEFAULT_RECONNECT_BASE,
    DEFAULT_RECONNECT_MAX, DEFAULT_REQUEST_TIMEOUT,
};
use crate::protocol::{PushRequest, PushResponse, SnapshotResponse};
use crate::protocol_sync::{ProtocolTransport, PullResult, ResetRequired, TransportFailure};
use serde_json::{Map, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

static TCP_CODES: FrameCodes = FrameCodes {
    kind: "tcp",
    error: "TCP_ERROR",
    closed: "TCP_CLOSED",
    timeout: "TCP_TIMEOUT",
    send_failed: "TCP_SEND_FAILED",
    dial_failed: "TCP_DIAL_FAILED",
    invalid_response: "TCP_INVALID_RESPONSE",
    disposed: "TCP_DISPOSED",
};

pub struct TcpTransportOptions {
    /// `host:port` of the server's NDJSON listener (`SYNCER_TCP_PORT`).
    pub address: String,
    /// Token source; sent as an optional `"token"` field on every frame.
    pub auth: Option<Arc<dyn AuthTokenProvider>>,
    /// Called for every unsolicited `changed` frame; wire to the sync loop's
    /// wake mechanism. A hint is a wake-up, never data.
    pub on_changed: Option<ChangedHandler>,
    /// Fail an in-flight request after this long (retryable `TCP_TIMEOUT`).
    pub request_timeout: Duration,
    pub connect_timeout: Duration,
    pub reconnect_base: Duration,
    pub reconnect_max: Duration,
    /// Jitter source for reconnect backoff; defaults to the OS CSPRNG.
    pub random: Option<RandomSource>,
}

impl TcpTransportOptions {
    pub fn new(address: impl Into<String>) -> Self {
        Self {
            address: address.into(),
            auth: None,
            on_changed: None,
            request_timeout: DEFAULT_REQUEST_TIMEOUT,
            connect_timeout: DEFAULT_CONNECT_TIMEOUT,
            reconnect_base: DEFAULT_RECONNECT_BASE,
            reconnect_max: DEFAULT_RECONNECT_MAX,
            random: None,
        }
    }
}

struct TcpConfig {
    address: String,
    connect_timeout: Duration,
    auth: Option<Arc<dyn AuthTokenProvider>>,
    on_changed: Option<ChangedHandler>,
}

/// TCP NDJSON [`ProtocolTransport`]. Cheap to clone; clones share the same
/// connection, so concurrent requests from multiple threads multiplex over
/// one socket and are correlated by `requestId`.
#[derive(Clone)]
pub struct TcpProtocolTransport {
    core: Arc<Core>,
    config: Arc<TcpConfig>,
}

impl TcpProtocolTransport {
    pub fn new(options: TcpTransportOptions) -> Self {
        Self::build(options, None)
    }

    /// Like [`Self::new`], with a fallback transport (typically HTTP) used
    /// when the connection cannot be established, and always preferred for
    /// `snapshot`.
    pub fn with_fallback<T>(options: TcpTransportOptions, fallback: T) -> Self
    where
        T: ProtocolTransport + Send + 'static,
        T::Error: std::fmt::Display,
    {
        Self::build(options, Some(erase(fallback)))
    }

    fn build(options: TcpTransportOptions, fallback: Option<super::Fallback>) -> Self {
        Self {
            core: Arc::new(Core::new(
                &TCP_CODES,
                options.request_timeout,
                options.reconnect_base,
                options.reconnect_max,
                options.random,
                fallback,
            )),
            config: Arc::new(TcpConfig {
                address: options.address,
                connect_timeout: options.connect_timeout,
                auth: options.auth,
                on_changed: options.on_changed,
            }),
        }
    }

    /// Close the connection and fail all in-flight requests permanently.
    /// Every clone of this transport is disposed with it.
    pub fn dispose(&self) {
        self.core.dispose();
    }

    fn raw(
        &self,
        frame_type: &str,
        mut body: Map<String, Value>,
    ) -> Result<Map<String, Value>, RequestError> {
        if let Some(auth) = &self.config.auth {
            if let Some(token) = auth.token() {
                if !token.is_empty() {
                    body.insert("token".to_string(), Value::from(token));
                }
            }
        }
        let config = Arc::clone(&self.config);
        self.core.request(&move || dial(&config), frame_type, body)
    }
}

impl ProtocolTransport for TcpProtocolTransport {
    type Error = SyncTransportError;

    fn push(
        &mut self,
        request: &PushRequest,
    ) -> Result<PushResponse, TransportFailure<Self::Error>> {
        match self.raw("push", push_body(request)) {
            Ok(frame) => decode_push(frame, &TCP_CODES),
            Err(RequestError::Dial(failure)) => match &self.core.fallback {
                Some(fallback) => lock(fallback).push(request),
                None => Err(failure),
            },
            Err(other) => Err(other.into_failure()),
        }
    }

    fn pull(
        &mut self,
        checkpoint: &str,
        limit: usize,
    ) -> Result<PullResult, TransportFailure<Self::Error>> {
        match self.raw("pull", pull_body(checkpoint, limit)) {
            Ok(frame) => decode_pull(frame, &TCP_CODES),
            Err(RequestError::Dial(failure)) => match &self.core.fallback {
                Some(fallback) => lock(fallback).pull(checkpoint, limit),
                None => Err(failure),
            },
            Err(other) => Err(other.into_failure()),
        }
    }

    fn snapshot(
        &mut self,
        reset: &ResetRequired,
    ) -> Result<SnapshotResponse, TransportFailure<Self::Error>> {
        // Snapshots can be large; the HTTP fallback (cacheable, resumable) is
        // preferred whenever one is configured.
        if let Some(fallback) = &self.core.fallback {
            return lock(fallback).snapshot(reset);
        }
        match self.raw("snapshot", Map::new()) {
            Ok(frame) => decode_snapshot(frame, &TCP_CODES),
            Err(error) => Err(error.into_failure()),
        }
    }
}

/* ------------------------------------------------------------------------ */
/* Dialing, the writer half, and the reader thread                          */
/* ------------------------------------------------------------------------ */

struct TcpSink {
    stream: Mutex<TcpStream>,
    pending: Arc<PendingMap>,
    alive: Arc<AtomicBool>,
}

impl FrameSink for TcpSink {
    fn send_frame(&self, text: String) -> Result<(), String> {
        let mut line = text;
        line.push('\n');
        let result = {
            let mut stream = lock(&self.stream);
            stream
                .write_all(line.as_bytes())
                .and_then(|()| stream.flush())
        };
        match result {
            Ok(()) => Ok(()),
            Err(error) => {
                // A broken pipe means the connection is gone for everyone,
                // not just this request.
                self.alive.store(false, Ordering::SeqCst);
                let _ = lock(&self.stream).shutdown(Shutdown::Both);
                self.pending
                    .fail_all(&TransportFailure::retryable(SyncTransportError::new(
                        TCP_CODES.closed,
                        format!("tcp connection lost: {error}"),
                    )));
                Err(format!("tcp send failed: {error}"))
            }
        }
    }

    fn close(&self) {
        let _ = lock(&self.stream).shutdown(Shutdown::Both);
    }
}

impl Drop for TcpSink {
    fn drop(&mut self) {
        // The reader thread only holds its own clone of the stream; shutting
        // the socket down here unblocks and retires it when the last
        // transport handle goes away without an explicit dispose.
        let _ = lock(&self.stream).shutdown(Shutdown::Both);
    }
}

fn dial(config: &TcpConfig) -> Result<Link, String> {
    let addresses: Vec<_> = config
        .address
        .to_socket_addrs()
        .map_err(|error| error.to_string())?
        .collect();
    let mut stream = None;
    let mut last_error = format!("{} resolved to no addresses", config.address);
    for address in addresses {
        match TcpStream::connect_timeout(&address, config.connect_timeout) {
            Ok(connected) => {
                stream = Some(connected);
                break;
            }
            Err(error) => last_error = error.to_string(),
        }
    }
    let stream = stream.ok_or(last_error)?;
    stream
        .set_nodelay(true)
        .map_err(|error| error.to_string())?;
    let reader_stream = stream.try_clone().map_err(|error| error.to_string())?;

    let pending = Arc::new(PendingMap::default());
    let alive = Arc::new(AtomicBool::new(true));
    let reader = ReaderThread {
        stream: reader_stream,
        pending: Arc::clone(&pending),
        alive: Arc::clone(&alive),
        on_changed: config.on_changed.clone(),
    };
    std::thread::Builder::new()
        .name("opto-sync-tcp".to_string())
        .spawn(move || reader.run())
        .map_err(|error| error.to_string())?;

    Ok(Link {
        sink: Arc::new(TcpSink {
            stream: Mutex::new(stream),
            pending: Arc::clone(&pending),
            alive: Arc::clone(&alive),
        }),
        pending,
        alive,
    })
}

struct ReaderThread {
    stream: TcpStream,
    pending: Arc<PendingMap>,
    alive: Arc<AtomicBool>,
    on_changed: Option<ChangedHandler>,
}

impl ReaderThread {
    fn run(self) {
        let mut reader = BufReader::new(&self.stream);
        let mut line = String::new();
        let message = loop {
            line.clear();
            // `read_line` accumulates bytes until the newline before
            // validating UTF-8, so multi-byte characters split across
            // partial reads reassemble correctly.
            match reader.read_line(&mut line) {
                Ok(0) => break "tcp connection closed".to_string(),
                Ok(_) => {
                    let frame = line.trim_end_matches(['\r', '\n']);
                    if !frame.trim().is_empty() {
                        dispatch_frame(frame, &self.pending, self.on_changed.as_ref(), &TCP_CODES);
                    }
                }
                Err(error) => break format!("tcp connection lost: {error}"),
            }
        };
        self.alive.store(false, Ordering::SeqCst);
        self.pending
            .fail_all(&TransportFailure::retryable(SyncTransportError::new(
                TCP_CODES.closed,
                message,
            )));
    }
}
