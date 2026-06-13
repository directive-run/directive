# Compliance Audit

End-to-end demo of Directive's **audit ledger** + **`predicateFromIntent`**: every constraint clause emits a ledger entry, an auditor reads the ledger, and the LLM proposes a data-form replacement that satisfies the same intent without leaking PII through the constraint surface.

## Features

- A `checkout` module with a three-clause data-form constraint
- The audit ledger captures every `when` evaluation + its outcome
- `predicateFromIntent` emits a candidate predicate from a stated rule
- A side-by-side compare panel between the live constraint and the LLM-proposed replacement
- PII-tagged facts (`tier`) appear in the audit ledger with their schema tags so downstream redaction policies have what they need

## Run

```bash
pnpm install
pnpm dev
```

Open the dev URL. Click "Try new predicate" to swap the constraint at runtime; the ledger panel shows the same outcomes — proving the intent matched.

## What it shows

- How `tags: ["pii"]` on a fact propagates through the audit ledger
- How `predicateFromIntent` round-trips an English rule into a typed predicate
- How a swappable constraint preserves contract while changing implementation — the substrate for compliance-driven rewrites
