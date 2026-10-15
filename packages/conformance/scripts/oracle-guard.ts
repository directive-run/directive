/**
 * Enforce the rules for changing the oracle. See lib/guard.ts.
 *
 * Always: the correctness baseline only tightens.
 * On a pull_request event (GITHUB_EVENT_PATH): the oracle-change label rule
 * and the core-next/harness path rule, over the PR's changed files. On any
 * other event, those two are a no-op.
 *
 * Usage: pnpm --filter @directive-run/conformance oracle:guard
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultRepoRoot } from "../lib/core-entries.js";
import { checkBaseline, checkPullRequest } from "../lib/guard.js";

const conformanceRoot = join(defaultRepoRoot, "packages/conformance");
const failures = checkBaseline(conformanceRoot);

const eventName = process.env.GITHUB_EVENT_NAME;
const eventPath = process.env.GITHUB_EVENT_PATH;
if (eventName === "pull_request" && eventPath) {
  const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
    pull_request: {
      base: { sha: string };
      head: { sha: string };
      labels: Array<{ name: string }>;
    };
  };
  const pr = event.pull_request;
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", `${pr.base.sha}...${pr.head.sha}`],
    { cwd: defaultRepoRoot, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  failures.push(
    ...checkPullRequest(
      changed,
      pr.labels.map((l) => l.name),
    ),
  );
  console.log(
    `[oracle-guard] PR: ${changed.length} changed files, labels: ${pr.labels.map((l) => l.name).join(", ") || "none"}`,
  );
}

for (const failure of failures) {
  console.error(`✗ ${failure}`);
}
if (failures.length > 0) {
  process.exit(1);
}
console.log("[oracle-guard] baseline holds");
