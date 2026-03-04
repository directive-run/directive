#!/bin/bash
# Vercel Ignored Build Step
# https://vercel.com/docs/projects/overview#ignored-build-step
#
# Exit 1 = build, Exit 0 = skip
#
# Only rebuild when website/ files actually changed.
# Skips builds for package-only changes, changeset bumps, CI fixes, etc.

echo "Checking if website needs rebuilding..."

# Always build if no previous commit (first deploy)
if ! git rev-parse HEAD^ >/dev/null 2>&1; then
  echo "→ First deploy, building."
  exit 1
fi

# Check if website/ directory has changes
git diff --quiet HEAD^ HEAD -- website/
WEBSITE_CHANGED=$?

# Also rebuild if package.json deps changed (in case website depends on workspace packages)
git diff --quiet HEAD^ HEAD -- website/package.json pnpm-lock.yaml
DEPS_CHANGED=$?

if [ $WEBSITE_CHANGED -ne 0 ] || [ $DEPS_CHANGED -ne 0 ]; then
  echo "→ Website or dependencies changed, building."
  exit 1
fi

echo "→ No website changes, skipping build."
exit 0
