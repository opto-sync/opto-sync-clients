import gleam/dynamic
import gleeunit
import gleeunit/should
import opto_sync_validation_consumer

pub fn main() { gleeunit.main() }

pub fn validates_before_transport_test() {
  dynamic.properties([
    #(dynamic.string("requestId"), dynamic.string("req-1")),
    #(dynamic.string("traceId"), dynamic.string("trace-1")),
  ])
  |> opto_sync_validation_consumer.validate_request_meta
  |> should.be_ok
}
