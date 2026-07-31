//! WebSocket transport contract tests against an in-process mock server.
//!
//! The mock speaks wire contract v1 (`/sync/ws` JSON text frames) via a
//! plain tungstenite accept loop, so every scenario — correlation, error
//! frames, hints, timeouts, dial failures, token auth — runs hermetically.

#![cfg(feature = "ws")]

use opto_sync_client::protocol::{ProtocolQueue, PushRequest, PushResponse, SnapshotResponse};
use opto_sync_client::protocol_sync::{
    ProtocolTransport, PullResult, ResetRequired, TransportFailure,
};
use opto_sync_client::transport::ws::{WebSocketProtocolTransport, WebSocketTransportOptions};
use serde_json::{json, Value};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tungstenite::handshake::server::{Request, Response};
use tungstenite::{Message, WebSocket};

type ServerSocket = WebSocket<TcpStream>;

/// Accept `connections` WebSocket clients in sequence; the handler gets the
/// connection index, the socket, and the URI the client dialed.
// The `Err` size of the `accept_hdr` callback is fixed by tungstenite's
// `Callback` trait; there is nothing to box here.
#[allow(clippy::result_large_err)]
fn spawn_ws_server<F>(connections: usize, handler: F) -> SocketAddr
where
    F: Fn(usize, &mut ServerSocket, &str) + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock ws server");
    let address = listener.local_addr().expect("mock server address");
    thread::spawn(move || {
        for index in 0..connections {
            let Ok((stream, _)) = listener.accept() else {
                return;
            };
            let mut uri = String::new();
            let accepted =
                tungstenite::accept_hdr(stream, |request: &Request, response: Response| {
                    uri = request.uri().to_string();
                    Ok(response)
                });
            let Ok(mut socket) = accepted else { return };
            handler(index, &mut socket, &uri);
        }
    });
    address
}

fn ws_url(address: SocketAddr) -> String {
    format!("ws://{address}/sync/ws")
}

fn read_frame(socket: &mut ServerSocket) -> Value {
    loop {
        match socket.read().expect("mock server read") {
            Message::Text(text) => {
                return serde_json::from_str(text.as_str()).expect("client frame must be JSON")
            }
            _ => continue,
        }
    }
}

fn send_frame(socket: &mut ServerSocket, frame: &Value) {
    socket
        .send(Message::text(frame.to_string()))
        .expect("mock server send");
}

fn push_result_for(request: &Value) -> Value {
    let mutations = request["mutations"].as_array().expect("push has mutations");
    json!({
        "v": 1,
        "type": "push-result",
        "requestId": request["requestId"],
        "protocolVersion": 1,
        "clientId": request["clientId"],
        "lastMutationId": mutations.last().expect("non-empty batch")["mutationId"],
        "checkpoint": "1",
        "results": mutations
            .iter()
            .map(|mutation| {
                json!({
                    "mutationId": mutation["mutationId"],
                    "status": "applied",
                    "checkpoint": "1",
                    "revision": "1"
                })
            })
            .collect::<Vec<_>>(),
    })
}

fn pull_result_for(request: &Value, checkpoint: &str) -> Value {
    json!({
        "v": 1,
        "type": "pull-result",
        "requestId": request["requestId"],
        "protocolVersion": 1,
        "checkpoint": checkpoint,
        "hasMore": false,
        "changes": [],
    })
}

fn sample_push_request() -> PushRequest {
    let mut queue = ProtocolQueue::new("device-ws").expect("valid client id");
    queue
        .queue_upsert(
            "docs",
            "r1",
            json!({"id": "r1", "title": "draft"}),
            None,
            false,
        )
        .expect("queue upsert");
    queue.push_request(100).expect("valid limit")
}

fn transport(address: SocketAddr) -> WebSocketProtocolTransport {
    WebSocketProtocolTransport::new(WebSocketTransportOptions::new(ws_url(address)))
}

/// Records calls; stands in for the HTTP transport as a dial-failure fallback.
#[derive(Clone, Default)]
struct FakeHttpTransport {
    calls: Arc<Mutex<Vec<String>>>,
}

impl ProtocolTransport for FakeHttpTransport {
    type Error = String;

