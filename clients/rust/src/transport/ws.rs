//! WebSocket implementation of [`ProtocolTransport`] (wire contract v1).
//!
//! Dials `/sync/ws` lazily on the first request, speaks one JSON object per
//! text frame, correlates concurrent in-flight requests by `requestId`, and
//! reconnects on the next request after a close with full-jitter exponential
//! backoff surfaced as `retry_after` on the dial failure. The bearer token
//! (if an [`AuthTokenProvider`] is configured) is appended as a `?token=`
//! query parameter at every dial, so an expired token picks up its
//! replacement on the next reconnect.
//!
//! When a fallback transport is configured
//! ([`WebSocketProtocolTransport::with_fallback`], typically the HTTP
//! transport), requests fall back to it whenever the socket cannot be
//! established, and `snapshot` always prefers it: snapshots can be large and
//! the HTTP endpoint is cacheable and resumable.
//!
//! Only plain `ws://` endpoints are supported; no TLS backend is linked. The
//! e2e stack and the reference node server both speak `ws://`.

use super::{
    decode_push, decode_pull, decode_snapshot, dispatch_frame, erase, lock, push_body, pull_body,
    AuthTokenProvider, ChangedHandler, Core, FrameCodes, FrameSink, Link, PendingMap,
    RandomSource, RequestError, SyncTransportError, DEFAULT_RECONNECT_BASE, DEFAULT_RECONNECT_MAX,
    DEFAULT_REQUEST_TIMEOUT,
};
use crate::protocol::{PushRequest, PushResponse, SnapshotResponse};
use crate::protocol_sync::{ProtocolTransport, PullResult, ResetRequired, TransportFailure};
use serde_json::Map;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::Message;

static WS_CODES: FrameCodes = FrameCodes {
    kind: "websocket",
    error: "WS_ERROR",
    closed: "WS_CLOSED",
    timeout: "WS_TIMEOUT",
    send_failed: "WS_SEND_FAILED",
    dial_failed: "WS_DIAL_FAILED",
    invalid_response: "WS_INVALID_RESPONSE",
    disposed: "WS_DISPOSED",
};

/// How often the socket thread wakes to flush queued outbound frames while
/// blocked waiting for inbound ones.
const POLL_INTERVAL: Duration = Duration::from_millis(25);

pub struct WebSocketTransportOptions {
    /// Absolute `ws://` URL of the `/sync/ws` endpoint.
    pub url: String,
    /// Token source; appended as `?token=<urlencoded>` at every dial.
    pub auth: Option<Arc<dyn AuthTokenProvider>>,
    /// Called for every unsolicited `changed` frame; wire to the sync loop's
    /// wake mechanism. A hint is a wake-up, never data.
    pub on_changed: Option<ChangedHandler>,
    /// Fail an in-flight request after this long (retryable `WS_TIMEOUT`).
    pub request_timeout: Duration,
    pub reconnect_base: Duration,
    pub reconnect_max: Duration,
    /// Jitter source for reconnect backoff; defaults to the OS CSPRNG.
    pub random: Option<RandomSource>,
}

impl WebSocketTransportOptions {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            auth: None,
            on_changed: None,
            request_timeout: DEFAULT_REQUEST_TIMEOUT,
            reconnect_base: DEFAULT_RECONNECT_BASE,
            reconnect_max: DEFAULT_RECONNECT_MAX,
            random: None,
        }
    }
}

struct WsConfig {
    url: String,
    auth: Option<Arc<dyn AuthTokenProvider>>,
    on_changed: Option<ChangedHandler>,
}

/// WebSocket [`ProtocolTransport`]. Cheap to clone; clones share the same
/// socket, so concurrent requests from multiple threads multiplex over one
/// connection and are correlated by `requestId`.
#[derive(Clone)]
pub struct WebSocketProtocolTransport {
    core: Arc<Core>,
    config: Arc<WsConfig>,
}

impl WebSocketProtocolTransport {
    pub fn new(options: WebSocketTransportOptions) -> Self {
        Self::build(options, None)
    }

    /// Like [`Self::new`], with a fallback transport (typically HTTP) used
    /// when the socket cannot be established, and always preferred for
    /// `snapshot`.
    pub fn with_fallback<T>(options: WebSocketTransportOptions, fallback: T) -> Self
    where
        T: ProtocolTransport + Send + 'static,
        T::Error: std::fmt::Display,
    {
        Self::build(options, Some(erase(fallback)))
    }

    fn build(options: WebSocketTransportOptions, fallback: Option<super::Fallback>) -> Self {
        Self {
            core: Arc::new(Core::new(
                &WS_CODES,
                options.request_timeout,
                options.reconnect_base,
                options.reconnect_max,
                options.random,
                fallback,
            )),
            config: Arc::new(WsConfig {
                url: options.url,
                auth: options.auth,
                on_changed: options.on_changed,
            }),
        }
    }

    /// Close the socket and fail all in-flight requests permanently. Every
    /// clone of this transport is disposed with it.
    pub fn dispose(&self) {
        self.core.dispose();
    }

    fn raw(
        &self,
        frame_type: &str,
        body: Map<String, serde_json::Value>,
    ) -> Result<Map<String, serde_json::Value>, RequestError> {
        let config = Arc::clone(&self.config);
        self.core.request(&move || dial(&config), frame_type, body)
    }
}

