---
"@directive-run/devtools": patch
---

Add query devtools Timeline, Explain, and data explorer panels

- Timeline panel with swim-lane fetch bars, constraint trigger dots, and duration labels
- Explain panel with causal chain visualization (why did this query fetch?)
- Interactive JsonTree data explorer replacing flat JSON preview
- Refetch/Invalidate/Reset action buttons per query
- Auto-detect query kind (Query/Mutation/Subscription/Infinite)
- Summary stats bar, stale badges, search filtering
- Full ARIA keyboard navigation on tabs
- 74 unit tests covering all exported helpers
- StateView tabs brought to ARIA parity
