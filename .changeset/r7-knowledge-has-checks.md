---
"@directive-run/knowledge": minor
---

Add `hasKnowledge(name)` and `hasExample(name)` so LLM-driven callers can disambiguate "this name isn't bundled" from "this file is intentionally empty".

`getKnowledge("typo")` and `getExample("typo")` continue to return `""` for back-compat — they previously returned `""` whether the name was missing OR the file was actually empty. Agent code writing the name from LLM output had no signal when it typo'd one; the prompt just degraded silently. Pair the new `has*` check with the existing getter:

```ts
import { getKnowledge, hasKnowledge, getAllKnowledge } from "@directive-run/knowledge";

if (!hasKnowledge(userTyped)) {
  console.error(`unknown knowledge file: ${userTyped}`);
  console.error(`available: ${[...getAllKnowledge().keys()].join(", ")}`);
  return;
}
const md = getKnowledge(userTyped);
```

Also adds JSDoc + `@example` blocks to the four public loaders (`getKnowledge`, `getAllKnowledge`, `getExample`, `getAllExamples`) explaining the miss-vs-empty disambiguator.
