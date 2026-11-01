# Releasing

`main` publishes the stable line to the `latest` dist-tag through changesets
(`.github/workflows/release.yml`). Nothing about that changes for 1.x.

## Safety checks in the pipeline

- `fetch-api-reference.sh` reads the major from `packages/core/package.json`
  and only accepts an `api-reference.json` attached to a release tag of that
  same major. A 1.x build never sees a 2.x reference. Test:
  `scripts/__tests__/fetch-api-reference.test.sh` (runs in CI).
- On `main`, release.yml fails if `.changeset/pre.json` exists. On `next`, it
  fails if it does not. `next` publishes with `--tag next`.
- After a publish, `npm view @directive-run/core dist-tags` is checked. On
  `main`, `latest` must equal the core version just published. On `next`,
  `latest` must be unchanged from before the run.

## Before alpha.0

None of the prerelease steps below have been run. Clear this list first.

- [ ] alpha.0 waits for Phase 3 (L4 to L6) and a surface that covers a real
      consumer such as the Aperture lab (owner, 2026-11-01).
- [ ] Seed or generate the first 2.x api-reference asset:
      `.github/scripts/fetch-api-reference.sh` (about lines 80 to 95) fails
      without a 2.x release carrying one.
- [ ] alpha.0 publishes `@directive-run/core` only. Hold the other
      fixed-group packages back until their core entries exist, and verify
      changesets accepts held-back members of a fixed group first.
- [ ] The swap commit also updates `packages/core-next/package.json` (private,
      version, exports, CJS), the bench v1 baseline,
      `packages/conformance/helpers/engine.ts`, `ci.yml`,
      `packages/conformance/contracts/api-surface.test.ts` and
      `packages/knowledge/api-skeleton.md`.
- [ ] Branch protection and secrets for `next` (the two GitHub steps below).
- [ ] `release/1.35` is stale: cut `release/1.x` from `main` when 2.0 goes
      stable.
- [ ] Pin the open `>=` `@directive-run` ranges in architect, policypilot,
      ruleforge, arbiter, sentinel, guardrails, cortex and fleetops before 2.0
      stable (owner approves the cross-repo PRs).

## Starting the 2.0 prerelease line

Do this once, when the list above is clear and 2.0.0-alpha.0 is ready.

The changesets pre tag and the npm dist-tag are separate. `pre enter alpha`
sets the version suffix (`2.0.0-alpha.N`). The dist-tag stays `next` because
release.yml passes it explicitly:

```yaml
# main: exactly `pnpm changeset publish`, as before. next: explicit
# `--tag next` so a prerelease can never land on `latest`.
publish: ${{ github.ref_name == 'next' && 'pnpm changeset publish --tag next' || 'pnpm changeset publish' }}
```

The guard step only requires that `.changeset/pre.json` exists on `next`, and
that on `main` its mode is not `pre`. It does not read the tag, so `alpha` passes.

```bash
git fetch origin
git checkout -b next origin/main
git push -u origin next

# Enter changesets pre mode with the `alpha` tag (versions 2.0.0-alpha.N).
# The npm dist-tag is still `next`, set by release.yml's `--tag next`.
pnpm changeset pre enter alpha
# Add (or keep) a changeset that makes the major bump, then:
git add .changeset
git commit -m "chore: enter 2.0 prerelease mode"
git push origin next
```

Then in GitHub:

1. Add `next` to branch protection with the same required checks as `main`.
2. Make sure the release workflow's secrets (`NPM_TOKEN`) are available to
   `next` (no environment restriction that limits them to `main`).
3. The first push to `next` opens a "Version Packages" PR against `next`.
   Merging it publishes `2.0.0-alpha.0` under the `next` dist-tag. Confirm
   `npm view @directive-run/core dist-tags` shows `latest` still on 1.x.

Fixes for 1.x keep landing on `main` and publish to `latest` as usual. Merge
`main` into `next` periodically so the prerelease line carries them.

Leaving the prerelease line at 2.0.0 stable:

```bash
pnpm changeset pre exit
# commit .changeset/pre.json removal, merge next into main, publish from main
```

## Follow-up

The Version Packages PR is opened with `GITHUB_TOKEN`, so CI does not run on
it. Using a GitHub App token for that step needs a credential and is not part
of this change.

Because of that, main now requires its checks with `enforce_admins` on, and the
Version Packages PR has none. To merge it, a human closes and reopens the PR
(or pushes an empty commit to its branch), which triggers CI. As a second
guard, `release.yml` re-runs build, typecheck, tests and the package checks
(`check:packages`, `smoke:install`) before the publish step, so a publish
refuses if any of them fail.
