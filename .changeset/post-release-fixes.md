---
"@directive-run/query": patch
"@directive-run/react": patch
---

Post-release bug fixes:

- Fix useSelector dep-retracking when selector function changes (React adapter)
- Fix GraphQL headers function type (removed misleading facts parameter)
- Fix expireAfter GC re-run bug (polling now restarts after re-activation cycles)
- Cap mutateAsync pendingPromises Map at 100 with FIFO eviction
- Harden replaceEqualDeep with Object.create(null) for prototype pollution defense
- Document type inference tradeoff in createQuerySystem JSDoc
- Add @directive-run/react install note to README
