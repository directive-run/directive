---
"@directive-run/scaffold": patch
---

The scaffolded module now names an effect's second parameter `prevFacts`, matching the runtime and every other generated surface.

```ts
effects: {
  logChange: {
    deps: ["status"],
    run: (facts, prevFacts) => {
      if (prevFacts && prevFacts.status !== facts.status) {
        console.log(`Status: ${prevFacts.status} → ${facts.status}`);
      }
    },
  },
},
```

Only the generated text changes. Anything already scaffolded keeps working — parameter names are positional, so a module written against the old output is unaffected.