impl ProtocolTransport for WebSocketProtocolTransport {
    type Error = SyncTransportError;

    fn push(
        &mut self,
        request: &PushRequest,
    ) -> Result<PushResponse, TransportFailure<Self::Error>> {
        match self.raw("push", push_body(request)) {
            Ok(frame) => decode_push(frame, &WS_CODES),
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
            Ok(frame) => decode_pull(frame, &WS_CODES),
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
            Ok(frame) => decode_snapshot(frame, &WS_CODES),
            Err(error) => Err(error.into_failure()),
        }
    }
}

/* ------------------------------------------------------------------------ */
/* Dialing and the socket thread                                            */
/* ------------------------------------------------------------------------ */

struct WsSink {
    outbound: mpsc::Sender<String>,
    shutdown: Arc<AtomicBool>,
}

impl FrameSink for WsSink {
    fn send_frame(&self, text: String) -> Result<(), String> {
        self.outbound
            .send(text)
            .map_err(|_| "websocket connection is closed".to_string())
    }

    fn close(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }
}

fn dial(config: &WsConfig) -> Result<Link, String> {
    let mut url = config.url.clone();
    if let Some(auth) = &config.auth {
        if let Some(token) = auth.token() {
            if !token.is_empty() {
                url.push(if url.contains('?') { '&' } else { '?' });
                url.push_str("token=");
                url.push_str(&encode_query_component(&token));
            }
        }
    }

    let (mut socket, _response) =
        tungstenite::connect(url.as_str()).map_err(|error| error.to_string())?;
    if let MaybeTlsStream::Plain(stream) = socket.get_mut() {
        // The socket thread multiplexes writes and reads, so reads must
        // yield periodically instead of parking the thread forever.
        stream
            .set_read_timeout(Some(POLL_INTERVAL))
            .map_err(|error| error.to_string())?;
    }

    let pending = Arc::new(PendingMap::default());
    let alive = Arc::new(AtomicBool::new(true));
    let shutdown = Arc::new(AtomicBool::new(false));
    let (outbound, outbound_frames) = mpsc::channel::<String>();
    let io = SocketThread {
        socket,
        outbound_frames,
        pending: Arc::clone(&pending),
        alive: Arc::clone(&alive),
        shutdown: Arc::clone(&shutdown),
        on_changed: config.on_changed.clone(),
    };
    std::thread::Builder::new()
        .name("opto-sync-ws".to_string())
        .spawn(move || io.run())
        .map_err(|error| error.to_string())?;

    Ok(Link {
        sink: Arc::new(WsSink { outbound, shutdown }),
        pending,
        alive,
    })
}

struct SocketThread {
    socket: tungstenite::WebSocket<MaybeTlsStream<std::net::TcpStream>>,
    outbound_frames: mpsc::Receiver<String>,
    pending: Arc<PendingMap>,
    alive: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    on_changed: Option<ChangedHandler>,
}

impl SocketThread {
    /// Single-owner socket loop: flush queued outbound frames, then poll for
    /// one inbound message. One thread doing both sides means no interleaved
    /// writes, ever.
    fn run(mut self) {
        let close_reason: Option<String> = 'io: loop {
            if self.shutdown.load(Ordering::SeqCst) {
                let _ = self.socket.close(None);
                let _ = self.socket.flush();
                break 'io None;
            }
            loop {
                match self.outbound_frames.try_recv() {
                    Ok(text) => {
                        if let Err(error) = self.socket.send(Message::text(text)) {
                            break 'io Some(format!("websocket send failed: {error}"));
                        }
                    }
                    Err(mpsc::TryRecvError::Empty) => break,
                    Err(mpsc::TryRecvError::Disconnected) => {
                        // Every transport handle is gone; nobody can be
                        // waiting on `pending`.
                        let _ = self.socket.close(None);
                        break 'io None;
                    }
                }
            }
            match self.socket.read() {
                Ok(Message::Text(text)) => dispatch_frame(
                    text.as_str(),
                    &self.pending,
                    self.on_changed.as_ref(),
                    &WS_CODES,
                ),
                Ok(Message::Close(_)) => break 'io Some("websocket closed by server".to_string()),
                Ok(_) => {}
                Err(tungstenite::Error::Io(error))
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) => {}
                Err(error) => break 'io Some(format!("websocket closed: {error}")),
            }
        };
        self.alive.store(false, Ordering::SeqCst);
        let message = close_reason.unwrap_or_else(|| "websocket transport shut down".to_string());
        self.pending
            .fail_all(&TransportFailure::retryable(SyncTransportError::new(
                WS_CODES.closed,
                message,
            )));
    }
}

/// Percent-encode a query component (RFC 3986 unreserved characters pass
/// through), matching `encodeURIComponent` closely enough for bearer tokens.
fn encode_query_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push('%');
                encoded.push_str(&format!("{byte:02X}"));
            }
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_component_encoding_is_byte_wise_percent_encoding() {
        assert_eq!(encode_query_component("plain-token_1.2~3"), "plain-token_1.2~3");
        assert_eq!(encode_query_component("a b+c/d&e=f"), "a%20b%2Bc%2Fd%26e%3Df");
        assert_eq!(encode_query_component("ünï"), "%C3%BCn%C3%AF");
    }
}
