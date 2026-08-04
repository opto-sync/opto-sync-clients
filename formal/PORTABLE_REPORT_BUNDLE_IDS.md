# Portable immutable report bundle identifiers

A report bundle identifier is both a protocol identity and one filesystem path
component. The identity grammar is deliberately narrower than the set of names
accepted by any one host operating system so different identifiers cannot alias
on Windows or common case-insensitive filesystems.

## Canonical grammar

- 1 through 128 UTF-8 bytes;
- ASCII only;
- the first and last bytes are lower-case letters or decimal digits;
- interior bytes are lower-case letters, decimal digits, `-`, or `_`;
- no upper-case letters, dots, spaces, separators, controls, or Unicode; and
- no Windows device basename, including `con`, `prn`, `aux`, `nul`, `clock$`,
  `com1` through `com9`, or `lpt1` through `lpt9`.

Device-name rejection is case-insensitive and checks the basename before a dot,
even though upper-case and dots are independently invalid. This makes the
reasoning robust if producer-side normalization is later separated from strict
wire/path validation.

Examples:

```text
verify-001
check_7f20c8f6
sha256-1f1d4f61e6ab
```

Rejected examples include `Verify-001`, `verify.001`, `verify-`, `_verify`,
`con`, `CON`, `con.json`, `com1`, `lpt9`, `../escape`, and non-ASCII text.

## Producer policy

Callers must construct the canonical identifier before invoking the publisher.
The publisher does not silently lowercase, trim, reorder, or rewrite an incoming
identifier. A noncanonical identity is rejected before the publication root,
reservation, or staging directory is touched.

Future hash-derived identities should use lower-case hexadecimal or another
alphabet that is already a subset of this grammar.
