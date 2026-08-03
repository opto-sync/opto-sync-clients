# Polyglot streaming capability conformance

This directory contains thin language-native implementations of the
`fm.adapter.stream.v1` hello capability registry.

The shared source of truth remains:

```text
formal/protocol-fixtures/stream/capabilities.v1.json
```

The TypeScript, Dart, and Gleam modules intentionally live under
`formal/sdk/<language>` rather than the product-facing Opto Sync client packages.
The batch replayers and product queue clients have different responsibilities
and must not become accidental owners of a generic formal-methods wire contract.

## What these modules prove

Each implementation provides:

- the exact ordered V1 registry;
- the exact required capability set;
- producer-side canonicalization of unordered semantic sets;
- strict received-wire validation with no silent reordering;
- rejection of duplicates, missing required capabilities, `hello`, unknown
  values, and out-of-order arrays;
- enumeration and testing of all 16 valid optional-capability combinations; and
- compact JSON capability-array encodings for cross-language byte comparison.

The `Formal polyglot capability SDKs` GitHub Actions workflow emits one normalized
report per language and runs `formal/sdk/check-polyglot-capabilities.mjs`. The
comparator checks protocol identity, registry/required bytes, all 16 unique
array encodings, canonical compact JSON, and exact agreement with the shared
machine-readable registry.

## What these modules do not yet prove

Capability-only conformance is not a complete streaming process/session SDK.
These modules do not yet own:

- JSON-lines framing and bounded reads/writes;
- request/response correlation;
- generation and phase transitions;
- pending-state commit/rollback;
- process lifecycle, close, EOF, crash, hang, or stdout-contamination handling;
- complete hello object encoding; or
- operation dispatch and unsupported outcomes.

Rust `fmctl` and the Go SDK already enforce those broader boundaries. Future
TypeScript, Dart, and Gleam session implementations must compose this capability
layer with the shared schema and transcript corpus rather than reimplementing a
second registry.

## Local conformance commands

From a recursive repository checkout:

```bash
# TypeScript: use the repository-pinned compiler.
cd clients/ts
npm ci --ignore-scripts
cd ../..
clients/ts/node_modules/.bin/tsc -p formal/sdk/typescript/tsconfig.json
node --test formal/sdk/typescript/test/capabilities.test.mjs

# Dart.
cd formal/sdk/dart
dart pub get
dart format --output=none --set-exit-if-changed lib tool
dart analyze
dart run tool/check_capabilities.dart

# Gleam.
cd ../gleam
gleam deps download
gleam format --check src test
gleam test
```

The CI workflow additionally captures each language report and runs the
cross-language comparator.

## Rollout state

The authoritative registry/schema/Rust/Go implementation merged through PR #46.
This polyglot layer is therefore based directly on `main`; it must preserve the
same registry order and fixtures without regenerating language-specific policy.
Every merge decision must use workflow evidence from the current retargeted head,
not the earlier stacked-head runs.
