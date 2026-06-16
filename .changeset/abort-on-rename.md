---
"@directive-run/core": minor
---

Rename constraint-binding API from `owns:` to `abortOn:`.

The constraint-binding field — the per-fact compare-and-swap that drops a
resolver's writes when listed facts mutate mid-flight — was named `owns:`.
Reading `owns: ['kyc.status']` suggested the resolver asserts ownership of
`kyc.status`. The runtime enforces the opposite: the resolver **yields**
when `kyc.status` changes during dispatch.

`abortOn:` reads correctly: "this resolver aborts on changes to these
facts." Same semantics, clearer name, same audit-event payload (the
`resolver.write.rejected { reason: "clobbered" }` event is unchanged — no
Grafana / Splunk query updates needed).

**Before:**

```ts
constraints: {
  finalizeKyc: {
    when: (f) => f.kyc.status === 'pending',
    require: { type: 'FINALIZE_KYC' },
    owns: ['kyc.status'],
  },
},
```

**After:**

```ts
constraints: {
  finalizeKyc: {
    when: (f) => f.kyc.status === 'pending',
    require: { type: 'FINALIZE_KYC' },
    abortOn: ['kyc.status'],
  },
},
```

**Also renamed for consistency:**

- `doctor.checkOwns()` → `doctor.checkAbortOn()`
- `CheckOwnsResult` / `CheckOwnsFinding` types → `CheckAbortOnResult` /
  `CheckAbortOnFinding`
- `DoctorConstraintOwnsConflict` interface → `DoctorConstraintAbortOnConflict`
- The `source: "owns"` discriminant on doctor findings → `source: "abortOn"`
- `system.inspect().constraints[].owns` → `system.inspect().constraints[].abortOn`

**Migration:** mechanical replacement. The semantics, audit event, runtime
gate, and snapshot model are all unchanged. Scope the rename to constraint
config blocks — `owns` as an English word in unrelated prose is fine.
