# Security policy

## Supported versions

Security fixes are made on `main`. Releases built from older commits should be
upgraded to the newest reviewed tag before a report is considered resolved.

## Reporting a vulnerability

Please use GitHub's private **Report a vulnerability** / Security Advisory flow
for this repository. Do not open a public issue containing an exploit, access
token, customer data, private URL, database contents, or a payload that can
trigger data loss.

Include:

- the affected client and version or commit;
- the smallest safe reproduction;
- whether the issue crosses tenant, client-ID, queue, or local-store boundaries;
- whether secrets or record contents can leave the process or device; and
- any known workaround that does not destroy queued mutations.

Reports involving IndexedDB/SQLite durability, mutation replay, tenant or
client-ID isolation, reconciliation divergence, dependency substitution, or
supply-chain integrity are treated as security-sensitive even when they do not
look like conventional memory-safety defects.

## Disclosure expectations

Maintainers will acknowledge a usable private report, reproduce it against the
supported branch, and coordinate a fix and disclosure. Please avoid publishing
technical details until a patched release or an agreed disclosure date exists.
