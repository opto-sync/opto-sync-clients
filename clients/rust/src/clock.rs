//! Hybrid Logical Clock for ordering optimistic writes.
//!
//! # Why
//!
//! The merge engine resolves conflicts by last-write-wins on `updatedAt`. That
//! is only correct if the timestamps are actually ordered, and a device wall
//! clock is not:
//!
//! - **Skew** — a device 5 minutes fast wins *every* conflict forever, even
//!   when its edit is genuinely older.
//! - **Rollback** — an NTP correction moves the clock back, so the device's
//!   later edits lose to its own earlier ones and silently vanish.
//! - **Ties** — equal timestamps are "neither newer", so arrival order decides
//!   and two replicas can diverge.
//!
//! An HLC tracks physical time, never moves backwards, breaks ties with a
//! counter, and embeds a node id so no two nodes collide — a **total order**.
//!
//! # Wire format
//!
//! `<13-digit millis>-<4-hex counter>-<node id>`, byte-identical to the
//! TypeScript and Dart clients so timestamps from any client order against
//! each other. Fixed width is load-bearing: the C core compares non-digit
//! strings lexicographically, so fixed width makes lexicographic order equal
//! chronological order.

use std::fmt;

const MILLIS_DIGITS: usize = 13;
const MAX_COUNTER: u32 = 0xffff;

/// Decomposed HLC timestamp.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HlcParts {
    pub millis: u64,
    pub counter: u32,
    pub node_id: String,
}

/// How far ahead of local physical time an observed remote timestamp may be
/// before it is refused.
///
/// Without a bound, [`HybridLogicalClock::observe`] adopts any remote value, so
/// ONE client with a broken or hostile clock poisons every clock that syncs with
/// it — and every honest write then loses to the poisoned timestamp forever.
/// Reference implementations all bound this: jlongster/Actual uses 60s, uhlc-rs
/// defaults to 500ms.
pub const DEFAULT_MAX_DRIFT_MS: u64 = 60_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClockError {
    /// The node id is empty or contains the `-` delimiter, which would make
    /// parsing ambiguous.
    InvalidNodeId(String),
    /// A remote timestamp was further ahead of local physical time than the
    /// configured bound, so it was refused rather than adopted. See
    /// [`DEFAULT_MAX_DRIFT_MS`].
    Drift {
        remote: String,
        drift_ms: u64,
        max_drift_ms: u64,
    },
}

impl fmt::Display for ClockError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ClockError::InvalidNodeId(id) => {
                write!(f, "node id must be non-empty and contain no '-': {id:?}")
            }
            ClockError::Drift { remote, drift_ms, max_drift_ms } => write!(
                f,
                "remote timestamp {remote} is {drift_ms}ms ahead of local time \
                 (max {max_drift_ms}ms); refusing to adopt it"
            ),
        }
    }
}

impl std::error::Error for ClockError {}

pub fn format_hlc(parts: &HlcParts) -> String {
    format!(
        "{:0>width$}-{:04x}-{}",
        parts.millis,
        parts.counter,
        parts.node_id,
        width = MILLIS_DIGITS
    )
}

/// Returns `None` for anything not produced by this format (a bare epoch
/// number or an ISO-8601 string from a legacy writer).
pub fn parse_hlc(timestamp: &str) -> Option<HlcParts> {
    let mut it = timestamp.splitn(3, '-');
    let millis = it.next()?;
    let counter = it.next()?;
    let node_id = it.next()?;
    if millis.len() != MILLIS_DIGITS || !millis.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if counter.len() != 4 || !counter.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    if node_id.is_empty() {
        return None;
    }
    Some(HlcParts {
        millis: millis.parse().ok()?,
        counter: u32::from_str_radix(counter, 16).ok()?,
        node_id: node_id.to_string(),
    })
}

/// Total order over HLC strings. Lexicographic, because the format is fixed-width.
pub fn compare_hlc(a: &str, b: &str) -> std::cmp::Ordering {
    a.cmp(b)
}

