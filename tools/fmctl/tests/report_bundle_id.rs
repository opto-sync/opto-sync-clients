use fmctl::result::publish::{validate_report_bundle_id, MAX_REPORT_BUNDLE_ID_BYTES};

#[test]
fn accepts_canonical_portable_identifiers() {
    for value in [
        "a",
        "0",
        "verify-001",
        "check_7f20c8f6",
        "sha256-1f1d4f61e6ab",
    ] {
        validate_report_bundle_id(value)
            .unwrap_or_else(|error| panic!("canonical id {value:?} was rejected: {error}"));
    }
    let maximum = format!("a{}z", "b".repeat(MAX_REPORT_BUNDLE_ID_BYTES - 2));
    assert_eq!(maximum.len(), MAX_REPORT_BUNDLE_ID_BYTES);
    validate_report_bundle_id(&maximum).expect("maximum-length canonical id");
}

#[test]
fn rejects_length_case_punctuation_separator_control_and_unicode_aliases() {
    let too_long = format!("a{}z", "b".repeat(MAX_REPORT_BUNDLE_ID_BYTES - 1));
    let invalid = [
        "",
        ".",
        "..",
        "Verify-001",
        "VERIFY-001",
        "verify.001",
        "verify ",
        " verify",
        "verify-",
        "verify_",
        "-verify",
        "_verify",
        "slash/value",
        "back\\value",
        "control\n",
        "café",
        &too_long,
    ];
    for value in invalid {
        assert!(
            validate_report_bundle_id(value).is_err(),
            "nonportable id was accepted: {value:?}"
        );
    }
}

#[test]
fn rejects_every_windows_device_basename_and_extension_form() {
    let mut reserved = vec![
        "con".to_owned(),
        "prn".to_owned(),
        "aux".to_owned(),
        "nul".to_owned(),
        "clock$".to_owned(),
        "CON".to_owned(),
        "con.json".to_owned(),
    ];
    for prefix in ["com", "lpt"] {
        for digit in 1..=9 {
            reserved.push(format!("{prefix}{digit}"));
            reserved.push(format!("{prefix}{digit}.json"));
        }
    }
    for value in reserved {
        let error = validate_report_bundle_id(&value).expect_err("reserved device name must fail");
        assert!(
            error
                .to_string()
                .contains("reserved Windows device basename"),
            "unexpected error for {value:?}: {error}"
        );
    }
}

#[test]
fn nearby_nondevice_names_remain_valid() {
    for value in [
        "console",
        "con-1",
        "prn1",
        "auxiliary",
        "null",
        "com0",
        "com10",
        "lpt0",
        "lpt10",
        "clock",
    ] {
        validate_report_bundle_id(value)
            .unwrap_or_else(|error| panic!("nearby portable id {value:?} was rejected: {error}"));
    }
}
