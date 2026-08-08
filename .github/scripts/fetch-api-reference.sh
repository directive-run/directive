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
# Retries because the failure mode in practice is a transient TLS reset on the
# runner rather than a missing artifact, and a job that dies on one blip is a
# job people learn to re-run without reading. A genuine 404 still fails, and
# fails loudly: the build immediately after this cannot succeed without the
# file, so stopping here reports the real problem in one line instead of
# surfacing it as a confusing build error further down.
set -euo pipefail

URL="https://github.com/directive-run/directive/releases/latest/download/api-reference.json"
DEST_DIR="../directive-docs/docs/generated"
DEST="${DEST_DIR}/api-reference.json"

mkdir -p "${DEST_DIR}"

if ! curl -sfL \
  --retry 5 \
  --retry-delay 3 \
  --retry-all-errors \
  --connect-timeout 15 \
  --max-time 120 \
  "${URL}" \
  -o "${DEST}"; then
  echo "::error title=api-reference.json unavailable::Could not fetch ${URL} after 5 attempts. The knowledge package's build needs this file and will not substitute a placeholder for it."
  exit 1
fi

# A truncated or HTML-error body downloads happily and then fails much later,
# inside a build step, as a JSON parse error that names neither this URL nor
# this step. Check it here while there is still context to report.
if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "${DEST}" 2>/dev/null; then
  echo "::error title=api-reference.json malformed::Fetched ${DEST} is not valid JSON ($(wc -c <"${DEST}") bytes)."
  exit 1
fi

echo "[ci] fetched api-reference.json ($(wc -c <"${DEST}") bytes)"