    fn push(&mut self, request: &PushRequest) -> Result<PushResponse, TransportFailure<String>> {
        self.calls.lock().unwrap().push("push".to_string());
        Ok(PushResponse {
            protocol_version: 1,
            client_id: request.client_id.clone(),
            last_mutation_id: request
                .mutations
                .last()
                .expect("non-empty batch")
                .mutation_id
                .clone(),
            checkpoint: "9".to_string(),
            results: Vec::new(),
        })
    }

    fn pull(
        &mut self,
        checkpoint: &str,
        _limit: usize,
    ) -> Result<PullResult, TransportFailure<String>> {
        self.calls.lock().unwrap().push("pull".to_string());
        Ok(PullResult::Changes(
            serde_json::from_value(json!({
                "protocolVersion": 1,
                "checkpoint": checkpoint,
                "hasMore": false,
                "changes": [],
            }))
            .expect("valid pull response"),
        ))
    }

    fn snapshot(
        &mut self,
        _reset: &ResetRequired,
    ) -> Result<SnapshotResponse, TransportFailure<String>> {
        self.calls.lock().unwrap().push("snapshot".to_string());
        Ok(SnapshotResponse {
            protocol_version: 1,
            checkpoint: "77".to_string(),
            records: Vec::new(),
        })
    }
}

fn sample_reset() -> ResetRequired {
    ResetRequired {
        protocol_version: 1,
        error: "RESET_REQUIRED".to_string(),
        snapshot_url: None,
    }
}

/* ---------------------------------------------------------------------- */

#[test]
fn push_and_pull_round_trip_with_out_of_order_correlation() {
    // The server holds BOTH requests before answering, then answers them in
    // reverse arrival order: each waiter must receive its own response by
    // requestId, not by ordering.
    let address = spawn_ws_server(1, |_, socket, _| {
        let first = read_frame(socket);
        let second = read_frame(socket);
        for frame in [&second, &first] {
            let response = match frame["type"].as_str() {
                Some("push") => push_result_for(frame),
                Some("pull") => pull_result_for(frame, "5"),
                other => panic!("unexpected frame type {other:?}"),
            };
            send_frame(socket, &response);
        }
        // Hold the socket open until the client is done reading.
        let _ = socket.read();
    });

    let mut pusher = transport(address);
    let mut puller = pusher.clone();
    let request = sample_push_request();
    let expected_last = request.mutations.last().unwrap().mutation_id.clone();

    let push_thread = thread::spawn(move || pusher.push(&request));
    let pull_result = puller.pull("0", 50).expect("pull must round-trip");
    let push_response = push_thread
        .join()
        .expect("push thread")
        .expect("push must round-trip");

    assert_eq!(push_response.client_id, "device-ws");
    assert_eq!(push_response.last_mutation_id, expected_last);
    assert_eq!(push_response.checkpoint, "1");
    match pull_result {
        PullResult::Changes(page) => {
            assert_eq!(page.checkpoint, "5");
            assert!(!page.has_more);
        }
        PullResult::ResetRequired(_) => panic!("pull must decode as changes"),
    }
}

#[test]
fn error_frame_becomes_a_typed_failure_with_code_and_retryable() {
    let address = spawn_ws_server(1, |_, socket, _| {
        let first = read_frame(socket);
        send_frame(
            socket,
            &json!({
                "v": 1,
                "type": "error",
                "requestId": first["requestId"],
                "code": "RATE_LIMITED",
                "message": "slow down",
                "retryable": true,
            }),
        );
        let second = read_frame(socket);
        send_frame(
            socket,
            &json!({
                "v": 1,
                "type": "error",
                "requestId": second["requestId"],
                "code": "UNAUTHORIZED",
                "message": "bad token",
                "retryable": false,
            }),
        );
        let _ = socket.read();
    });

    let mut transport = transport(address);
    let retryable = transport.pull("0", 10).expect_err("first pull must fail");
    assert!(retryable.retryable);
    assert_eq!(retryable.source.code, "RATE_LIMITED");
    assert_eq!(retryable.source.message, "slow down");

    let permanent = transport.pull("0", 10).expect_err("second pull must fail");
    assert!(!permanent.retryable);
    assert_eq!(permanent.source.code, "UNAUTHORIZED");
}

