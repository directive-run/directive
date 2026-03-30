# Counter (Svelte)

The counter example using `@directive-run/svelte` -- `useFact`, `useDerived`, and `useEvents` as Svelte stores.

## Features

- `useFact` returns a Svelte-compatible store for reactive `$count`
- `useDerived` for the doubled derivation
- `useEvents` for increment/decrement/reset actions
- Same constraint-driven clamping as the vanilla counter

## Run

```bash
pnpm install
pnpm dev
```
