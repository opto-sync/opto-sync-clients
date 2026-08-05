# Envelope validation contract

`opto-sync-envelope.schema.json` and `fixtures/` are the executable cross-runtime contract. A validator is supported only when its adapter is exercised against every valid and invalid fixture.

## Hardened invariants

- Optional properties are optional, not nullable. Explicit `null` is rejected for `source`, `operation`, `baseRevision`, `createdAt`, and `syncedAt`.
- `maxLength` and `minLength` are measured in Unicode code points. TypeScript uses code-point iteration, Dart uses `String.runes`, Rust uses `str::chars`, Gleam uses `string.to_utf_codepoints`, Go uses `utf8.RuneCountInString`, and Java uses `String.codePointCount`.
- Numeric timestamps are non-negative integers no larger than `9_007_199_254_740_991`. Larger epoch values use the already-supported digit-string form, avoiding precision loss in JavaScript and Dart web.
- JSON decoding failures are normalized into the runtime's ingest-validation error instead of leaking parser-specific exceptions.
- Validation accumulates independent issues across records and never queues a mutation until the entire envelope has passed.

## Provider matrix

| Runtime | Canonical validator | Additional supported adapters |
| --- | --- | --- |
| TypeScript | Zod | Standard Schema v1 (Valibot, ArkType, Yup, Joi, and other implementers); Ajv-compatible compiled JSON Schema functions |
| Rust | Serde/`serde_json` | `validator`, `garde`, and `jsonschema` through the typed provider closure adapter |
| Dart | Built-in decoded-JSON validator | `json_schema2`; `validify` or Formz through named callback providers |
| Gleam | `gleam_json` + `gleam/dynamic/decode` | JSON Schema/decoder callbacks; `gleam_regexp` or domain validators through named providers |
| Go | `encoding/json` with `UseNumber` | `go-playground/validator`; JSON Schema libraries such as `santhosh-tekuri/jsonschema` through provider callbacks |
| Java | Built-in strict RFC-8259 decoder | Jackson or Gson decoder adapters; Jakarta/Hibernate Validator and NetworkNT/Everit JSON Schema through provider callbacks |

Additional providers are veto gates: the canonical validator still runs and remains responsible for returning the normalized `IngestEnvelope`. This prevents a third-party library's coercion or defaulting behavior from silently changing sync semantics.

## Adding a provider

1. Adapt the library to the runtime's `ValidationProvider` interface.
2. Run the provider audit against all fixtures and fail on acceptance drift.
3. Preserve property paths in normalized issues.
4. Do not coerce timestamps, default explicit `null`, strip unknown record keys, or truncate strings.
5. Add at least one regression fixture for every newly discovered mismatch.
