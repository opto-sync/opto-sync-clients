# Electric / Phoenix.Sync read adapter (experimental)

`bridgeElectricShape` in `src/electric-shape.ts` consumes an application-supplied
`@electric-sql/client` `ShapeStream` (or compatible Phoenix.Sync router stream)
using a structural TypeScript interface, without hard-coding SDK versions.

The application must authenticate and scope the shape endpoint server-side.
Persist a **separate Electric cursor** `{version:1, scopeKey, shapeHandle, offset}`.
`scopeKey` must identify the tenant AND immutable shape definition, contain
no credentials, and be checked before constructing/restoring a stream.
Construct `ShapeStream` with the persisted `offset` and `handle` when present,
then pass the same cursor to this bridge. When there is no cursor, let
ShapeStream start a fresh snapshot and pass `restoredCursor:null`.

The `transact` callback is mandatory and must atomically:
- reset ONLY the authoritative shape subset on `reset:true`;
- apply all opaque-key changes (including deletes);
- persist `cursor` when present or clear it when null;
- preserve the Opto Sync durable mutation queue and push acknowledgement ledger.

Do not expose a partial snapshot as authoritative: `complete:false` means
the initial or restarted snapshot has not reached an `up-to-date` control.
For UI consumption, use the existing Opto Sync `localView` projection to
replay pending edits over the materialized authoritative rows.

Electric shape offsets are NOT Opto Sync protocol checkpoints, revisions,
or push acknowledgements. Subset move events and snapshot/subset-end controls
currently **fail closed** until a dedicated subset-aware adapter exists.
Delete keys stay opaque. An application must not assume a JSON-encoded key
contains its record's primary key.

Run `(cd clients/reactive-ts && npm test)`. Tests here use an in-memory
ShapeStream double, not a live Electric/Phoenix/Postgres instance.
