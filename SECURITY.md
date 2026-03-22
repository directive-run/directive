# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Directive, please report it responsibly.

**Email:** security@directive.run

**Please include:**
- Description of the vulnerability
- Steps to reproduce
- Affected packages and versions
- Potential impact assessment

**Response timeline:**
- Acknowledgment within 48 hours
- Assessment and severity classification within 5 business days
- Fix timeline communicated based on severity

## Scope

The following are in scope for security reports:

- Prototype pollution via proxy handlers or user-supplied keys
- Memory exhaustion / denial of service via unbounded data structures
- HMAC signature bypass in `signSnapshot` / `verifySnapshotSignature`
- Information disclosure via proxy traps or error messages
- Injection attacks via module definitions, schema keys, or event names
- Supply chain issues in published `@directive-run/*` packages

## Out of Scope

- Vulnerabilities in development dependencies (not shipped to consumers)
- Issues requiring physical access to the machine
- Social engineering attacks
- Denial of service via intended API usage (e.g., creating millions of facts)

## Safe Harbor

We consider security research conducted in good faith to be authorized. We will not pursue legal action against researchers who:

- Make a good faith effort to avoid privacy violations, data destruction, and service disruption
- Report vulnerabilities promptly and provide sufficient detail to reproduce them
- Do not exploit vulnerabilities beyond what is necessary to demonstrate them

## Security Posture

Directive takes security seriously:

- **Zero runtime dependencies** in the core package — nothing to audit beyond our code
- **Prototype pollution defense** on all 11+ proxy objects via shared `BLOCKED_PROPS`
- **`Object.create(null)`** for all merged definition maps (prevents prototype chain traversal)
- **Key validation** runs unconditionally (not gated behind development mode)
- **FIFO eviction caps** on all internal caches to prevent memory exhaustion
- **HMAC-SHA256 snapshot signing** for tamper detection on serialized state
- **`isPrototypeSafe()` validation** at all deserialization boundaries

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.8.x | Yes |
| < 0.8 | No |