#[test]
fn changed_hints_reach_the_callback_out_of_band() {
    let address = spawn_ws_server(1, |_, socket, _| {
        send_frame(socket, &json!({"v": 1, "type": "changed", "watermark": 42}));
        let request = read_frame(socket);
        send_frame(socket, &pull_result_for(&request, "1"));
        let _ = socket.read();
    });

    let (hints, hinted) = mpsc::channel::<u64>();
    let mut options = WebSocketTransportOptions::new(ws_url(address));
    options.on_changed = Some(Arc::new(move |watermark| {
        let _ = hints.send(watermark);
    }));
    let mut transport = WebSocketProtocolTransport::new(options);

    transport.pull("0", 10).expect("pull must succeed");
    assert_eq!(
        hinted.recv_timeout(Duration::from_secs(2)),
        Ok(42),
        "the unsolicited changed frame must reach the callback"
    );
}

#[test]
fn request_timeout_surfaces_a_retryable_timeout_error() {
    let address = spawn_ws_server(1, |_, socket, _| {
        let _ = read_frame(socket); // never answered
        thread::sleep(Duration::from_millis(600));
    });

    let mut options = WebSocketTransportOptions::new(ws_url(address));
    options.request_timeout = Duration::from_millis(150);
    let mut transport = WebSocketProtocolTransport::new(options);

    let failure = transport.pull("0", 10).expect_err("pull must time out");
    assert!(failure.retryable);
    assert_eq!(failure.source.code, "WS_TIMEOUT");
}

#[test]
fn socket_close_fails_the_in_flight_request_as_retryable() {
    let address = spawn_ws_server(1, |_, socket, _| {
        let _ = read_frame(socket);
        // Drop without answering: the client must fail the waiter, not hang.
    });

    let mut transport = transport(address);
    let failure = transport
        .pull("0", 10)
        .expect_err("pull must fail on close");
    assert!(failure.retryable);
    assert_eq!(failure.source.code, "WS_CLOSED");
}

#[test]
fn dial_failure_reports_backoff_via_retry_after() {
    let dead = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap();
    let mut options = WebSocketTransportOptions::new(ws_url(dead));
    options.random = Some(Arc::new(|| 1.0)); // deterministic full-jitter sample
    options.reconnect_base = Duration::from_millis(500);
    options.reconnect_max = Duration::from_secs(30);
    let mut transport = WebSocketProtocolTransport::new(options);

    let first = transport.pull("0", 10).expect_err("dial must fail");
    assert!(first.retryable);
    assert_eq!(first.source.code, "WS_DIAL_FAILED");
    assert_eq!(first.retry_after, Some(Duration::from_millis(500)));

    let second = transport.pull("0", 10).expect_err("dial must fail again");
    assert_eq!(
        second.retry_after,
        Some(Duration::from_secs(1)),
        "consecutive dial failures must back off exponentially"
    );
}

#[test]
fn dial_failure_falls_back_to_the_http_transport() {
    let dead = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap();
    let fallback = FakeHttpTransport::default();
    let calls = fallback.calls.clone();
    let mut transport = WebSocketProtocolTransport::with_fallback(
        WebSocketTransportOptions::new(ws_url(dead)),
        fallback,
    );

    let request = sample_push_request();
    let response = transport.push(&request).expect("fallback must serve push");
    assert_eq!(response.checkpoint, "9");
    match transport.pull("3", 10).expect("fallback must serve pull") {
        PullResult::Changes(page) => assert_eq!(page.checkpoint, "3"),
        PullResult::ResetRequired(_) => panic!("fallback pull must be changes"),
    }
    assert_eq!(*calls.lock().unwrap(), ["push", "pull"]);
}

#[test]
fn snapshot_prefers_the_fallback_without_dialing() {
    // No server exists at all: with a fallback configured, snapshot must not
    // even try the socket.
    let dead = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap();
    let fallback = FakeHttpTransport::default();
    let calls = fallback.calls.clone();
    let mut transport = WebSocketProtocolTransport::with_fallback(
        WebSocketTransportOptions::new(ws_url(dead)),
        fallback,
    );

    let snapshot = transport
        .snapshot(&sample_reset())
        .expect("fallback must serve snapshot");
    assert_eq!(snapshot.checkpoint, "77");
    assert_eq!(*calls.lock().unwrap(), ["snapshot"]);
}

