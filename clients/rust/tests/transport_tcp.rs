//! TCP NDJSON transport contract tests against an in-process mock listener.
//!
//! The mock speaks wire contract v1 as newline-delimited JSON over a raw
//! socket, exactly like the node server's `SYNCER_TCP_PORT` listener, so
//! every scenario — correlation, per-frame tokens, split UTF-8 reads, error
//! frames, hints, timeouts, dial failures — runs hermetically.

use opto_sync_client::protocol::{ProtocolQueue, PushRequest, PushResponse, SnapshotResponse};
use opto_sync_client::protocol_sync::{
    ProtocolTransport, PullResult, ResetRequired, TransportFailure,
};
use opto_sync_client::transport::tcp::{TcpProtocolTransport, TcpTransportOptions};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// Accept `connections` clients in sequence; the handler owns each socket.
fn spawn_tcp_server<F>(connections: usize, handler: F) -> SocketAddr
where
    F: Fn(usize, TcpStream) + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock tcp server");
    let address = listener.local_addr().expect("mock server address");
    thread::spawn(move || {
        for index in 0..connections {
            let Ok((stream, _)) = listener.accept() else {
                return;
            };
            handler(index, stream);
        }
    });
    address
}

fn read_frame(reader: &mut BufReader<TcpStream>) -> Value {
    let mut line = String::new();
    reader.read_line(&mut line).expect("mock server read line");
    serde_json::from_str(line.trim_end()).expect("client frame must be JSON")
}

fn write_frame(stream: &mut TcpStream, frame: &Value) {
    let mut line = frame.to_string();
    line.push('\n');
    stream
        .write_all(line.as_bytes())
        .expect("mock server write");
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
    let mut queue = ProtocolQueue::new("device-tcp").expect("valid client id");
    queue
        .queue_upsert("docs", "r1", json!({"id": "r1", "title": "draft"}), None, false)
        .expect("queue upsert");
    queue.push_request(100).expect("valid limit")
}