/// Generate a delimiter-free random node id from the OS entropy source.
///
/// Persist the DEVICE id: a client that regenerates it on every launch loses
/// consistent tie-breaking against its own past writes.
pub fn random_node_id(byte_length: usize) -> String {
    let mut bytes = vec![0u8; byte_length];
    // Collision resistance is what a node id needs; `getrandom` reads the
    // platform CSPRNG, so two installs cannot land on the same id in practice.
    getrandom::fill(&mut bytes).expect("OS entropy source must be available");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Compose a per-writer node id from a durable device id and a per-instance
/// suffix.
///
/// The suffix is essential and easy to miss: several writers can share one
/// durable store (a background sync task alongside the UI, two processes over
/// one sqlite file), so they would read the same persisted device id and the
/// same clock state and issue *identical* timestamps — reintroducing exactly the
/// tie the node id exists to prevent.
///
/// Separator is `.` because `-` delimits the wire format. Pass `None` for the
/// suffix to get a fresh random one per instance.
pub fn compose_node_id(device_id: &str, instance_suffix: Option<&str>) -> String {
    match instance_suffix {
        Some(s) => format!("{device_id}.{s}"),
        None => format!("{device_id}.{}", random_node_id(3)),
    }
}

/// Where the clock's last state is kept so it survives a restart. Implement
/// against whatever store already holds the mutation queue.
pub trait ClockPersistence {
    fn load(&self) -> Option<String>;
    fn save(&mut self, timestamp: &str);
}

/// Non-durable persistence: the clock resets on restart. Fine for tests, not
/// for a device that must not reissue timestamps after a crash.
#[derive(Debug, Default)]
pub struct NoPersistence;

impl ClockPersistence for NoPersistence {
    fn load(&self) -> Option<String> {
        None
    }
    fn save(&mut self, _timestamp: &str) {}
}

/// A hybrid logical clock.
///
/// `now_fn` is injectable so tests can move the wall clock backwards; in
/// production pass a closure reading the system clock.
pub struct HybridLogicalClock<P: ClockPersistence = NoPersistence> {
    node_id: String,
    millis: u64,
    counter: u32,
    max_drift_ms: u64,
    now_fn: Box<dyn Fn() -> u64 + Send>,
    persistence: P,
}

impl<P: ClockPersistence> HybridLogicalClock<P> {
    pub fn new(
        node_id: impl Into<String>,
        now_fn: Box<dyn Fn() -> u64 + Send>,
        persistence: P,
    ) -> Result<Self, ClockError> {
        Self::with_max_drift(node_id, now_fn, persistence, DEFAULT_MAX_DRIFT_MS)
    }

    /// Same as [`Self::new`] with an explicit drift bound. Raise it only if you
    /// genuinely trust peers whose clocks are that far off; lowering it makes
    /// `observe` stricter. See [`DEFAULT_MAX_DRIFT_MS`].
    pub fn with_max_drift(
        node_id: impl Into<String>,
        now_fn: Box<dyn Fn() -> u64 + Send>,
        mut persistence: P,
        max_drift_ms: u64,
    ) -> Result<Self, ClockError> {
        let node_id = node_id.into();
        if node_id.is_empty() || node_id.contains('-') {
            return Err(ClockError::InvalidNodeId(node_id));
        }
        // Restore immediately: a clock that issues a timestamp before restoring
        // could go backwards across a restart, which is the failure this type
        // exists to prevent.
        let (millis, counter) = match persistence.load().as_deref().and_then(parse_hlc) {
            Some(p) => (p.millis, p.counter),
            None => (0, 0),
        };
        let _ = &mut persistence;
        Ok(Self { node_id, millis, counter, max_drift_ms, now_fn, persistence })
    }

    pub fn node_id(&self) -> &str {
        &self.node_id
    }

    /// The drift bound enforced by [`Self::observe`].
    pub fn max_drift_ms(&self) -> u64 {
        self.max_drift_ms
    }

    pub fn peek(&self) -> HlcParts {
        HlcParts { millis: self.millis, counter: self.counter, node_id: self.node_id.clone() }
    }

    /// Issue the next timestamp: strictly greater than every timestamp this
    /// clock has issued or observed, even if the wall clock jumped backwards.
    pub fn next(&mut self) -> String {
        let physical = (self.now_fn)();
        if physical > self.millis {
            self.millis = physical;
            self.counter = 0;
        } else {
            self.counter += 1;
            if self.counter > MAX_COUNTER {
                self.millis += 1;
                self.counter = 0;
            }
        }
        let ts = format_hlc(&self.peek());
        self.persistence.save(&ts);
        ts
    }

    /// Advance past a timestamp observed from another node, so the next local
    /// write outranks anything already seen. Non-HLC values are ignored: their
    /// scale is not comparable and adopting one would corrupt the clock.
    ///
    /// # Errors
    ///
    /// [`ClockError::Drift`] when `remote` is more than [`Self::max_drift_ms`]
    /// ahead of local physical time. This is bounded trust, and it is why the
    /// method returns a `Result`: a timestamp far in the future is a broken or
    /// hostile clock, not causality, and adopting it would make every honest
    /// write — on this client and on every client that later syncs with it —
    /// lose to the poisoned value indefinitely. A refused timestamp leaves the
    /// clock untouched.
    ///
    /// Refusal is not fatal to the sync itself: the merge does not depend on
    /// this clock having observed the remote value, so a caller that just wants
    /// to keep going can log the error and continue.
    pub fn observe(&mut self, remote: &str) -> Result<(), ClockError> {
        let Some(parsed) = parse_hlc(remote) else { return Ok(()) };

        let now = (self.now_fn)();
        if parsed.millis > now && parsed.millis - now > self.max_drift_ms {
            return Err(ClockError::Drift {
                remote: remote.to_string(),
                drift_ms: parsed.millis - now,
                max_drift_ms: self.max_drift_ms,
            });
        }

        if parsed.millis > self.millis {
            self.millis = parsed.millis;
            self.counter = parsed.counter;
        } else if parsed.millis == self.millis && parsed.counter > self.counter {
            self.counter = parsed.counter;
        } else {
            return Ok(());
        }
        let ts = format_hlc(&self.peek());
        self.persistence.save(&ts);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::rc::Rc;

    struct VecPersistence(Rc<Cell<Option<String>>>);
    impl ClockPersistence for VecPersistence {
        fn load(&self) -> Option<String> {
            let v = self.0.take();
            self.0.set(v.clone());
            v
        }
        fn save(&mut self, timestamp: &str) {
            self.0.set(Some(timestamp.to_string()));
        }
    }

    fn clock_at(ms: Rc<Cell<u64>>) -> Box<dyn Fn() -> u64 + Send> {
        // Rc isn't Send, so copy the value through a raw read; tests are
        // single-threaded and this keeps the production signature honest.
        let ptr = Rc::into_raw(ms) as usize;
        Box::new(move || unsafe { (*(ptr as *const Cell<u64>)).get() })
    }

    #[test]
    fn monotonic_within_one_millisecond() {
        let ms = Rc::new(Cell::new(1_721_822_400_000u64));
        let mut c =
            HybridLogicalClock::new("aaaa", clock_at(ms.clone()), NoPersistence).unwrap();
        let a = c.next();
        let b = c.next();
        assert!(a < b, "{a} < {b}");
        assert_eq!(parse_hlc(&a).unwrap().counter, 0);
        assert_eq!(parse_hlc(&b).unwrap().counter, 1);
    }

    #[test]
    fn survives_a_backwards_wall_clock() {
        let ms = Rc::new(Cell::new(1_721_822_400_000u64));
        let mut c =
            HybridLogicalClock::new("aaaa", clock_at(ms.clone()), NoPersistence).unwrap();
        let before = c.next();
        ms.set(1_721_822_100_000); // five minutes into the past
        let after = c.next();
        assert!(after > before, "{after} must outrank {before}");
    }

    #[test]
    fn observe_advances_past_a_remote_timestamp() {
        let ms = Rc::new(Cell::new(1_721_822_400_000u64));
        let mut c =
            HybridLogicalClock::new("aaaa", clock_at(ms.clone()), NoPersistence).unwrap();
        // 10s ahead: ordinary skew, well inside the drift bound.
        let remote = "1721822410000-00ff-bbbb";
        c.observe(remote).unwrap();
        let next = c.next();
        assert!(next > remote.to_string(), "{next} must outrank {remote}");
    }

    #[test]
    fn observe_ignores_incomparable_timestamps() {
        let ms = Rc::new(Cell::new(1_721_822_400_000u64));
        let mut c =
            HybridLogicalClock::new("aaaa", clock_at(ms.clone()), NoPersistence).unwrap();
        c.observe("2026-07-25T00:00:00Z").unwrap();
        c.observe("1721822400000").unwrap();
        assert_eq!(c.peek().millis, 0, "clock must not adopt an incomparable scale");
    }

    #[test]
    fn observe_refuses_a_timestamp_far_in_the_future() {
        // Without a bound, ONE client with a broken or hostile clock poisons
        // every clock that syncs with it, and every honest write then loses to
        // the poisoned timestamp forever.
        let wall = 1_721_822_400_000u64;
        let ms = Rc::new(Cell::new(wall));
        let mut c =
            HybridLogicalClock::new("aaaa", clock_at(ms.clone()), NoPersistence).unwrap();

        let poisoned = format!("{}-0000-evil", wall + DEFAULT_MAX_DRIFT_MS + 60_000);
        let err = c.observe(&poisoned).unwrap_err();
        assert!(
            matches!(err, ClockError::Drift { .. }),
            "expected a drift refusal, got {err:?}"
        );
        assert_eq!(c.peek().millis, 0, "a refused timestamp must not be adopted");

        // Within the bound is still adopted — ordinary skew must not break sync.
        let tolerable = format!("{}-0000-bbbb", wall + 5_000);
        c.observe(&tolerable).unwrap();
        assert_eq!(c.peek().millis, wall + 5_000);
    }

    #[test]
    fn observe_accepts_a_timestamp_in_the_past() {
        // A remote clock *behind* ours is not drift: only future-skew poisons
        // the order, and the subtraction must not underflow.
        let ms = Rc::new(Cell::new(1_721_822_400_000u64));
        let mut c =
            HybridLogicalClock::new("aaaa", clock_at(ms.clone()), NoPersistence).unwrap();
        c.observe("1000000000000-0001-bbbb").unwrap();
        assert_eq!(c.peek().millis, 1_000_000_000_000);
    }

    #[test]
    fn compose_node_id_uses_a_non_delimiter_separator() {
        // '-' delimits the wire format, so composing with it would make
        // parse_hlc ambiguous. The suffix is what stops two writers over one
        // durable store from issuing identical timestamps.
        let id = compose_node_id("device1", Some("t2"));
        assert_eq!(id, "device1.t2");
        assert!(parse_hlc(&format_hlc(&HlcParts {
            millis: 1_721_822_400_000,
            counter: 0,
            node_id: id.clone(),
        }))
        .is_some_and(|p| p.node_id == id));

        let a = compose_node_id("device1", None);
        let b = compose_node_id("device1", None);
        assert_ne!(a, b, "two instances sharing a device id must not share a node id");
        assert!(!a.contains('-'), "{a}");
    }

    #[test]
    fn two_nodes_never_tie() {
        let ms = Rc::new(Cell::new(1_721_822_400_000u64));
        let mut a =
            HybridLogicalClock::new("aaaa", clock_at(ms.clone()), NoPersistence).unwrap();
        let mut b =
            HybridLogicalClock::new("bbbb", clock_at(ms.clone()), NoPersistence).unwrap();
        assert_ne!(a.next(), b.next(), "a tie would make the merge order-dependent");
    }

    #[test]
    fn persistence_keeps_the_clock_monotonic_across_a_restart() {
        let store = Rc::new(Cell::new(None));
        let ms = Rc::new(Cell::new(1_721_822_400_000u64));
        let last = {
            let mut c = HybridLogicalClock::new(
                "aaaa",
                clock_at(ms.clone()),
                VecPersistence(store.clone()),
            )
            .unwrap();
            c.next()
        };
        ms.set(1_721_800_000_000); // restart with the clock moved backwards
        let mut reloaded = HybridLogicalClock::new(
            "aaaa",
            clock_at(ms.clone()),
            VecPersistence(store.clone()),
        )
        .unwrap();
        let after = reloaded.next();
        assert!(after > last, "{after} must outrank pre-restart {last}");
    }

    #[test]
    fn rejects_a_node_id_containing_the_delimiter() {
        let ms = Rc::new(Cell::new(0u64));
        assert!(HybridLogicalClock::new("has-dash", clock_at(ms.clone()), NoPersistence).is_err());
        assert!(HybridLogicalClock::new("", clock_at(ms.clone()), NoPersistence).is_err());
    }

    #[test]
    fn format_matches_the_typescript_and_dart_clients() {
        // Byte-identical formatting is what lets a Rust client's timestamps
        // order against a browser client's.
        let parts = HlcParts { millis: 1_721_822_400_000, counter: 255, node_id: "9f3a2b".into() };
        assert_eq!(format_hlc(&parts), "1721822400000-00ff-9f3a2b");
        assert_eq!(parse_hlc("1721822400000-00ff-9f3a2b").unwrap(), parts);
    }
}