#[test]
fn snapshot_travels_over_the_socket_when_no_fallback_exists() {
    let address = spawn_ws_server(1, |_, socket, _| {
        let request = read_frame(socket);
        assert_eq!(request["type"], "snapshot");
        send_frame(
            socket,
            &json!({
                "v": 1,
                "type": "snapshot-result",
                "requestId": request["requestId"],
                "protocolVersion": 1,
                "checkpoint": "8",
                "records": [{
                    "table": "docs",
                    "recordId": "r1",
                    "record": {"id": "r1"},
                    "revision": "2",
                }],
            }),
        );
        let _ = socket.read();
    });

    let mut transport = transport(address);
    let snapshot = transport
        .snapshot(&sample_reset())
        .expect("snapshot must round-trip");
    assert_eq!(snapshot.checkpoint, "8");
    assert_eq!(snapshot.records.len(), 1);
    assert_eq!(snapshot.records[0].record_id, "r1");
}

#[test]
fn pull_result_carrying_reset_required_decodes_as_reset() {
    let address = spawn_ws_server(1, |_, socket, _| {
        let request = read_frame(socket);
        send_frame(
            socket,
            &json!({
                "v": 1,
                "type": "pull-result",
                "requestId": request["requestId"],
                "protocolVersion": 1,
                "error": "RESET_REQUIRED",
                "resetRequired": true,
                "snapshotUrl": "/v1/sync/snapshot",
            }),
        );
        let _ = socket.read();
    });

    let mut transport = transport(address);
    match transport.pull("0", 10).expect("reset is a successful pull") {
        PullResult::ResetRequired(reset) => {
            assert_eq!(reset.error, "RESET_REQUIRED");
            assert_eq!(reset.snapshot_url.as_deref(), Some("/v1/sync/snapshot"));
        }
        PullResult::Changes(_) => panic!("must decode as reset"),
    }
}

#[test]
fn token_is_a_query_parameter_and_reread_on_every_reconnect() {
    let (uris, dialed) = mpsc::channel::<String>();
    let address = spawn_ws_server(2, move |_, socket, uri| {
        uris.send(uri.to_string()).unwrap();
        let request = read_frame(socket);
        send_frame(socket, &pull_result_for(&request, "1"));
        // Close so the client's next request must reconnect.
    });

    let counter = AtomicUsize::new(0);
    let mut options = WebSocketTransportOptions::new(ws_url(address));
    options.auth = Some(Arc::new(move || {
        Some(match counter.fetch_add(1, Ordering::SeqCst) {
            0 => "tok one/1".to_string(),
            _ => "tok-two".to_string(),
        })
    }));
    let mut transport = WebSocketProtocolTransport::new(options);

    transport.pull("0", 10).expect("first pull");
    let first_uri = dialed.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(
        first_uri.contains("token=tok%20one%2F1"),
        "token must be URL-encoded in the dial URI: {first_uri}"
    );

    // Give the client time to observe the server-side close, then force a
    // reconnect, which must re-read the provider.
    thread::sleep(Duration::from_millis(300));
    transport
        .pull("1", 10)
        .expect("second pull over a fresh socket");
    let second_uri = dialed.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(
        second_uri.contains("token=tok-two"),
        "reconnect must pick up the fresh token: {second_uri}"
    );
}

#[test]
fn disposed_transport_refuses_further_requests_permanently() {
    let address = spawn_ws_server(1, |_, socket, _| {
        let request = read_frame(socket);
        send_frame(socket, &pull_result_for(&request, "1"));
        let _ = socket.read();
    });

    let mut transport = transport(address);
    transport.pull("0", 10).expect("pull before dispose");
    transport.dispose();
    let failure = transport.pull("0", 10).expect_err("disposed must refuse");
    assert!(!failure.retryable);
    assert_eq!(failure.source.code, "WS_DISPOSED");
}
