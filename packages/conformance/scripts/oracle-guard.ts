/**
 * Enforce the rules for changing the oracle. See lib/guard.ts.
 *
 * Tree mode (default; the conformance CI job and `pnpm conformance`): the
 * correctness baseline only tightens, and the harness matches its lock.
 *
 * PR mode (`--pr`; .github/workflows/oracle-guard.yml): the label rule and
 * the core-next/harness path rule. It runs from the BASE branch under
 * pull_request_target and reads the head only as data through the GitHub
 * API — the changed-file list, the labels in the event payload, and
 * pnpm-lock.yaml at both ends as text. Nothing from the head is executed,
 * so a PR cannot change the rules that judge it.
 *
 * Usage: pnpm --filter @directive-run/conformance oracle:guard [--pr]
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultRepoRoot } from "../lib/core-entries.js";
import { checkBaseline, checkPullRequest } from "../lib/guard.js";
import { checkLock } from "../lib/harness.js";

const conformanceRoot = join(defaultRepoRoot, "packages/conformance");
const failures: string[] = [];

if (process.argv.includes("--pr")) {
  const event = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH as string, "utf8"),
  ) as {
    repository: { full_name: string };
    pull_request: {
      number: number;
      base: { sha: string };
      head: { sha: string };
      labels: Array<{ name: string }>;
    };
  };
  const repo = event.repository.full_name;
  const pr = event.pull_request;
  const token = process.env.GH_TOKEN;
  if (!token) {
    throw new Error("GH_TOKEN is required in --pr mode");
  }
  const api = async (path: string, accept = "application/vnd.github+json") => {
    const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      headers: { authorization: `Bearer ${token}`, accept },
    });
    if (!res.ok) {
      throw new Error(`GitHub API ${path}: ${res.status}`);
    }

    return res;
  };

  const changed: string[] = [];
  for (let page = 1; ; page++) {
    const files = (await (
      await api(`pulls/${pr.number}/files?per_page=100&page=${page}`)
    ).json()) as Array<{ filename: string; previous_filename?: string }>;
    for (const f of files) {
      changed.push(f.filename);
      if (f.previous_filename) {
        changed.push(f.previous_filename);
      }
    }
    if (files.length < 100) {
      break;
    }
  }

  const lockAt = async (sha: string) =>
    (
      await api(
        `contents/pnpm-lock.yaml?ref=${sha}`,
        "application/vnd.github.raw+json",
      )
    ).text();
  const lockfile = changed.includes("pnpm-lock.yaml")
    ? { base: await lockAt(pr.base.sha), head: await lockAt(pr.head.sha) }
    : undefined;

  // v2-passing.json at both ends, as data (null: the base has none yet).
  const ratchetPath = "packages/conformance/v2-passing.json";
  const ratchetAt = async (sha: string) => {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/contents/${ratchetPath}?ref=${sha}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github.raw+json",
        },
      },
    );
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`GitHub API contents/${ratchetPath}: ${res.status}`);
    }

    return res.text();
  };
  const ratchet = changed.includes(ratchetPath)
    ? {
        base: await ratchetAt(pr.base.sha),
        head: (await ratchetAt(pr.head.sha)) ?? '{"tests":{}}',
      }
    : undefined;

  const labels = pr.labels.map((l) => l.name);
  failures.push(...checkPullRequest(changed, labels, lockfile, ratchet));
  console.log(
    `[oracle-guard] PR #${pr.number}: ${changed.length} changed files, labels: ${labels.join(", ") || "none"}`,
  );
} else {
  failures.push(...checkBaseline(conformanceRoot));
  failures.push(...checkLock(conformanceRoot));
}

for (const failure of failures) {
  console.error(`✗ ${failure}`);
}
if (failures.length > 0) {
  process.exit(1);
}
console.log("[oracle-guard] ok");
