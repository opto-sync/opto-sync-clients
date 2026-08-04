import gleam/dynamic/decode
import gleam/json
import gleam/string
import gleeunit/should
import opto_sync_ingest.{ValidationError}

fn valid_text() -> String {
  "{\"formatVersion\":1,\"records\":[{\"table\":\"notes\",\"recordId\":\"n1\",\"payload\":{\"updatedAt\":\"1\"}}]}"
}

pub fn provider_is_a_veto_gate_test() {
  let provider =
    opto_sync_ingest.json_schema_provider(fn(_) { Error(["blocked"]) })
  let assert Error(ValidationError(issues)) =
    opto_sync_ingest.parse_envelope_with(valid_text(), [provider])
  should.be_true(string.contains(
    string.join(issues, "; "),
    "provider[json_schema]",
  ))
}

pub fn provider_audit_detects_drift_test() {
  let assert Ok(data) =
    json.parse("{\"formatVersion\":1,\"records\":[]}", decode.dynamic)
  let provider = opto_sync_ingest.regexp_provider(fn(_) { Ok(Nil) })
  let audit = opto_sync_ingest.audit_provider(data, provider)
  should.equal(audit.canonical_accepted, False)
  should.equal(audit.provider_accepted, True)
  should.equal(audit.drift, True)
}

pub fn provider_cannot_reject_silently_test() {
  let provider =
    opto_sync_ingest.validation_provider("silent", fn(_) { Error([]) })
  let assert Error(ValidationError(issues)) =
    opto_sync_ingest.parse_envelope_with(valid_text(), [provider])
  should.be_true(string.contains(
    string.join(issues, "; "),
    "validation rejected",
  ))
}

pub fn rejects_unsafe_integer_timestamp_test() {
  let text =
    "{\"formatVersion\":1,\"records\":[{\"table\":\"notes\",\"recordId\":\"n1\",\"payload\":{\"updatedAt\":9007199254740992}}]}"
  let assert Error(ValidationError(_)) = opto_sync_ingest.parse_envelope(text)
}
