//! Realtime sync transports for protocol v1: WebSocket and TCP NDJSON.
//!
//! Wire contract v1 (shared with the reference node server and the TS/Dart
//! clients — do not deviate):
//!
//! - WebSocket endpoint `/sync/ws` on the HTTP port (upgrade). JSON text
//!   frames, one JSON object per frame.
//! - TCP: the same frames as newline-delimited JSON (NDJSON, UTF-8, no raw
//!   newline inside a frame) to a dedicated host:port. TCP exists for native
//!   clients; browsers use the WebSocket endpoint.
//! - client→server: `{"v":1,"type":"push"|"pull"|"snapshot","requestId":"<unique>",...body}`
//!   where the remaining fields are exactly the HTTP request body.
//! - server→client: `{"v":1,"type":"push-result"|"pull-result"|"snapshot-result","requestId",...body}`,
//!   `{"v":1,"type":"error","requestId","code","message","retryable"}`, and the
//!   unsolicited pull hint `{"v":1,"type":"changed","watermark":<number>}`.
//! - Auth: WebSocket appends the bearer token as a `?token=` query parameter
//!   at dial time (re-read from the provider on every reconnect); TCP carries
//!   an optional per-frame `"token"` field instead, because a raw socket has
//!   no URL.
//!
//! Both transports implement [`ProtocolTransport`], so they plug directly
//! into [`crate::protocol_sync::ProtocolSyncDriver`]. They dial lazily on the
//! first request, correlate concurrent in-flight requests by `requestId`,
//! time a request out as a retryable failure, fail every in-flight request as
//! retryable when the socket closes, and surface dial failures with a
//! full-jitter exponential `retry_after` so the caller's sync loop can back
//! off. `changed` hints are wake-ups, never data: they reach the application
//! through an `on_changed` callback that should nudge the sync loop.

use crate::protocol::{PullResponse, PushRequest, PushResponse, SnapshotResponse};
use crate::protocol_sync::{
    compute_protocol_retry_delay, ProtocolTransport, PullResult, ResetRequired, TransportFailure,
};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::time::Duration;

pub mod tcp;
#[cfg(feature = "ws")]
pub mod ws;

/// Reject an in-flight request after this long. Mirrors the TS/Dart default.
pub const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
pub const DEFAULT_RECONNECT_BASE: Duration = Duration::from_millis(500);
pub const DEFAULT_RECONNECT_MAX: Duration = Duration::from_secs(30);
pub const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Transport failure detail, mirroring the TS `SyncTransportError`.
///
/// The retryable flag and optional retry-after hint live on the
/// [`TransportFailure`] wrapper this crate already uses; this type carries
/// the remaining fields: a machine-readable `code` (either the server's
/// error-frame code, e.g. `RATE_LIMITED`, or a client-side one such as
/// `WS_TIMEOUT`/`TCP_DIAL_FAILED`) and a human-readable `message`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncTransportError {
    pub code: String,
    pub message: String,
}

impl SyncTransportError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for SyncTransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for SyncTransportError {}

/// The failure type both realtime transports produce.
pub type SyncTransportFailure = TransportFailure<SyncTransportError>;

/// Pluggable session source (Supabase session, shared-auth, ...).
///
/// The WebSocket transport reads it at every dial, so an expired token picks
/// up its replacement on the next reconnect; the TCP transport reads it for
/// every frame. Return `None` for unauthenticated servers.
pub trait AuthTokenProvider: Send + Sync {
    fn token(&self) -> Option<String>;
}

impl<F> AuthTokenProvider for F
where
    F: Fn() -> Option<String> + Send + Sync,
{
    fn token(&self) -> Option<String> {
        self()
    }
}

/// Called for every unsolicited `changed` frame with the server watermark.
/// A hint is a wake-up, never data: wire it to the sync loop's wake channel.
pub type ChangedHandler = Arc<dyn Fn(u64) + Send + Sync>;

