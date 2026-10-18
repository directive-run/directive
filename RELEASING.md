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

## Starting the 2.0 prerelease line

Do this once, when 2.0.0-alpha.0 is ready. None of it has been run.

```bash
git fetch origin
git checkout -b next origin/main
git push -u origin next

# Enter changesets pre mode with the `next` tag.
pnpm changeset pre enter next
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
   Merging it publishes `2.0.0-next.0` under the `next` dist-tag. Confirm
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
