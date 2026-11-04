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

alpha.0 is a tarball, not an npm publish (owner, 2026-11-02: "Tarball first,
npm later"). It is `@directive-run/core@2.0.0-alpha.0`, packed from
core-next with no swap commit, attached to a GitHub prerelease. The Aperture
lab's build and parity on that tarball are the gate. npm `next` waits until a
Sizls app runs on 2.0.

- [ ] Phase 3 (L4 to L6) is merged and the Aperture lab keeps its 1.35 parity
      on the tarball (`consumer:alpha` below exits 0).
- [ ] The first 2.x api-reference asset: the prerelease below attaches it.
      `.github/scripts/fetch-api-reference.sh` (about lines 80 to 95) fails a
      2.x build until a 2.x release carries one.
- [ ] Owner confirms the prerelease step below (it is public).

### Before the first npm prerelease (later)

- [ ] Pick its first version. The tarball holds `2.0.0-alpha.0` and its tag,
      `@directive-run/core@2.0.0-alpha.0`, so the npm line starts at
      `2.0.0-alpha.1` or later; changesets would otherwise try to create a
      tag that exists.
- [ ] The npm alpha publishes `@directive-run/core` only. Hold the other
      fixed-group packages back until their core entries exist, and verify
      changesets accepts held-back members of a fixed group first.
- [ ] The swap commit also updates `packages/core-next/package.json` (private,
      version; the exports map and CJS build are done), the bench v1 baseline,
      `packages/conformance/helpers/engine.ts`, `ci.yml`,
      `packages/conformance/contracts/api-surface.test.ts` and
      `packages/knowledge/api-skeleton.md`.
- [ ] Branch protection and secrets for `next` (the two GitHub steps below).
- [ ] `release/1.35` is stale: cut `release/1.x` from `main` when 2.0 goes
      stable.
- [ ] Pin the open `>=` `@directive-run` ranges in architect, policypilot,
      ruleforge, arbiter, sentinel, guardrails, cortex and fleetops before 2.0
      stable (owner approves the cross-repo PRs).

## alpha.0 as a tarball

Every step but the last runs locally, writes only to the directory you give
it and a temp directory, and touches no branch, tag, changeset or 1.x file.
Run them from a clean checkout of the `main` commit being released. Use one
directory for the outputs:

```bash
OUT=$(mktemp -d)/alpha
```

1. **Pack.** Builds core-next and packs a renamed copy of the package
   (`@directive-run/core`, `2.0.0-alpha.0`, not private, with README,
   repository, licenses and engines) to
   `$OUT/directive-run-core-2.0.0-alpha.0.tgz`. Note the shasum it prints.

   ```bash
   pnpm --filter @directive-run/core-next pack:alpha --out "$OUT"
   ```

2. **Install smoke.** npm-installs the tarball in an empty directory and loads
   all seven subpaths by `import` and `require`, under the default,
   `development` and `production` builds (42 loads). Each must resolve to the
   right file and export only 1.35's names; `/worker`, `/migration` and
   `/adapter-utils` must throw `E_FEATURE_MISSING` from every function. Then
   publint (strict) and are-the-types-wrong (`node16` profile). Exit 0 means
   all passed. The main entry and `/internals` list the 1.35 names they do
   not build yet; those are reported, not failed.

   ```bash
   pnpm --filter @directive-run/core-next smoke:alpha "$OUT/directive-run-core-2.0.0-alpha.0.tgz"
   ```

3. **Consumer check (the gate).** Copies the Aperture lab (read only) twice,
   installs 1.35 (`npm pack @directive-run/core@1.35.0`) into one copy and
   the tarball into the other, runs `npm run build`, serves the build and
   runs `npm run parity` in each, and compares the two parity reports. Exit 0
   means the same build result and the same parity rows as 1.35. A
   difference fails unless `packages/core-next/scripts/alpha/consumer-approved.json`
   lists it with a reason (owner approves each row). Needs network for the
   lab's npm install and Playwright's Chromium.

   ```bash
   pnpm --filter @directive-run/core-next consumer:alpha "$OUT/directive-run-core-2.0.0-alpha.0.tgz"
   ```

4. **API reference.** Generates the first 2.x `api-reference.json` from
   core-next's surface, the way release.yml's docs-artifacts job does for
   1.x (`extract-api-docs` from `@directive-run/toolkit`), with the module
   named `@directive-run/core`. It then checks that
   `fetch-api-reference.sh` on a 2.x tree selects an asset of that name from
   the release tag in step 5.

   ```bash
   npm i -g @directive-run/toolkit@latest   # or EXTRACT_API_DOCS=<path to extract-api-docs.js>
   pnpm --filter @directive-run/core-next api-reference:alpha --out "$OUT"
   ```

5. **Create the GitHub prerelease. OWNER-CONFIRMED: Claude asks Jason before
   running this step, because it is public.** It creates the tag
   `@directive-run/core@2.0.0-alpha.0` on the released `main` commit and
   attaches the tarball and `api-reference.json`. `--prerelease` and
   `--latest=false` keep it off "Latest", so 1.x's release pages and
   `releases/latest` are unchanged; `fetch-api-reference.sh` only gives this
   asset to 2.x trees.

   ```bash
   gh release create "@directive-run/core@2.0.0-alpha.0" \
     "$OUT/directive-run-core-2.0.0-alpha.0.tgz" \
     "$OUT/api-reference.json" \
     --repo directive-run/directive \
     --target "$(git rev-parse origin/main)" \
     --prerelease --latest=false \
     --title "@directive-run/core 2.0.0-alpha.0 (tarball)" \
     --notes "Directive 2.0 alpha as a tarball, not on npm. Install: npm install ./directive-run-core-2.0.0-alpha.0.tgz. Unbuilt 1.35 features throw E_FEATURE_MISSING; see the README in the tarball."
   ```

   Afterwards: `gh release view "@directive-run/core@2.0.0-alpha.0"` lists
   both assets, and `npm view @directive-run/core dist-tags` is unchanged
   (nothing went to npm).

## Starting the 2.0 prerelease line

Do this once, for the first npm prerelease (after the tarball, when "Before
the first npm prerelease" is clear).

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
   Merging it publishes the first npm prerelease (`2.0.0-alpha.1` or later:
   the tarball holds `2.0.0-alpha.0`) under the `next` dist-tag. Confirm
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