/// Uniform sample in `[0, 1]` for reconnect jitter. Injectable for tests.
pub type RandomSource = Arc<dyn Fn() -> f64 + Send + Sync>;

fn default_random() -> RandomSource {
    Arc::new(|| {
        let mut bytes = [0u8; 8];
        getrandom::fill(&mut bytes).expect("OS entropy source must be available");
        // 53 uniformly random mantissa bits: uniform in [0, 1).
        (u64::from_le_bytes(bytes) >> 11) as f64 / (1u64 << 53) as f64
    })
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panic while holding one of these locks poisons nothing recoverable:
    // every guarded value is safe to reuse (maps of waiters, a byte stream).
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/* ------------------------------------------------------------------------ */
/* Shared frame machinery (private to the transport submodules)             */
/* ------------------------------------------------------------------------ */

/// Per-transport error-code vocabulary so WS and TCP failures stay tellable
/// apart while sharing every mechanism.
struct FrameCodes {
    kind: &'static str,
    error: &'static str,
    closed: &'static str,
    timeout: &'static str,
    send_failed: &'static str,
    dial_failed: &'static str,
    invalid_response: &'static str,
    disposed: &'static str,
}

type FrameOutcome = Result<Map<String, Value>, SyncTransportFailure>;

/// In-flight requests awaiting a correlated `requestId` response.
#[derive(Default)]
struct PendingMap {
    waiters: Mutex<HashMap<String, mpsc::Sender<FrameOutcome>>>,
}

impl PendingMap {
    fn register(&self, request_id: &str) -> mpsc::Receiver<FrameOutcome> {
        let (sender, receiver) = mpsc::channel();
        lock(&self.waiters).insert(request_id.to_string(), sender);
        receiver
    }

    fn forget(&self, request_id: &str) {
        lock(&self.waiters).remove(request_id);
    }

    fn complete(&self, request_id: &str, outcome: FrameOutcome) {
        if let Some(waiter) = lock(&self.waiters).remove(request_id) {
            // The waiter may have timed out between lookup and send; a dead
            // receiver is not an error.
            let _ = waiter.send(outcome);
        }
    }

    fn fail_all(&self, failure: &SyncTransportFailure) {
        let waiters: Vec<_> = lock(&self.waiters).drain().map(|(_, w)| w).collect();
        for waiter in waiters {
            let _ = waiter.send(Err(failure.clone()));
        }
    }
}

/// Route one server frame. Anything that is not a well-formed v1 frame is
/// ignored — one malformed broadcast must not kill the connection — and an
/// unknown frame type leaves its request waiting, exactly like TS/Dart.
fn dispatch_frame(
    text: &str,
    pending: &PendingMap,
    on_changed: Option<&ChangedHandler>,
    codes: &FrameCodes,
) {
    let Ok(Value::Object(frame)) = serde_json::from_str::<Value>(text) else {
        return;
    };
    if frame.get("v").and_then(Value::as_u64) != Some(1) {
        return;
    }
    let frame_type = frame
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_string);
    match frame_type.as_deref() {
        Some("changed") => {
            if let (Some(watermark), Some(handler)) =
                (frame.get("watermark").and_then(Value::as_u64), on_changed)
            {
                // Hints are best-effort; a panicking listener must not take
                // the reader thread (and with it the socket) down.
                let _ = catch_unwind(AssertUnwindSafe(|| handler(watermark)));
            }
        }
        Some("error") => {
            let Some(request_id) = frame.get("requestId").and_then(Value::as_str) else {
                // `requestId: null` answers to unparseable frames we never
                // sent; nothing is waiting on them.
                return;
            };
            let failure = TransportFailure {
                source: SyncTransportError::new(
                    frame
                        .get("code")
                        .and_then(Value::as_str)
                        .unwrap_or(codes.error),
                    frame
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("sync transport error"),
                ),
                retryable: frame.get("retryable").and_then(Value::as_bool) != Some(false),
                retry_after: None,
            };
            pending.complete(request_id, Err(failure));
        }
        Some("push-result" | "pull-result" | "snapshot-result") => {
            let Some(request_id) = frame
                .get("requestId")
                .and_then(Value::as_str)
                .map(str::to_string)
            else {
                return;
            };
            pending.complete(&request_id, Ok(frame));
        }
        _ => {}
    }
}