fn transport(address: SocketAddr) -> TcpProtocolTransport {
    TcpProtocolTransport::new(TcpTransportOptions::new(address.to_string()))
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
    let address = spawn_tcp_server(1, |_, stream| {
        let mut reader = BufReader::new(stream.try_clone().expect("clone mock socket"));
        let mut stream = stream;
        let first = read_frame(&mut reader);
        let second = read_frame(&mut reader);
        for frame in [&second, &first] {
            let response = match frame["type"].as_str() {
                Some("push") => push_result_for(frame),
                Some("pull") => pull_result_for(frame, "5"),
                other => panic!("unexpected frame type {other:?}"),
            };
            write_frame(&mut stream, &response);
        }
        // Hold the socket open until the client is done reading.
        let mut ignored = String::new();
        let _ = reader.read_line(&mut ignored);
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

    assert_eq!(push_response.client_id, "device-tcp");
    assert_eq!(push_response.last_mutation_id, expected_last);
    match pull_result {
        PullResult::Changes(page) => assert_eq!(page.checkpoint, "5"),
        PullResult::ResetRequired(_) => panic!("pull must decode as changes"),
    }
}

#[test]
fn every_frame_carries_the_token_field_when_auth_is_configured() {
    let (frames, seen) = mpsc::channel::<Value>();
    let address = spawn_tcp_server(1, move |_, stream| {
        let mut reader = BufReader::new(stream.try_clone().expect("clone mock socket"));
        let mut stream = stream;
        for _ in 0..2 {
            let frame = read_frame(&mut reader);
            write_frame(&mut stream, &pull_result_for(&frame, "1"));
            frames.send(frame).unwrap();
        }
    });

    let mut options = TcpTransportOptions::new(address.to_string());
    options.auth = Some(Arc::new(|| Some("tcp-tok".to_string())));
    let mut transport = TcpProtocolTransport::new(options);

    transport.pull("0", 10).expect("first pull");
    transport.pull("1", 10).expect("second pull");

    for _ in 0..2 {
        let frame = seen.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(
            frame["token"], "tcp-tok",
            "auth must ride every frame: {frame}"
        );
    }
}

#[test]
fn frames_omit_the_token_field_without_an_auth_provider() {
    let (frames, seen) = mpsc::channel::<Value>();
    let address = spawn_tcp_server(1, move |_, stream| {
        let mut reader = BufReader::new(stream.try_clone().expect("clone mock socket"));
        let mut stream = stream;
        let frame = read_frame(&mut reader);
        write_frame(&mut stream, &pull_result_for(&frame, "1"));
        frames.send(frame).unwrap();
    });

    let mut transport = transport(address);
    transport.pull("0", 10).expect("pull");
    let frame = seen.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(
        frame.get("token").is_none(),
        "no provider, no token field: {frame}"
    );
}

#[test]
fn utf8_frames_reassemble_across_partial_reads() {
    let text = "héllo ✓ 日本語 🚀";
    let address = spawn_tcp_server(1, move |_, stream| {
        let mut reader = BufReader::new(stream.try_clone().expect("clone mock socket"));
        let mut stream = stream;
        let request = read_frame(&mut reader);
        let response = json!({
            "v": 1,
            "type": "pull-result",
            "requestId": request["requestId"],
            "protocolVersion": 1,
            "checkpoint": "1",
            "hasMore": false,
            "changes": [{
                "checkpoint": "1",
                "table": "docs",
                "recordId": "r1",
                "operation": "upsert",
                "record": {"id": "r1", "text": "héllo ✓ 日本語 🚀"},
                "revision": "1",
            }],
        });
        let mut bytes = serde_json::to_vec(&response).expect("serialize response");
        bytes.push(b'\n');
        // Dribble the frame out three bytes at a time, deliberately splitting
        // multi-byte characters across socket reads.
        for chunk in bytes.chunks(3) {
            stream.write_all(chunk).expect("mock server write chunk");
            stream.flush().expect("mock server flush");
            thread::sleep(Duration::from_millis(2));
        }
        let mut ignored = String::new();
        let _ = reader.read_line(&mut ignored);
    });

    let mut transport = transport(address);
    match transport.pull("0", 10).expect("pull must reassemble") {
        PullResult::Changes(page) => {
            assert_eq!(page.changes.len(), 1);
            let record = page.changes[0].record.as_ref().expect("upsert record");
            assert_eq!(record["text"], *text);
        }
        PullResult::ResetRequired(_) => panic!("pull must decode as changes"),
    }
}

#[test]
fn error_frame_becomes_a_typed_failure_with_code_and_retryable() {
    let address = spawn_tcp_server(1, |_, stream| {
        let mut reader = BufReader::new(stream.try_clone().expect("clone mock socket"));
        let mut stream = stream;
        let frame = read_frame(&mut reader);
        write_frame(
            &mut stream,
            &json!({
                "v": 1,
                "type": "error",
                "requestId": frame["requestId"],
                "code": "PAYLOAD_TOO_LARGE",
                "message": "frame exceeds quota",
                "retryable": false,
            }),
        );
        let mut ignored = String::new();
        let _ = reader.read_line(&mut ignored);
    });

    let mut transport = transport(address);
    let request = sample_push_request();
    let failure = transport.push(&request).expect_err("push must fail");
    assert!(!failure.retryable);
    assert_eq!(failure.source.code, "PAYLOAD_TOO_LARGE");
    assert_eq!(failure.source.message, "frame exceeds quota");
}

#[test]
fn changed_hints_reach_the_callback_out_of_band() {
    let address = spawn_tcp_server(1, |_, stream| {
        let mut reader = BufReader::new(stream.try_clone().expect("clone mock socket"));
        let mut stream = stream;
        write_frame(&mut stream, &json!({"v": 1, "type": "changed", "watermark": 41}));
        let frame = read_frame(&mut reader);
        write_frame(&mut stream, &pull_result_for(&frame, "1"));
        let mut ignored = String::new();
        let _ = reader.read_line(&mut ignored);
    });

    let (hints, hinted) = mpsc::channel::<u64>();
    let mut options = TcpTransportOptions::new(address.to_string());
    options.on_changed = Some(Arc::new(move |watermark| {
        let _ = hints.send(watermark);
    }));
    let mut transport = TcpProtocolTransport::new(options);

    transport.pull("0", 10).expect("pull must succeed");
    assert_eq!(
        hinted.recv_timeout(Duration::from_secs(2)),
        Ok(41),
        "the unsolicited changed frame must reach the callback"
    );
}

#[test]
fn request_timeout_surfaces_a_retryable_timeout_error() {
    let address = spawn_tcp_server(1, |_, stream| {
        let mut reader = BufReader::new(stream.try_clone().expect("clone mock socket"));
        let _ = read_frame(&mut reader); // never answered
        thread::sleep(Duration::from_millis(600));
        drop(stream);
    });

    let mut options = TcpTransportOptions::new(address.to_string());
    options.request_timeout = Duration::from_millis(150);
    let mut transport = TcpProtocolTransport::new(options);

    let failure = transport.pull("0", 10).expect_err("pull must time out");
    assert!(failure.retryable);
    assert_eq!(failure.source.code, "TCP_TIMEOUT");
}

#[test]
fn socket_close_fails_the_in_flight_request_as_retryable() {
    let address = spawn_tcp_server(1, |_, stream| {
        let mut reader = BufReader::new(stream.try_clone().expect("clone mock socket"));
        let _ = read_frame(&mut reader);
        // Drop without answering: the client must fail the waiter, not hang.
        drop(stream);
    });

    let mut transport = transport(address);
    let failure = transport.pull("0", 10).expect_err("pull must fail on close");
    assert!(failure.retryable);
    assert_eq!(failure.source.code, "TCP_CLOSED");
}

#[test]
fn dial_failure_reports_backoff_via_retry_after() {
    let dead = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
    let mut options = TcpTransportOptions::new(dead.to_string());
    options.random = Some(Arc::new(|| 1.0)); // deterministic full-jitter sample
    options.reconnect_base = Duration::from_millis(500);
    options.reconnect_max = Duration::from_secs(30);
    let mut transport = TcpProtocolTransport::new(options);

    let first = transport.pull("0", 10).expect_err("dial must fail");
    assert!(first.retryable);
    assert_eq!(first.source.code, "TCP_DIAL_FAILED");
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
    let dead = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
    let fallback = FakeHttpTransport::default();
    let calls = fallback.calls.clone();
    let mut transport = TcpProtocolTransport::with_fallback(
        TcpTransportOptions::new(dead.to_string()),
        fallback,
    );

    let request = sample_push_request();
    let response = transport.push(&request).expect("fallback must serve push");
    assert_eq!(response.checkpoint, "9");
    let snapshot = transport
        .snapshot(&sample_reset())
        .expect("fallback must serve snapshot");
    assert_eq!(snapshot.checkpoint, "77");
    assert_eq!(*calls.lock().unwrap(), ["push", "snapshot"]);
}
