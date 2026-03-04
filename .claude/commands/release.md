---
description: Full release orchestration – version, build, test, publish to npm
---

# Release

The release process is automated via GitHub Actions (`changesets/action`). You just need to create a changeset and push – CI handles the rest.

## How It Works

1. **You create a changeset** (`/changeset`) and push it to `main`
2. **GitHub Action detects the changeset** and opens a "Version Packages" PR
   - Bumps `package.json` versions
   - Generates `CHANGELOG.md` entries
   - Consumes the `.changeset/*.md` file
3. **You merge the PR** when ready
4. **GitHub Action publishes to npm** automatically on merge
   - Builds all packages
   - Runs typechecks and tests
   - Publishes to npm with provenance signing
   - Creates git tags (e.g., `@directive-run/core@0.2.0`)
   - Creates GitHub Releases for each published package

Website auto-deploys via Vercel on any push to `main`.

## Step 1: Check for Pending Changesets

```bash
ls .changeset/*.md 2>/dev/null | grep -v config.json
```

If there are **no pending changeset files**, tell the user:

> No pending changesets. Run `/changeset` first to create one.

## Step 2: Review Changeset

Read the changeset file and show:
- Which packages will be bumped
- Bump type (patch/minor/major)
- The changelog summary

## Step 3: Push to Main

If the changeset isn't committed yet, commit it:

```bash
git add .changeset/
git commit -m "[chore] Add changeset for next release"
git push
```

Then tell the user:

> Changeset pushed. The GitHub Action will create a "Version Packages" PR shortly.
> Check: https://github.com/directive-run/directive/pulls
>
> When you're ready to release, merge that PR. The action will publish to npm automatically.

## Local Release (Fallback)

Only use this if GitHub Actions isn't working or you need to publish manually.

```bash
pnpm changeset version        # Bump versions + generate changelogs
pnpm -r build                 # Build all packages
pnpm test -- --run             # Run tests
npm whoami                     # Verify npm auth
pnpm changeset publish         # Publish to npm + create git tags
git push --follow-tags         # Push commits + tags
```

**Note:** Local publishes do not create GitHub Releases. If needed, create them manually at https://github.com/directive-run/directive/releases/new using the git tags created by `changeset publish`.

## CI Pipeline Details

**File:** `.github/workflows/release.yml`

Triggers on push to `main` (only for changes in `packages/`, `.changeset/`, `release.yml`, or `pnpm-lock.yaml`). Steps:
1. `pnpm install --frozen-lockfile`
2. `pnpm -r --filter './packages/*' build`
3. `pnpm -r --filter './packages/*' typecheck`
4. `pnpm test -- --run`
5. `changesets/action` &ndash; creates PR or publishes

**Key settings:**
- `createGithubReleases: true` &ndash; creates a GitHub Release for each published package
- `permissions: id-token: write` &ndash; enables npm provenance signing
- `publish: pnpm changeset publish` &ndash; creates git tags + skips already-published versions

**Required secrets:** `NPM_TOKEN`, `GITHUB_TOKEN`