/// Unique-per-transport request ids: `<random seed>-<counter>`.
struct RequestIds {
    seed: String,
    next: AtomicU64,
}

impl RequestIds {
    fn new() -> Self {
        Self {
            seed: crate::clock::random_node_id(4),
            next: AtomicU64::new(0),
        }
    }

    fn allocate(&self) -> String {
        format!(
            "{}-{}",
            self.seed,
            self.next.fetch_add(1, Ordering::Relaxed) + 1
        )
    }
}

/* ------------------------------------------------------------------------ */
/* Fallback erasure                                                         */
/* ------------------------------------------------------------------------ */

/// Object-safe [`ProtocolTransport`] so a fallback of any error type can live
/// behind the realtime transports without infecting them with a type
/// parameter. Fallback failures keep their retryable flag and retry-after;
/// their source is re-coded as `FALLBACK` with the original in the message.
trait ErasedTransport: Send {
    fn push(&mut self, request: &PushRequest) -> Result<PushResponse, SyncTransportFailure>;
    fn pull(&mut self, checkpoint: &str, limit: usize)
        -> Result<PullResult, SyncTransportFailure>;
    fn snapshot(&mut self, reset: &ResetRequired)
        -> Result<SnapshotResponse, SyncTransportFailure>;
}

struct ErasedAdapter<T>(T);

fn map_fallback_failure<E: std::fmt::Display>(failure: TransportFailure<E>) -> SyncTransportFailure {
    TransportFailure {
        source: SyncTransportError::new("FALLBACK", failure.source.to_string()),
        retryable: failure.retryable,
        retry_after: failure.retry_after,
    }
}

impl<T> ErasedTransport for ErasedAdapter<T>
where
    T: ProtocolTransport + Send,
    T::Error: std::fmt::Display,
{
    fn push(&mut self, request: &PushRequest) -> Result<PushResponse, SyncTransportFailure> {
        self.0.push(request).map_err(map_fallback_failure)
    }

    fn pull(
        &mut self,
        checkpoint: &str,
        limit: usize,
    ) -> Result<PullResult, SyncTransportFailure> {
        self.0.pull(checkpoint, limit).map_err(map_fallback_failure)
    }

    fn snapshot(
        &mut self,
        reset: &ResetRequired,
    ) -> Result<SnapshotResponse, SyncTransportFailure> {
        self.0.snapshot(reset).map_err(map_fallback_failure)
    }
}

type Fallback = Mutex<Box<dyn ErasedTransport>>;

fn erase<T>(fallback: T) -> Fallback
where
    T: ProtocolTransport + Send + 'static,
    T::Error: std::fmt::Display,
{
    Mutex::new(Box::new(ErasedAdapter(fallback)))
}

/* ------------------------------------------------------------------------ */
/* Connection core shared by WS and TCP                                     */
/* ------------------------------------------------------------------------ */

/// How a live connection accepts one outbound frame.
trait FrameSink: Send + Sync {
    /// Queue or write one frame. `Err` carries a human-readable reason.
    fn send_frame(&self, text: String) -> Result<(), String>;
    /// Tear the connection down (dispose); in-flight failure is the
    /// caller's job.
    fn close(&self);
}

/// One live connection: where to send frames, who is waiting, and whether
/// the socket is still usable.
#[derive(Clone)]
struct Link {
    sink: Arc<dyn FrameSink>,
    pending: Arc<PendingMap>,
    alive: Arc<AtomicBool>,
}

enum RequestError {
    /// The socket could not be established; eligible for the HTTP fallback.
    Dial(SyncTransportFailure),
    Other(SyncTransportFailure),
}

impl RequestError {
    fn into_failure(self) -> SyncTransportFailure {
        match self {
            Self::Dial(failure) | Self::Other(failure) => failure,
        }
    }
}

