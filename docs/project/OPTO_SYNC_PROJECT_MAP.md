# Opto Sync GitHub and Linear project map

## GitHub organization

- Organization: `opto-sync`
- Primary implementation repository: `opto-sync/opto-sync-clients`
- Formal-methods incubator: `tools/fmctl`
- Canonical publication-lease PR: #69
- Intended extraction repository: `ORESoftware/formal-methods.rs`

## Linear ownership

- Workspace team: Denman
- Portfolio project: `github.com/ORESoftware`
- Active issue: `DEN-1694`
- Parent: `DEN-1657`
- Related: `DEN-1631`, `DEN-1683`
- Linear document: `Opto Sync GitHub and Linear project map`

## Delivery contract

1. Branches, commits, pull requests, and Linear issues use the same issue identifier.
2. Each Linear implementation issue links its canonical pull request.
3. Temporary source-materialization workflows are removed before merge.
4. Pull requests merge only after exact-head CI and formal-method gates pass.
5. Organization-level ownership and architecture changes update both this repository documentation and the matching Linear document.

## Formal-methods extraction

The `tools/fmctl` incubator remains in this repository until the standalone repository exists and an extraction PR preserves history, CI, licenses, interfaces, and release provenance. The extraction must not weaken Opto Sync's pinned formal-method validation gates.
