---
description: Build and deploy the website to production
---

# Deploy

Build and deploy the directive.run website.

## Step 1: Build Website

The `build` script chains the full pipeline: API docs extraction → embedding generation → Next.js build.

If `OPENAI_API_KEY` is not set, embeddings are skipped automatically (the chatbot won't work, but the site still builds).

```bash
pnpm --filter website build
```

If the build fails, stop and report errors with file locations.

## Step 2: Build Report

Report:
- Build status (pass/fail)
- Any warnings from the build output
- Output directory size: `du -sh website/.next 2>/dev/null || du -sh website/out 2>/dev/null`

## Step 3: Deploy

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

## Step 4: Verify

If deployed, verify the site is reachable:

```bash
curl -s -o /dev/null -w "%{http_code}" https://directive.run
```

Report the HTTP status code. 200 = success.

## Step 5: Report

Show:
- Deploy status
- URL: https://directive.run
- Any warnings or errors from the process