/// Transport-agnostic request lifecycle: lazy single-flight dialing,
/// requestId issue + correlation, timeout, and disposal.
struct Core {
    codes: &'static FrameCodes,
    request_timeout: Duration,
    reconnect_base: Duration,
    reconnect_max: Duration,
    random: RandomSource,
    ids: RequestIds,
    connection: Mutex<Option<Link>>,
    consecutive_dial_failures: AtomicU32,
    disposed: AtomicBool,
    fallback: Option<Fallback>,
}

impl Core {
    fn new(
        codes: &'static FrameCodes,
        request_timeout: Duration,
        reconnect_base: Duration,
        reconnect_max: Duration,
        random: Option<RandomSource>,
        fallback: Option<Fallback>,
    ) -> Self {
        Self {
            codes,
            request_timeout,
            reconnect_base,
            reconnect_max,
            random: random.unwrap_or_else(default_random),
            ids: RequestIds::new(),
            connection: Mutex::new(None),
            consecutive_dial_failures: AtomicU32::new(0),
            disposed: AtomicBool::new(false),
        }
    }

    fn request(
        &self,
        dial: &dyn Fn() -> Result<Link, String>,
        frame_type: &str,
        mut body: Map<String, Value>,
    ) -> Result<Map<String, Value>, RequestError> {
        if self.disposed.load(Ordering::SeqCst) {
            return Err(RequestError::Other(TransportFailure::permanent(
                SyncTransportError::new(self.codes.disposed, "transport disposed"),
            )));
        }
        let link = self.connect(dial).map_err(RequestError::Dial)?;

        let request_id = self.ids.allocate();
        body.insert("v".to_string(), Value::from(1));
        body.insert("type".to_string(), Value::from(frame_type));
        body.insert("requestId".to_string(), Value::from(request_id.clone()));
        let text = Value::Object(body).to_string();

        // Register before sending: a response cannot outrun its waiter.
        let receiver = link.pending.register(&request_id);
        if let Err(reason) = link.sink.send_frame(text) {
            link.pending.forget(&request_id);
            return Err(RequestError::Other(TransportFailure::retryable(
                SyncTransportError::new(self.codes.send_failed, reason),
            )));
        }

        match receiver.recv_timeout(self.request_timeout) {
            Ok(outcome) => outcome.map_err(RequestError::Other),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                link.pending.forget(&request_id);
                Err(RequestError::Other(TransportFailure::retryable(
                    SyncTransportError::new(
                        self.codes.timeout,
                        format!("{} {frame_type} timed out", self.codes.kind),
                    ),
                )))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                // The waiter was dropped without an outcome; treat it like a
                // closed socket.
                Err(RequestError::Other(TransportFailure::retryable(
                    SyncTransportError::new(
                        self.codes.closed,
                        format!("{} closed", self.codes.kind),
                    ),
                )))
            }
        }
    }

    /// Reuse the live connection or dial a new one. The slot lock makes the
    /// dial single-flight: concurrent requests wait, then share the socket.
    fn connect(&self, dial: &dyn Fn() -> Result<Link, String>) -> Result<Link, SyncTransportFailure> {
        let mut slot = lock(&self.connection);
        if let Some(link) = slot.as_ref() {
            if link.alive.load(Ordering::SeqCst) {
                return Ok(link.clone());
            }
        }
        *slot = None;
        match dial() {
            Ok(link) => {
                self.consecutive_dial_failures.store(0, Ordering::SeqCst);
                *slot = Some(link.clone());
                Ok(link)
            }
            Err(reason) => {
                let consecutive = self
                    .consecutive_dial_failures
                    .fetch_add(1, Ordering::SeqCst)
                    .saturating_add(1);
                Err(self.dial_failure(reason, consecutive))
            }
        }
    }

    /// Retryable dial failure carrying a full-jitter exponential retry-after,
    /// so the sync loop backs off instead of hammering a dead endpoint.
    fn dial_failure(&self, reason: String, consecutive: u32) -> SyncTransportFailure {
        let sample = (self.random)();
        let sample = if sample.is_finite() {
            sample.clamp(0.0, 1.0)
        } else {
            1.0
        };
        let retry_after = compute_protocol_retry_delay(
            consecutive.clamp(1, 20),
            self.reconnect_base,
            self.reconnect_max,
            sample,
            Duration::ZERO,
        )
        .ok();
        TransportFailure {
            source: SyncTransportError::new(
                self.codes.dial_failed,
                format!("{} dial failed: {reason}", self.codes.kind),
            ),
            retryable: true,
            retry_after,
        }
    }

    /// Permanently shut the transport down and fail all in-flight requests.
    fn dispose(&self) {
        self.disposed.store(true, Ordering::SeqCst);
        let link = lock(&self.connection).take();
        if let Some(link) = link {
            link.alive.store(false, Ordering::SeqCst);
            link.pending.fail_all(&TransportFailure::permanent(
                SyncTransportError::new(self.codes.disposed, "transport disposed"),
            ));
            link.sink.close();
        }
    }
}

