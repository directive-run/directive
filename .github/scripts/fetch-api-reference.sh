#!/usr/bin/env bash
#
# Fetch api-reference.json into the sibling directive-docs location that the
# knowledge package's build reads from.
#
# Every workflow job that builds the packages needs this, because the build
# turns this file into api-skeleton.md and refuses to substitute a placeholder
# for it — a placeholder is how a stub once shipped to npm in place of the
# whole API reference. No workflow checks out the sibling docs repo, so the
# file has to arrive here before the build runs.
#
# It resolves the newest release that actually carries the asset rather than
# reading `releases/latest`. Those are not the same thing and the difference is
# not cosmetic. A release cut publishes one GitHub release per package — a
# dozen or more — and the job that uploads this asset attaches it to whichever
# tag happened to be newest when it ran, so the asset lands on an arbitrary
# one. `releases/latest` then points at whatever was cut last, which usually
# has no assets at all. That URL 404'd for every build the moment a release
# completed, including the release's own docs job, which is how a green
# publish was immediately followed by a broken main.
set -euo pipefail

REPO="directive-run/directive"
ASSET="api-reference.json"
DEST_DIR="../directive-docs/docs/generated"
DEST="${DEST_DIR}/${ASSET}"

mkdir -p "${DEST_DIR}"

# Authenticate when a token is available. The releases API is public, so this
# is not about access — it is about the unauthenticated rate limit being per
# IP, which hosted runners share.
auth=()
if [ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]; then
  auth=(-H "Authorization: Bearer ${GH_TOKEN:-${GITHUB_TOKEN}}")
fi

releases_json=$(curl -sfL \
  --retry 5 --retry-delay 3 --retry-all-errors \
  --connect-timeout 15 --max-time 120 \
  ${auth[@]+"${auth[@]}"} \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/releases?per_page=100") || {
  echo "::error title=Release list unavailable::Could not list releases for ${REPO}."
  exit 1
}

# Releases come back newest-first, so the first match is the freshest copy.
url=$(python3 -c "
import json, sys
asset = sys.argv[1]
for release in json.load(sys.stdin):
    for a in release.get('assets') or []:
        if a.get('name') == asset:
            print(a['browser_download_url'])
            sys.exit(0)
sys.exit(1)
" "${ASSET}" <<<"${releases_json}") || {
  echo "::error title=${ASSET} not found on any release::Searched the 100 most recent releases of ${REPO}. The docs-artifacts job publishes this asset; if it has never succeeded, generate the file locally and attach it to a release before builds can pass."
  exit 1
}

if ! curl -sfL \
  --retry 5 --retry-delay 3 --retry-all-errors \
  --connect-timeout 15 --max-time 120 \
  "${url}" -o "${DEST}"; then
  echo "::error title=${ASSET} unreachable::Could not download ${url} after 5 attempts."
  exit 1
fi

# A truncated or HTML-error body downloads happily and then fails much later,
# inside a build step, as a JSON parse error that names neither this URL nor
# this step. Check it here while there is still context to report.
if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "${DEST}" 2>/dev/null; then
  echo "::error title=${ASSET} malformed::Fetched ${DEST} is not valid JSON ($(wc -c <"${DEST}") bytes) from ${url}."
  exit 1
fi

echo "[ci] fetched ${ASSET} ($(wc -c <"${DEST}") bytes) from ${url}"
