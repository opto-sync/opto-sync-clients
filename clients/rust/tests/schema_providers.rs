use std::path::PathBuf;

use opto_sync_client::schema::{
    audit_provider, garde_provider, json_schema_provider, parse_envelope, parse_envelope_with,
    validator_provider,
};
use serde_json::Value;

fn fixture(kind: &str, name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../schema/fixtures")
        .join(kind)
        .join(name);
    std::fs::read_to_string(path).expect("readable fixture")
}

#[test]
fn rejects_null_optionals_and_unsafe_integers() {
    for name in [
        "null-source.json",
        "null-operation.json",
        "null-base-revision.json",
        "null-optional-timestamp.json",
        "unsafe-integer-timestamp.json",
    ] {
        assert!(
            parse_envelope(&fixture("invalid", name)).is_err(),
            "{name} should be rejected"
        );
    }
}

#[test]
fn accepts_unicode_code_point_boundaries() {
    let envelope = parse_envelope(&fixture("valid", "safe-integer-unicode-boundaries.json"))
        .expect("boundary fixture should be valid");
    assert_eq!(envelope.source.as_deref().unwrap().chars().count(), 200);
    assert_eq!(envelope.records[0].record_id.chars().count(), 512);
}

#[test]
fn accepts_integral_json_number_timestamps() {
    parse_envelope(&fixture("valid", "integral-number-timestamps.json"))
        .expect("integral JSON numbers should satisfy the integer schema");
}

#[test]
fn named_library_adapters_are_veto_gates() {
    let reject = |_: &Value| Err(vec!["blocked by policy".to_string()]);
    let validator = validator_provider(reject);
    let garde = garde_provider(reject);
    let jsonschema = json_schema_provider(reject);
    let text = fixture("valid", "optional-fields-omitted.json");
    let error = parse_envelope_with(&text, &[&validator, &garde, &jsonschema]).unwrap_err();
    assert!(error
        .issues
        .iter()
        .any(|issue| issue.contains("provider[validator]")));
    assert!(error
        .issues
        .iter()
        .any(|issue| issue.contains("provider[garde]")));
    assert!(error
        .issues
        .iter()
        .any(|issue| issue.contains("provider[jsonschema]")));
}

#[test]
fn audit_reports_acceptance_drift() {
    let value: Value =
        serde_json::from_str(&fixture("invalid", "null-operation.json")).expect("fixture is JSON");
    let provider = validator_provider(|_| Ok(()));
    let audit = audit_provider(&value, &provider);
    assert!(audit.drift);
    assert!(!audit.canonical_accepted);
    assert!(audit.provider_accepted);
}

#[test]
fn provider_panics_are_normalized_during_parse_and_audit() {
    let provider = validator_provider(|_| -> Result<(), Vec<String>> { panic!("boom") });
    let text = fixture("valid", "optional-fields-omitted.json");
    let error = parse_envelope_with(&text, &[&provider]).unwrap_err();
    assert!(error
        .issues
        .iter()
        .any(|issue| issue.contains("provider[validator]: provider panicked")));

    let value: Value = serde_json::from_str(&text).expect("fixture is JSON");
    let audit = audit_provider(&value, &provider);
    assert!(!audit.provider_accepted);
    assert!(audit.drift);
    assert_eq!(audit.provider_issues, vec!["provider panicked"]);
}
