# Ship Recovery — first-publish failures for new `@directive-run/*` packages

The 2026-05-01 release (PR #24 merge) successfully published `@directive-run/{core,react,vue,svelte,solid,lit,ai,cli,knowledge,claude-plugin}@1.3.0` but **silently failed to upload** the three new scoped packages:

- `@directive-run/mutator@0.2.0`
- `@directive-run/optimistic@0.1.0`
- `@directive-run/timeline@0.2.0`

`pnpm changeset publish` exit-code-0'd; the `🦋 success packages published successfully:` line listed all twelve packages. Git tags were pushed. **But the npm registry returns 404 for the three new ones.** Diagnosis: the GitHub Actions `NPM_TOKEN` has permission to *update* existing `@directive-run/*` packages (created when the scope was first set up) but not to *create* new ones under that scope.

## Recovery procedure

You need an authenticated npm session that can create packages under `@directive-run`. Two viable paths:

### Path A — manual first publish from your local machine (recommended, ~3 min)

```sh
cd /Users/jasonwcomes/Desktop/Sizls/projects/directive

# 1. Authenticate with a personal token that has full @directive-run/* publish.
npm login
# Or set the auth token directly:
# echo "//registry.npmjs.org/:_authToken=YOUR_TOKEN" >> ~/.npmrc

# 2. Verify auth.
npm whoami
# Expected output: jasoncomes (or your npm username)

# 3. Build the three packages.
pnpm --filter @directive-run/mutator --filter @directive-run/optimistic --filter @directive-run/timeline build

# 4. Publish each. --access public is critical for first-publish of scoped packages.
cd packages/mutator    && npm publish --access public
cd ../optimistic       && npm publish --access public
cd ../timeline         && npm publish --access public
cd ../..

# 5. Verify.
npm view @directive-run/mutator version    # → 0.2.0
npm view @directive-run/optimistic version # → 0.1.0
npm view @directive-run/timeline version   # → 0.2.0
```

After the first publish lands, GitHub Actions's `NPM_TOKEN` can update them in subsequent releases (the token already has update permission on packages it can see).

### Path B — replace the GitHub Actions `NPM_TOKEN` with a granular access token (durable fix, ~5 min)

Granular access tokens scope explicitly to package patterns and operations.

1. Visit https://www.npmjs.com/settings/jasoncomes/tokens
2. Click **Generate New Token → Granular Access Token**
3. **Permissions:** `Read and write` on all packages in `@directive-run/*` scope, including `Allow this token to publish new packages`.
4. **Expiration:** 365 days (or per your security policy).
5. Copy the new token.
6. In the GitHub repo at https://github.com/directive-run/directive/settings/secrets/actions, replace the `NPM_TOKEN` secret with the new value.
7. Re-run the failed Release workflow (or push an empty commit to retrigger).

After replacement, the next CI publish handles new packages correctly.

## Workflow guard added in this commit

`.github/workflows/release.yml` now includes a post-publish **verification step** that hits the npm registry directly for each published package and fails if it returns 404. Future runs that hit the same silent-publish bug will produce loud red CI errors instead of misleading green checks.

## Tag cleanup (optional)

The 2026-05-01 release pushed git tags for the three failed packages even though npm rejected them:

- `@directive-run/mutator@0.2.0`
- `@directive-run/optimistic@0.1.0`
- `@directive-run/timeline@0.2.0`

These tags are technically wrong (they point at a commit whose state didn't actually publish) but harmless — the recovery publish from Path A or Path B uses the same versions, so the tags re-align to the actual published state once recovery finishes. Skip the cleanup unless you have a reason to.

## See also

- [Changesets action README](https://github.com/changesets/action) — release flow context.
- [npm scoped packages docs](https://docs.npmjs.com/about-scopes) — public/private + access semantics.
- [npm granular access tokens](https://docs.npmjs.com/about-access-tokens) — token permission model.
