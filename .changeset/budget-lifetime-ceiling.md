---
"@directive-run/ai": minor
---

**`withBudget` accepts `maxTotalCost`: a hard ceiling on a runner's lifetime spend.**

Every cap the guard already had gates a *prediction* — the pre-call estimate is compared against what is left and the call is refused before it runs. That is the right shape for a cap that is the only thing standing between a caller and a bill, and the wrong shape for one that is meant to sit *underneath* a caller's own stopping rule. A predictive cap fires in place of the caller's rule the moment its prediction is the more pessimistic of the two, and then two ceilings at the same number give two different accounts of the same run.

`maxTotalCost` gates the ledger instead. Nothing is refused while recorded spend is under it, however large the next call looks; once `getSpent("total")` reaches it, no further call is dispatched.

```typescript
const runner = withBudget(base, {
  pricing,
  // Whatever else stops this run, it does not get to spend past $5.
  maxTotalCost: 5,
});
```

That makes it composable with a caller that knows things the runner does not — the token cap of the call it is about to make, or that a closing document still has to be paid for. The caller's rule stops the run in the ordinary case; this catches the case where the caller's arithmetic was wrong, and bounds the overshoot to the single call that crossed the line. Nothing enforced after the fact against a provider that bills after the fact can do better without predicting, and `maxCostPerCall` and `budgets` are still there for callers who want the prediction.

Configuration is checked at construction: a ceiling with no rates to price lifetime spend against is refused rather than left silently inert, and one set against all-zero rates warns.

`BudgetExceededDetails["window"]` and `BudgetExceededError["window"]` gain `"total"`, exported as the new `BudgetWindowName` type. Additive to a union — a consumer with an exhaustive `switch` over the old three will need a fourth arm.
