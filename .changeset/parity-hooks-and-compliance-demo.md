---
"@directive-run/vue": minor
"@directive-run/svelte": minor
"@directive-run/solid": minor
"@directive-run/lit": minor
---

feat: useAuditLedger parity across Vue / Svelte / Solid / Lit

Matches the React hook shipped in v1.11.0, idiomatic to each framework:

- **Vue:** `useAuditLedger(ledger, filter)` returns a `ShallowRef<readonly AuditEntry[]>`
- **Svelte:** `createAuditLedgerStore(ledger, filter)` returns a `Readable<readonly AuditEntry[]>`
- **Solid:** `useAuditLedger(ledger, filter)` returns an `Accessor<readonly AuditEntry[]>`
- **Lit:** `AuditLedgerController` — a `ReactiveController` exposing `.value`

All four poll the ledger (default 250 ms, override with `pollMs`) and surface the latest entries matching the filter. The compliance-audit example now has a one-line install path on every supported framework.

```ts
// Vue
const entries = useAuditLedger(ledger, { kind: "constraint.evaluate", limit: 20 });

// Svelte
const entries = createAuditLedgerStore(ledger, { kind: "constraint.evaluate", limit: 20 });

// Solid
const entries = useAuditLedger(ledger, { kind: "constraint.evaluate", limit: 20 });

// Lit
class AuditLog extends LitElement {
  private ctrl = new AuditLedgerController(this, ledger, { kind: "constraint.evaluate", limit: 20 });
}
```
