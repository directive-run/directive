# @directive-run/query

## 0.1.2

### Patch Changes

- [`97a780c`](https://github.com/directive-run/directive/commit/97a780c1d6bdf7b647e0118443dbedd6bbf6e6b7) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Post-release bug fixes:

  - Fix useSelector dep-retracking when selector function changes (React adapter)
  - Fix GraphQL headers function type (removed misleading facts parameter)
  - Fix expireAfter GC re-run bug (polling now restarts after re-activation cycles)
  - Cap mutateAsync pendingPromises Map at 100 with FIFO eviction
  - Harden replaceEqualDeep with Object.create(null) for prototype pollution defense
  - Document type inference tradeoff in createQuerySystem JSDoc
  - Add @directive-run/react install note to README

## 0.1.1

### Patch Changes

- [`0e51375`](https://github.com/directive-run/directive/commit/0e51375f17cb6b271b5af58b0c49f72b6ea945a5) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add @directive-run/query – declarative data fetching with causal cache invalidation.

  New package: createQuery, createMutation, createSubscription, createInfiniteQuery, createBaseQuery, createGraphQLQuery, createGraphQLClient, createQuerySystem, createQueryModule, withQueries, explainQuery. 191 tests across 15 test files.

  Framework adapters: useQuerySystem hook added to React, Vue, Svelte, Solid. QuerySystemController added to Lit. Factory pattern keeps @directive-run/query as zero-coupling optional dep.
