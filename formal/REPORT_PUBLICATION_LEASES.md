# Report publication leases

Active report publication is protected by one exclusive OS lease per
bundle identifier. Cleanup holds a short root guard, probes leases
nonblocking, and never removes reservation or staging state while a
publisher owns that lease. Process death releases the kernel lock, so
abandoned state becomes recoverable without trusting process IDs.

Lock paths are confinement boundaries. Unix opens use `O_NOFOLLOW`,
require one regular-file link, and set close-on-exec. Windows opens use
`FILE_FLAG_OPEN_REPARSE_POINT` and require a regular file. Symlink,
reparse-point, and Unix hard-link aliases fail closed before publication
or cleanup trusts the lock.

Immutable completed bundles and their reservations remain unchanged.
Legacy staging names retain age-only cleanup; new parseable staging
names are correlated with the bundle lease before removal.
