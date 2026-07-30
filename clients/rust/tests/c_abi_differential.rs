use serde_json::json;
use std::ffi::{c_void, CStr, CString};
use std::ptr;
use syncer_rs::{
    try_merge_json_with_options, ArrayMergeStrategy, MergeOptions, SyncerMergeOptionsC,
};

fn direct_c_merge(
    base: &str,
    incoming: &str,
    strategy: ArrayMergeStrategy,
    resolve_by_timestamp: bool,
    lww_keys: Option<&str>,
    fww_keys: Option<&str>,
    array_match_keys: Option<&str>,
) -> Option<String> {
    let base = CString::new(base).ok()?;
    let incoming = CString::new(incoming).ok()?;
    let lww = lww_keys.map(CString::new).transpose().ok()?;
    let fww = fww_keys.map(CString::new).transpose().ok()?;
    let match_keys = array_match_keys.map(CString::new).transpose().ok()?;
    let options = SyncerMergeOptionsC {
        override_cb: None,
        array_strategy: strategy,
        max_depth: 0,
        detect_circular_refs: false,
        resolve_by_timestamp,
        lww_keys: lww.as_ref().map_or(ptr::null(), |value| value.as_ptr()),
        fww_keys: fww.as_ref().map_or(ptr::null(), |value| value.as_ptr()),
        array_match_keys: match_keys
            .as_ref()
            .map_or(ptr::null(), |value| value.as_ptr()),
    };
    unsafe {
        let output = syncer_rs::syncer_merge_json_ex(base.as_ptr(), incoming.as_ptr(), &options);
        if output.is_null() {
            return None;
        }
        let result = CStr::from_ptr(output).to_str().ok().map(str::to_owned);
        syncer_rs::syncer_free(output.cast::<c_void>());
        result
    }
}

fn wrapped_merge(
    base: &str,
    incoming: &str,
    strategy: ArrayMergeStrategy,
    resolve_by_timestamp: bool,
    lww_keys: Option<&str>,
    fww_keys: Option<&str>,
    array_match_keys: Option<&str>,
) -> Option<String> {
    try_merge_json_with_options(
        base,
        incoming,
        &MergeOptions {
            array_strategy: Some(strategy),
            max_depth: None,
            detect_circular_refs: false,
            resolve_by_timestamp,
            lww_keys: lww_keys.map(str::to_owned),
            fww_keys: fww_keys.map(str::to_owned),
            array_match_keys: array_match_keys.map(str::to_owned),
        },
    )
}

fn assert_parity(
    base: &str,
    incoming: &str,
    strategy: ArrayMergeStrategy,
    resolve_by_timestamp: bool,
    lww_keys: Option<&str>,
    fww_keys: Option<&str>,
    array_match_keys: Option<&str>,
) {
    let direct = direct_c_merge(
        base,
        incoming,
        strategy,
        resolve_by_timestamp,
        lww_keys,
        fww_keys,
        array_match_keys,
    );
    let wrapped = wrapped_merge(
        base,
        incoming,
        strategy,
        resolve_by_timestamp,
        lww_keys,
        fww_keys,
        array_match_keys,
    );
    assert_eq!(
        wrapped, direct,
        "Rust wrapper/C ABI divergence\nbase={base}\nincoming={incoming}\nstrategy={strategy:?}"
    );
}

#[test]
fn rust_wrapper_is_byte_identical_to_direct_c_for_shared_edge_corpus() {
    let corpus = [
        (r#"{}"#, r#"{}"#),
        (r#"{"a":1,"nested":{"left":true}}"#, r#"{"b":2,"nested":{"right":true}}"#),
        (r#"{"updatedAt":"9","value":"old"}"#, r#"{"updatedAt":"10","value":"new"}"#),
        (r#"{"createdAt":1,"value":"first"}"#, r#"{"createdAt":2,"value":"second"}"#),
        (r#"{"items":[{"id":1,"value":"a"},{"id":2,"keep":true}]}"#, r#"{"items":[{"id":"2","value":"b"},{"id":3,"value":"c"}]}"#),
        (r#"{"meta":{"updatedAt":"999999999999999999"},"emoji":"🦀"}"#, r#"{"meta":{"updatedAt":"1000000000000000000"},"emoji":"🚀"}"#),
        (r#"{"items":[1,2,2,3]}"#, r#"{"items":[2,3,4]}"#),
        (r#"{"rows":[{"uuid":"u-1","id":1,"left":true}]}"#, r#"{"rows":[{"uuid":"u-1","id":999,"right":true}]}"#),
    ];
    let strategies = [
        ArrayMergeStrategy::Replace,
        ArrayMergeStrategy::Append,
        ArrayMergeStrategy::Union,
        ArrayMergeStrategy::MergeByIndex,
        ArrayMergeStrategy::MergeByKey,
    ];
    for (base, incoming) in corpus {
        for strategy in strategies {
            assert_parity(
                base,
                incoming,
                strategy,
                true,
                Some("updatedAt,#/meta/updatedAt"),
                Some("createdAt"),
                Some("uuid,id"),
            );
            assert_parity(base, incoming, strategy, false, None, None, None);
        }
    }
}

#[test]
fn rust_wrapper_is_byte_identical_to_direct_c_for_deterministic_random_documents() {
    let mut state = 0x5eed_1234_89ab_cdef_u64;
    let mut next = || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    let strategies = [
        ArrayMergeStrategy::Replace,
        ArrayMergeStrategy::Append,
        ArrayMergeStrategy::Union,
        ArrayMergeStrategy::MergeByIndex,
        ArrayMergeStrategy::MergeByKey,
    ];

    for index in 0..750_u64 {
        let left_clock = next() % 10_000;
        let right_clock = next() % 10_000;
        let shared_id = next() % 32;
        let base = json!({
            "id": index % 41,
            "updatedAt": left_clock.to_string(),
            "nested": {
                "left": next() % 1000,
                "flag": next() & 1 == 0,
                "unicode": if next() & 1 == 0 { "café" } else { "🦀" },
            },
            "items": [
                {"id": shared_id, "updatedAt": left_clock, "left": next() % 100},
                {"id": next() % 64, "baseOnly": true},
            ],
        })
        .to_string();
        let incoming = json!({
            "id": index % 41,
            "updatedAt": right_clock.to_string(),
            "nested": {
                "right": next() % 1000,
                "flag": next() & 1 == 0,
            },
            "items": [
                {"id": shared_id.to_string(), "updatedAt": right_clock, "right": next() % 100},
                {"id": next() % 64, "incomingOnly": true},
            ],
        })
        .to_string();
        let strategy = strategies[(next() as usize) % strategies.len()];
        assert_parity(
            &base,
            &incoming,
            strategy,
            next() & 1 == 0,
            Some("updatedAt"),
            Some("createdAt"),
            Some("id"),
        );
    }
}

#[test]
fn rust_wrapper_and_direct_c_reject_the_same_invalid_inputs() {
    assert_parity(
        "{invalid",
        "{}",
        ArrayMergeStrategy::Replace,
        false,
        None,
        None,
        None,
    );
    assert_parity(
        "{}",
        "[invalid",
        ArrayMergeStrategy::MergeByKey,
        true,
        Some("updatedAt"),
        None,
        Some("id"),
    );
    assert_eq!(syncer_rs::version(), unsafe {
        CStr::from_ptr(syncer_rs::syncer_version())
            .to_str()
            .expect("C version is UTF-8")
    });
}
