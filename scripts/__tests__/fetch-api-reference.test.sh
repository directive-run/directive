#!/usr/bin/env bash
# Proves fetch-api-reference.sh selects the API reference of the tree's own
# major and never crosses majors. Offline: uses SELECT_ONLY + a fixture list.
set -uo pipefail
cd "$(dirname "$0")/../.."
script=.github/scripts/fetch-api-reference.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Newest-first, as the GitHub API returns. A 2.x alpha is NEWEST so a
# "latest across majors" implementation would wrongly pick it.
cat >"$tmp/releases.json" <<'JSON'
[
 {"tag_name":"@directive-run/core@2.0.0-alpha.1","assets":[{"name":"api-reference.json","browser_download_url":"https://x/v2-alpha1"}]},
 {"tag_name":"@directive-run/ai@1.35.0","assets":[]},
 {"tag_name":"@directive-run/core@1.35.0","assets":[{"name":"api-reference.json","browser_download_url":"https://x/v1-35"}]},
 {"tag_name":"@directive-run/core@1.34.0","assets":[{"name":"api-reference.json","browser_download_url":"https://x/v1-34"}]}
]
JSON

fail=0
check() { # name version expected-url-or-FAIL
  local out rc
  out=$(TREE_VERSION="$2" RELEASES_JSON_FILE="$tmp/releases.json" SELECT_ONLY=1 bash "$script" 2>/dev/null); rc=$?
  if [ "$3" = FAIL ]; then
    if [ $rc -ne 0 ]; then echo "ok   $1"; else echo "FAIL $1: expected failure, got '$out'"; fail=1; fi
  else
    if [ $rc -eq 0 ] && [ "$out" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: rc=$rc out='$out' want '$3'"; fail=1; fi
  fi
}

check "1.35.0 tree selects 1.x artifact" 1.35.0 https://x/v1-35
check "2.0.0-alpha.0 tree selects 2.x artifact" 2.0.0-alpha.0 https://x/v2-alpha1
check "3.x tree finds nothing (no cross-major fallback)" 3.0.0 FAIL
check "garbage version fails" notaversion FAIL

# The real tree's own version resolves to its own major.
want=$(python3 -c "import json;print(json.load(open('packages/core/package.json'))['version'].split('.')[0])")
got=$(RELEASES_JSON_FILE="$tmp/releases.json" SELECT_ONLY=1 bash "$script" 2>/dev/null) || got=""
case "$want:$got" in
  1:https://x/v1-35|2:https://x/v2-alpha1) echo "ok   real tree (major $want)";;
  *) echo "FAIL real tree: major $want got '$got'"; fail=1;;
esac
exit $fail