/* ------------------------------------------------------------------------ */
/* Typed response decoding                                                  */
/* ------------------------------------------------------------------------ */

fn invalid_response(codes: &FrameCodes, what: &str, error: &serde_json::Error) -> SyncTransportFailure {
    TransportFailure::permanent(SyncTransportError::new(
        codes.invalid_response,
        format!("invalid {what} response: {error}"),
    ))
}

fn decode_push(
    frame: Map<String, Value>,
    codes: &FrameCodes,
) -> Result<PushResponse, SyncTransportFailure> {
    serde_json::from_value(Value::Object(frame)).map_err(|e| invalid_response(codes, "push", &e))
}

/// A pull-result frame carries either a page of changes or the
/// `RESET_REQUIRED` body, exactly like the HTTP 409 body; the `error`
/// discriminant matches the TS client's `isResetRequired`.
fn decode_pull(
    frame: Map<String, Value>,
    codes: &FrameCodes,
) -> Result<PullResult, SyncTransportFailure> {
    if frame.get("error").and_then(Value::as_str) == Some("RESET_REQUIRED") {
        return serde_json::from_value::<ResetRequired>(Value::Object(frame))
            .map(PullResult::ResetRequired)
            .map_err(|e| invalid_response(codes, "pull reset", &e));
    }
    serde_json::from_value::<PullResponse>(Value::Object(frame))
        .map(PullResult::Changes)
        .map_err(|e| invalid_response(codes, "pull", &e))
}

fn decode_snapshot(
    frame: Map<String, Value>,
    codes: &FrameCodes,
) -> Result<SnapshotResponse, SyncTransportFailure> {
    serde_json::from_value(Value::Object(frame)).map_err(|e| invalid_response(codes, "snapshot", &e))
}

fn push_body(request: &PushRequest) -> Map<String, Value> {
    match serde_json::to_value(request) {
        Ok(Value::Object(map)) => map,
        // `PushRequest` serializes as an object by construction.
        _ => Map::new(),
    }
}

