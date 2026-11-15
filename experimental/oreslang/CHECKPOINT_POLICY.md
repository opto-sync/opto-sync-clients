# AttoLang scoped checkpoint policy candidate

This is a **pure AttoLang guest-source candidate**, not a shipping SDK or a
compiled/executed AttoLang guest. The sibling Node test is a bounded independent
host model and text-level API check, not compiler conformance.

The three `checkpoint_policy` guards make cursor handling fail closed:
- Resume only the exact locally committed checkpoint in the same generation.
- Apply an authenticated scoped change only when its predecessor equals the
  current checkpoint; filtered projections may skip global revision numbers.
- On generation rotation, discard the old cursor and begin at zero only after
  a privileged adapter has committed a fresh scoped snapshot.

`scope_verified`, `snapshot_committed` and `authoritative` are assertions
from a **trusted host adapter**. User guest code must never be allowed to invent
these values. This code does not implement server authentication, SQLite FFI,
actor scheduling, or replay of production state. The canonical wire and
Electric shape-cursor protocols remain authoritative in their own repositories.

To execute the host-only tests (Node 20+):

```sh
node --test experimental/oreslang/tests/checkpoint-policy.host.test.mjs
```

Guest compiler execution, six-backend parity, and remote generation fencing:
**NOT EXECUTED / NOT CERTIFIED**.
