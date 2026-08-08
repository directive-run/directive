---
"@directive-run/ai": patch
---

**The guardrails whose options are all optional can now be called with no options.** `createPIIGuardrail()`, `createRateLimitGuardrail()`, `createToolGuardrail()` and `createLengthGuardrail()` each took an options object in which every field was optional — and then required you to pass it anyway.

The natural call threw, and it threw from inside the factory while destructuring, so the message named a field you had never heard of rather than the argument you had left out:

```typescript
createPIIGuardrail();
// TypeError: Cannot read properties of undefined (reading 'patterns')
```

All four now default to `{}`. `createPIIGuardrail()` gives you the built-in patterns, which is what the signature always implied. Passing options explicitly behaves exactly as before.

Guardrails with a genuinely required field are unchanged — `createModerationGuardrail` still needs its `checkFn`, and `createContentFilterGuardrail` still needs `blockedPatterns`.
