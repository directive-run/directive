// Tighten-only check for size-budgets.next.json.
//
//   node scripts/size-budgets-tighten.mjs <base-ref>
//
// Compares the budget file in the working tree with the copy at <base-ref> (CI
// passes the pull request's base branch, e.g. origin/main). A budget may fall
// freely. It fails the run when a fixture's budget rises (or becomes null, "no
// budget") and that fixture's `reason` is the same text as at the base: raising
// a budget means writing, in the same pull request, why the code earned it.
// Also fails when a fixture's entry is deleted (set it to null with a new
// reason instead), so a budget cannot be dropped without a trace. New entries
// are allowed.
//
// With no <base-ref> (a local run) it compares nothing and says so, exit 0. A
// <base-ref> that is not a commit fails: a typo must not read as "no change".
// A base that has no budget file yet (the pull request that adds it) compares
// nothing.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const file = "size-budgets.next.json";
const root = new URL("../../../", import.meta.url).pathname;
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });

const baseRef = process.argv[2] ?? process.env.SIZE_BUDGETS_BASE;
if (!baseRef) {
  console.log(
    "size budgets: no base ref given, comparing nothing (CI passes the base branch)",
  );
  process.exit(0);
}
try {
  git("rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`);
} catch {
  console.error(`size budgets: base ref "${baseRef}" is not a commit here`);
  process.exit(1);
}
let baseText;
try {
  baseText = git("show", `${baseRef}:${file}`);
} catch {
  console.log(`size budgets: ${baseRef} has no ${file}, comparing nothing`);
  process.exit(0);
}

const base = JSON.parse(baseText).budgets;
const head = JSON.parse(readFileSync(`${root}${file}`, "utf8")).budgets;
const failures = [];
for (const [key, was] of Object.entries(base)) {
  const now = head[key];
  if (!now) {
    failures.push(
      `"${key}" was removed. Keep the entry: set gzBudget to null and write the reason.`,
    );
    continue;
  }
  const rose =
    was.gzBudget !== null &&
    (now.gzBudget === null || now.gzBudget > was.gzBudget);
  if (rose && now.reason === was.reason) {
    failures.push(
      `"${key}" budget rose from ${was.gzBudget} B to ${now.gzBudget === null ? "no budget" : `${now.gzBudget} B`} and its reason did not change. Write why in "reason" in this pull request.`,
    );
  }
}
if (failures.length > 0) {
  console.error(
    `${file} may only tighten (compared with ${baseRef}):\n${failures.map((f) => `  ${f}`).join("\n")}`,
  );
  process.exit(1);
}
console.log(
  `size budgets: no budget rose against ${baseRef} without a new reason (${Object.keys(base).length} compared)`,
);