fn pull_body(checkpoint: &str, limit: usize) -> Map<String, Value> {
    let mut body = Map::new();
    body.insert("checkpoint".to_string(), Value::from(checkpoint));
    body.insert("limit".to_string(), Value::from(limit));
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes() -> &'static FrameCodes {
        &FrameCodes {
            kind: "test",
            error: "T_ERROR",
            closed: "T_CLOSED",
            timeout: "T_TIMEOUT",
            send_failed: "T_SEND_FAILED",
            dial_failed: "T_DIAL_FAILED",
            invalid_response: "T_INVALID_RESPONSE",
            disposed: "T_DISPOSED",
        }
    }

    #[test]
    fn error_frames_default_to_retryable_with_the_transport_code() {
        let pending = PendingMap::default();
        let receiver = pending.register("r-1");
        dispatch_frame(
            r#"{"v":1,"type":"error","requestId":"r-1"}"#,
            &pending,
            None,
            codes(),
        );
        let failure = receiver.recv().unwrap().unwrap_err();
        assert!(failure.retryable);
        assert_eq!(failure.source.code, "T_ERROR");

        let receiver = pending.register("r-2");
        dispatch_frame(
            r#"{"v":1,"type":"error","requestId":"r-2","code":"UNAUTHORIZED","message":"no","retryable":false}"#,
            &pending,
            None,
            codes(),
        );
        let failure = receiver.recv().unwrap().unwrap_err();
        assert!(!failure.retryable);
        assert_eq!(failure.source.code, "UNAUTHORIZED");
        assert_eq!(failure.source.message, "no");
    }

    #[test]
    fn malformed_unknown_and_foreign_frames_leave_waiters_untouched() {
        let pending = PendingMap::default();
        let receiver = pending.register("r-1");
        for text in [
            "{not json",
            r#"[1,2,3]"#,
            r#"{"v":2,"type":"push-result","requestId":"r-1"}"#,
            r#"{"v":1,"type":"mystery","requestId":"r-1"}"#,
            r#"{"v":1,"type":"error","requestId":null,"code":"MALFORMED_FRAME"}"#,
            r#"{"v":1,"type":"push-result","requestId":"someone-else"}"#,
        ] {
            dispatch_frame(text, &pending, None, codes());
        }
        assert!(matches!(
            receiver.recv_timeout(Duration::from_millis(20)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        dispatch_frame(
            r#"{"v":1,"type":"push-result","requestId":"r-1","protocolVersion":1}"#,
            &pending,
            None,
            codes(),
        );
        let frame = receiver.recv().unwrap().unwrap();
        assert_eq!(frame.get("protocolVersion").and_then(Value::as_u64), Some(1));
    }

    #[test]
    fn changed_hints_reach_the_handler_and_survive_a_panicking_listener() {
        let pending = PendingMap::default();
        let (sender, receiver) = mpsc::channel();
        let handler: ChangedHandler = Arc::new(move |watermark| {
            sender.send(watermark).unwrap();
            assert!(watermark < 100, "listener panic must be contained");
        });
        dispatch_frame(
            r#"{"v":1,"type":"changed","watermark":7}"#,
            &pending,
            Some(&handler),
            codes(),
        );
        dispatch_frame(
            r#"{"v":1,"type":"changed","watermark":999}"#,
            &pending,
            Some(&handler),
            codes(),
        );
        dispatch_frame(
            r#"{"v":1,"type":"changed","watermark":8}"#,
            &pending,
            Some(&handler),
            codes(),
        );
        assert_eq!(receiver.recv().unwrap(), 7);
        assert_eq!(receiver.recv().unwrap(), 999);
        assert_eq!(receiver.recv().unwrap(), 8);
    }

    #[test]
    fn pull_decoding_discriminates_reset_required_from_changes() {
        let reset: Map<String, Value> = serde_json::from_str(
            r#"{"v":1,"type":"pull-result","requestId":"r","protocolVersion":1,
                "error":"RESET_REQUIRED","resetRequired":true,"snapshotUrl":"/v1/sync/snapshot"}"#,
        )
        .unwrap();
        match decode_pull(reset, codes()).unwrap() {
            PullResult::ResetRequired(reset) => {
                assert_eq!(reset.error, "RESET_REQUIRED");
                assert_eq!(reset.snapshot_url.as_deref(), Some("/v1/sync/snapshot"));
            }
            PullResult::Changes(_) => panic!("must decode as reset"),
        }

        let page: Map<String, Value> = serde_json::from_str(
            r#"{"v":1,"type":"pull-result","requestId":"r","protocolVersion":1,
                "checkpoint":"4","hasMore":false,"changes":[]}"#,
        )
        .unwrap();
        match decode_pull(page, codes()).unwrap() {
            PullResult::Changes(page) => assert_eq!(page.checkpoint, "4"),
            PullResult::ResetRequired(_) => panic!("must decode as changes"),
        }
    }
}
