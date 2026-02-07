---
title: Prompt Injection
description: Protect against prompt injection attacks in AI applications.
---

Defend against prompt injection with input validation. {% .lead %}

---

## Detection

Detect injection attempts:

```typescript
import { injectionPlugin } from 'directive/security';

const system = createSystem({
  module: agentModule,
  plugins: [
    injectionPlugin({
      fields: ['userInput', 'chatMessage'],
      action: 'block',
    }),
  ],
});
```

---

## Detection Patterns

Common injection patterns detected:

- System prompt overrides
- Role-playing instructions
- Ignore previous instructions
- Jailbreak attempts
- Data exfiltration attempts

---

## Custom Rules

Add custom detection rules:

```typescript
injectionPlugin({
  rules: [
    {
      name: 'system-override',
      pattern: /ignore (all )?(previous |prior )?instructions/i,
      severity: 'high',
    },
    {
      name: 'role-play',
      pattern: /you are now|pretend to be|act as/i,
      severity: 'medium',
    },
  ],
})
```

---

## Constraint-Based Validation

Use constraints for validation:

```typescript
constraints: {
  validateInput: {
    priority: 1000,
    when: (facts) => facts.userInput && !facts.inputValidated,
    require: { type: "VALIDATE_INPUT" },
  },
},

resolvers: {
  validateInput: {
    requirement: "VALIDATE_INPUT",
    resolve: async (req, context) => {
      const result = await validateForInjection(context.facts.userInput);

      if (result.isInjection) {
        context.facts.inputBlocked = true;
        context.facts.blockReason = result.reason;
      } else {
        context.facts.inputValidated = true;
      }
    },
  },
}
```

---

## Response Handling

Handle blocked inputs:

```typescript
injectionPlugin({
  onBlocked: (input, reason) => {
    securityLog.write({
      event: 'injection_blocked',
      input: input.substring(0, 100),
      reason,
      timestamp: Date.now(),
    });
  },
})
```

---

## Next Steps

- See PII Detection for data privacy
- See Guardrails for AI safety
- See Audit Trail for logging
