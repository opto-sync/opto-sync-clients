# Invalid streaming transcripts

Each file must be rejected by every `fm.adapter.stream.v1` SDK. Capability
fixtures fail during successful-hello validation:

- `duplicate-capability.jsonl`: duplicate semantic set member;
- `missing-required-capability.jsonl`: mandatory `apply` omitted;
- `hello-capability.jsonl`: handshake operation advertised as a capability;
- `unknown-capability.jsonl`: operation absent from the v1 registry; and
- `out-of-order-capability.jsonl`: valid members encoded outside registry order.

A rejected response must leave the pending request and pre-ready session state
unchanged so a corrected response with the same correlation identity can be
accepted.
