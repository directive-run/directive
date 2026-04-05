---
"@directive-run/core": patch
---

Performance optimizations: +36-95% faster derivations, +8-17% faster reconcile

- Gate `validateValue` behind `__DEV__` — skip schema validation in production builds (+7-11% writes)
- Eliminate TrackingContext object allocation — bare Set<string> dep stack (+50-112% derivation compute)
- Skip plugin emit callbacks when no plugins registered (+14-16% reconcile)
- Remove unused `unchanged` array from RequirementSet.diff() (+8-17% reconcile)
- Short-circuit disabled constraint filter when disabled.size === 0
- Remove TrackingContext interface (pre-launch cleanup — replaced with getCurrentDeps)
