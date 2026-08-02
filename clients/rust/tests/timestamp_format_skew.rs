//! Mixed timestamp FORMATS break last-write-wins, against the real C core.
//!
//! This mirrors `clients/ts/test/timestamp-format-skew.test.js` deliberately.
//! The point of running it in a second language is to establish that the
//! inversion is a property of the shared merge core, not of one binding — so a
//! consumer cannot dismiss it as a JavaScript artifact.
//!
//! The core compares non-digit timestamp strings lexicographically. Within one
//! format that is correct: every format here is fixed-width, so lexicographic
//! order equals chronological order. Only comparisons ACROSS formats are
//! meaningless, and not subtly so — an ISO-8601 string starts with its century
//! ("2..."), a native HLC with epoch millis ("1..." until 2286). ISO therefore
//! always sorts above HLC and wins every conflict however stale it is.
//!
//! Recorded on DEN-1238; this is the concrete N-1/N case for the compatibility
//! matrix (DEN-312), since a client that has not adopted HLC stamping keeps
//! emitting ISO and silently beats every client that has.

use opto_sync_client::{reconcile, ReconcileOptions};

const HLC_2025: &str = "1753876800123-0001-devA.t1";
const HLC_2025_LATER: &str = "1753876800999-0001-devA.t1";
const HLC_2020: &str = "1577836800000-0000-devB.t1";
const ISO_2020: &str = "2020-01-01T00:00:00Z";
const ISO_2026: &str = "2026-01-01T00:00:00Z";

/// Merge two single-field records and report which side's value survived.
fn merge(local_stamp: &str, incoming_stamp: &str) -> String {
    let local = format!(r#"{{"id":"r1","v":"local","updatedAt":{local_stamp}}}"#);
    let incoming = format!(r#"{{"id":"r1","v":"incoming","updatedAt":{incoming_stamp}}}"#);
    let merged = reconcile(&local, &incoming, &ReconcileOptions::default())
        .expect("both documents are valid JSON");
    let value: serde_json::Value = serde_json::from_str(&merged).expect("merge returns JSON");
    value["v"].as_str().expect("v is a string").to_string()
}

/// Quote a stamp so it lands in the document as a JSON string.
fn s(stamp: &str) -> String {
    format!("\"{stamp}\"")
}

#[test]
fn control_within_one_format_the_newer_write_wins() {
    // If any of these regress the problem is LWW itself, not format mixing.
    assert_eq!(merge("999", "123"), "local", "integer millis");
    assert_eq!(merge(&s("999"), &s("123")), "local", "pure-digit strings");
    assert_eq!(merge(&s(ISO_2026), &s(ISO_2020)), "local", "ISO-8601");
    assert_eq!(merge(&s(HLC_2025_LATER), &s(HLC_2025)), "local", "native HLC");

    assert_eq!(merge("123", "999"), "incoming", "integer millis");
    assert_eq!(merge(&s("123"), &s("999")), "incoming", "pure-digit strings");
    assert_eq!(merge(&s(ISO_2020), &s(ISO_2026)), "incoming", "ISO-8601");
    assert_eq!(merge(&s(HLC_2025), &s(HLC_2025_LATER)), "incoming", "native HLC");
}

#[test]
fn documents_the_inversion_iso_beats_hlc_across_five_years() {
    // Local holds a 2025 HLC-stamped write; the server sends a 2020 ISO-stamped
    // one. Chronologically the local write must survive. It does not.
    assert_eq!(
        merge(&s(HLC_2025), &s(ISO_2020)),
        "incoming",
        "a 2020 ISO write beats a 2025 HLC write — the hazard, not a broken test"
    );
}

#[test]
fn documents_the_inversion_iso_wins_from_either_side() {
    // Direction does not matter, which is what makes an un-migrated client a
    // silently privileged writer rather than merely a lucky one.
    assert_eq!(merge(&s(HLC_2025), &s(ISO_2020)), "incoming", "ISO arriving wins");
    assert_eq!(merge(&s(ISO_2020), &s(HLC_2025)), "local", "ISO already held wins");
}

#[test]
fn the_inversion_is_a_format_problem_not_an_hlc_problem() {
    // The same two instants, both expressed as HLC: order is restored. This is
    // what rules out "HLC comparison is broken" as the explanation.
    assert_eq!(
        merge(&s(HLC_2025), &s(HLC_2020)),
        "local",
        "with both sides on HLC the 2025 write correctly survives"
    );
}

#[test]
fn multiple_lww_keys_form_a_veto_not_a_precedence_order() {
    // Easy to assume `lww_keys: "updatedAt,syncedAt"` means "compare updatedAt,
    // fall back to syncedAt". It does not: incoming is rejected if ANY listed
    // key is strictly newer on the local side, so a second LWW key makes
    // rejection MORE likely, never less.
    fn two_key(local: (&str, &str), incoming: (&str, &str)) -> String {
        let l = format!(
            r#"{{"id":"r1","v":"local","updatedAt":{},"syncedAt":{}}}"#,
            local.0, local.1
        );
        let i = format!(
            r#"{{"id":"r1","v":"incoming","updatedAt":{},"syncedAt":{}}}"#,
            incoming.0, incoming.1
        );
        let merged = reconcile(&l, &i, &ReconcileOptions::default()).expect("valid JSON");
        let value: serde_json::Value = serde_json::from_str(&merged).expect("JSON");
        value["v"].as_str().expect("string").to_string()
    }

    // updatedAt favours local — a precedence reading agrees.
    assert_eq!(two_key(("999", "1"), ("1", "999")), "local");

    // updatedAt favours INCOMING but syncedAt favours local. Precedence
    // predicts "incoming"; the veto keeps "local".
    assert_eq!(
        two_key(("1", "999"), ("999", "1")),
        "local",
        "one local-newer key vetoes the node even when another favours incoming"
    );

    // With no key favouring local, incoming is accepted.
    assert_eq!(two_key(("500", "1"), ("500", "999")), "incoming");
    assert_eq!(two_key(("500", "999"), ("500", "1")), "local");
}

#[test]
fn keyed_array_elements_invert_the_same_way() {
    // The inversion is not limited to the root: MERGE_BY_KEY resolves each
    // matched element by the same rules, so one un-migrated writer can freeze
    // individual elements inside a jsonb array.
    let local = format!(
        r#"{{"id":"r1","items":[{{"id":"a","v":"local","updatedAt":"{HLC_2025}"}}]}}"#
    );
    let incoming = format!(
        r#"{{"id":"r1","items":[{{"id":"a","v":"incoming","updatedAt":"{ISO_2020}"}}]}}"#
    );
    let merged = reconcile(&local, &incoming, &ReconcileOptions::default()).expect("valid JSON");
    let value: serde_json::Value = serde_json::from_str(&merged).expect("JSON");
    assert_eq!(
        value["items"][0]["v"].as_str(),
        Some("incoming"),
        "a 2020 ISO element beats a 2025 HLC element inside a keyed array"
    );
}
