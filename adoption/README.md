# Opto Sync adoption manifests

An adopting client repository places `.opto-sync.json` at its root. The file is a machine-readable declaration of the local-first boundary; it is not evidence that every rollout phase is already implemented.

The manifest answers the questions that otherwise drift between mobile, desktop, web, server, and generated SDK teams:

- Which exact Opto Sync client source and package version were reviewed?
- Which languages and local stores are in scope?
- Which data domains are permitted to sync?
- Which transports and optimistic-write strategies are supported?
- How are arrays, timestamps, identities, and delete tombstones reconciled?
- Which background execution surfaces are expected?
- Is authenticated transport mandatory and is local data encrypted?
- How far has the integration progressed?

## Immutable provenance

`clientPackage.commit` is always a full lowercase 40-character commit SHA. Branches, tags, abbreviated SHAs, sibling paths, and placeholders are rejected. `clientPackage.version` is an exact semantic version, not a range.

A manifest may pin version `0.2.0` and a newer source commit while package publication work is in flight; the adopting repository must not advance beyond the `declared` phase until the referenced artifact is actually consumable by its build.

## Rollout phases

- `declared`: ownership, data boundary, stores, transport, and conflict policy are recorded.
- `local-queue`: durable optimistic writes, idempotency keys, retry state, and tombstones have behavioral tests.
- `transport`: push/pull, reconnect, checkpoint, auth-expiry, and duplicate delivery have behavioral tests.
- `background`: service worker/mobile/desktop background paths and foreground handoff have behavioral tests.
- `production`: upgrade, rollback, telemetry, corruption recovery, and end-to-end conflict fixtures are enforced in CI.

Advancing a phase requires code and tests in the adopting repository. Editing the manifest alone must never claim implementation.

## Validate

From this repository:

```bash
python3 scripts/check-adoption-manifest.py adoption/example.opto-sync.json
python3 -m unittest scripts/test_check_adoption_manifest.py
```

An adopting repository can vendor the dependency-free validator, invoke it from a pinned tooling checkout, or validate against `adoption/adoption.schema.json` with its existing JSON Schema toolchain.

## Security

The manifest contains no credentials. `authenticatedTransport` is required to be true and `secretsInManifest` is required to be false. The validator also rejects field names that look like tokens, passwords, private keys, or secrets.

Encryption at rest is explicit because some browser or development-only stores may rely on platform encryption while sensitive mobile/desktop products require application-layer encryption. This field describes the intended boundary and should be backed by tests before production rollout.
