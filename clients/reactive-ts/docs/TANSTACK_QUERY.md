# Opto Sync + TanStack Query (structural adapter)

`bindOptoToTanStackQuery` subscribes to an already-rebased
`createReactiveRecord$` stream and sets a tenant/user partitioned
TanStack Query cache key via `QueryClient.setQueryData`.

The adapter has no runtime dependency on TanStack Query, so applications pass
their real QueryClient instance as the `queryClient` port. Query keys include
the stable Opto Sync `storagePartitionKey(identity)`, not bearer tokens or
refreshable session identifiers. On sign-out, applications must unsubscribe,
revoke their sync transports, and clear session-scoped query caches according to
the host application's security policy.

Use the Opto Sync `localView` projection as the source, not raw Electric
shape rows. The adapter never calls `invalidateQueries`, changes push
checkpoints or acknowledges a mutation. The application must still run the
authenticated Opto Sync push/pull cycle.

Tests: `node --experimental-strip-types --test test/tanstack-query.test.ts`.
These are structural QueryClient contract tests with RxJS, not yet a real
TanStack package/React or Phoenix LiveView end-to-end test.
