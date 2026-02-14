---
description: Build and deploy the website to production
---

# Deploy

Build and deploy the directive.run website.

## Step 1: Generate API Reference + Embeddings

The chatbot depends on generated API docs and embeddings. These must run before the site build.

```bash
pnpm --filter website build:api-docs
```

If `build:api-docs` fails, stop and report errors. Otherwise, check if `OPENAI_API_KEY` is set:

```bash
test -n "$OPENAI_API_KEY" && pnpm --filter website build:embeddings || echo "OPENAI_API_KEY not set – skipping embeddings (chatbot will use existing public/embeddings.json)"
```

**Note:** Do not log or echo environment variable values. If embeddings fail, report the error message only.

Report how many API entries were extracted and (if embeddings ran) how many chunks were generated.

## Step 2: Build Website

```bash
pnpm --filter website build
```

If the build fails, stop and report errors with file locations.

## Step 3: Build Report

Report:
- Build status (pass/fail)
- Any warnings from the build output
- Output directory size: `du -sh website/.next 2>/dev/null || du -sh website/out 2>/dev/null`

## Step 4: Deploy

Check if Vercel CLI is available:

```bash
which vercel 2>/dev/null
```

**If Vercel CLI is available:**

**Use AskUserQuestion:** Deploy to production?
- Yes, deploy to production (`vercel --prod`)
- Preview deploy only (`vercel`)
- No, just build

Run the selected deploy command from the `website/` directory.

**If Vercel CLI is not available:**

Report manual deploy instructions:

> Vercel CLI not found. To deploy:
> 1. Push to `main` branch (auto-deploys if Vercel is connected)
> 2. Or install Vercel CLI: `npm i -g vercel`
> 3. Then run `/deploy` again

## Step 5: Verify

If deployed, verify the site is reachable:

```bash
curl -s -o /dev/null -w "%{http_code}" https://directive.run
```

Report the HTTP status code. 200 = success.

## Step 6: Report

Show:
- Deploy status
- URL: https://directive.run
- Any warnings or errors from the process
