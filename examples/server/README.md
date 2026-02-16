# Server Example

An Express API demonstrating Directive's server-side features.

## Features

- **Distributable Snapshots** &ndash; Export system state with TTL and in-memory caching
- **Signed Snapshots** &ndash; HMAC-SHA256 signing and tamper-proof verification
- **Audit Trail** &ndash; Hash-chained, tamper-evident logging with PII masking
- **GDPR/CCPA Compliance** &ndash; Data export, right to erasure, consent tracking

## Running

```bash
pnpm install
pnpm dev     # Watch mode (auto-restarts on changes)
pnpm start   # Production mode
```

The server starts on `http://localhost:3000`.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/snapshot/:userId` | Distributable snapshot with TTL, cached in-memory |
| `POST` | `/snapshot/:userId/verify` | Sign and verify snapshot HMAC signatures |
| `GET` | `/audit` | Query audit entries (filters: `eventType`, `since`, `actorId`, `limit`) |
| `GET` | `/audit/verify` | Verify hash chain integrity |
| `POST` | `/compliance/:subjectId/export` | GDPR Article 20 &ndash; data export with checksum |
| `POST` | `/compliance/:subjectId/delete` | GDPR Article 17 &ndash; right to erasure with deletion certificate |
| `GET` | `/health` | System status, audit stats, chain integrity |

## Quick Test

```bash
# Fetch a user snapshot
curl http://localhost:3000/snapshot/user-1

# Sign and verify
curl -X POST http://localhost:3000/snapshot/user-1/verify \
  -H "Content-Type: application/json" \
  -d '{"snapshot": {}}'

# Query audit trail
curl http://localhost:3000/audit

# Verify audit chain
curl http://localhost:3000/audit/verify

# GDPR data export
curl -X POST http://localhost:3000/compliance/user-1/export

# GDPR data deletion
curl -X POST http://localhost:3000/compliance/user-1/delete \
  -H "Content-Type: application/json" \
  -d '{"reason": "User requested account deletion"}'

# Health check
curl http://localhost:3000/health
```

## Key Patterns

### Per-Request Systems

Every request creates a fresh Directive system &ndash; no singletons, no shared mutable state:

```typescript
function createUserSystem(userId: string) {
  const system = createSystem({
    module: userProfile,
    plugins: [audit.createPlugin()],
  });

  system.start();
  system.events.loadUser({ userId });

  return system;
}
```

### Settle Before Respond

`system.settle()` blocks until all constraints evaluate and resolvers complete:

```typescript
await system.settle({ timeout: 5000 });
const snapshot = system.getDistributableSnapshot({ ttlSeconds: 3600 });
```

### Audit as Plugin

The audit trail plugs into the Directive lifecycle &ndash; every fact mutation, resolver execution, and error is automatically logged:

```typescript
const audit = createAuditTrail({ piiMasking: { enabled: true, types: ["email", "name"] } });
// Pass audit.createPlugin() to your system
```

## Available Users

The example includes three simulated users:

| ID | Name | Plan | Features |
|----|------|------|----------|
| `user-1` | Alice | pro | analytics, api-access, export |
| `user-2` | Bob | free | analytics |
| `user-3` | Charlie | enterprise | analytics, api-access, export, sso, audit-log |
