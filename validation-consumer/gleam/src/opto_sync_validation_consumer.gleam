import gleam/dynamic.{type Dynamic}
import opto_sync_validation

pub fn validate_request_meta(value: Dynamic) { opto_sync_validation.decode_request_meta(value) }
