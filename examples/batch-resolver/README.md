# Batch Resolver

A batch data loader that groups individual user-fetch requests into a single batched resolution.

## Features

- Batch window groups parallel requests into one resolver call
- Per-item loading states and error handling
- Configurable failure simulation per user
- Event timeline showing batch grouping behavior

## Run

```bash
pnpm install
pnpm dev
```
