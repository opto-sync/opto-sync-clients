# Go streaming capability contract

Use `CanonicalizeCapabilitySetV1` when adapting an unordered application-level
capability collection into a hello response. The returned slice is in the only
valid v1 wire order.

`CapabilityRegistryV1` and `RequiredCapabilitiesV1` return defensive copies and
are checked against the shared machine-readable registry in
`formal/protocol-fixtures/stream/capabilities.v1.json`.

Inbound hello arrays are stricter: `validateCapabilities` rejects duplicates,
unknown values, `hello`, missing mandatory operations, and out-of-order arrays.
It never silently repairs received protocol bytes.
