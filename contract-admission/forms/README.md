# Durable form peer authorities

`main.tsp` and `authored.schema.json` are independently authored, equal contract authorities for the stable identity/header portion of `opto-sync.form.v1` envelopes.

They deliberately do **not** make TypeSpec the source of the authored JSON Schema or vice versa. CI runs `ORESoftware/typespec-json-schema-validator` (TJSV) at an immutable revision, emits a disposable JSON Schema B from TypeSpec, compares Schema B to authored Schema A, verifies the exact expected declaration set in the retained contract IR, and fails closed on divergence.

The executable TypeScript and standalone JavaScript form connectors remain a separate runtime behavior boundary. Their tests prove queue-before-transport, privacy filtering, retry/acknowledgement behavior, and package/standalone parity. TJSV proves the peer schema authorities agree; it does not replace those runtime tests.

The first peer contract intentionally covers only fields that are invariant across native, HTMX, and manual form envelopes. Payload/field extension structures stay outside this initial declaration until their cross-runtime representation is deliberately standardized rather than inferred from one implementation.
