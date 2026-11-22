/**
 * The logging plugin's lines as a per-engine projection (L12 gate run 4).
 *
 * Owner, 2026-11-22: "Project, don't sign copies (Recommended)". A fuzz case
 * with the logging plugin (diff/fuzz/model.ts `pluginsOf`) records each line
 * as an external `["log", level, "[Directive] <name>"]`. Each line only
 * echoes the hook the plugin heard, so instead of comparing the lines across
 * engines (and signing a log twin of every approved hook difference), each
 * engine's trace is checked on its own: every line sits immediately before
 * the hook record it reports (the plugin runs before the recorder, which the
 * scenario appends last), and every hook the plugin maps has its line. The
 * one exception is `init`: its line and the recorder's `onInit` record are
 * not adjacent (on 1.35 other hooks come between), so the one `init` line
 * pairs with the trace's one `onInit` record, which must come after it. The cross-engine diff then drops the lines (diff/compare.ts
 * `kindOf`): the hook records they report are compared there.
 *
 * Self-tests: diff/self/l12-gate-run4.test.ts (a dropped line, lines out of
 * order against their hooks, the plugin after the recorder, and this table
 * against both engines' plugin sources).
 */
import type { TraceEntry } from "./record.js";

/**
 * The hook -> [level, line] table, from the logging plugin's source
 * (packages/core/src/plugins/logging.ts and packages/core-next's, identical
 * in both engines; pinned by the self-test). The prefix is the default
 * "[Directive]".
 */
export const LOG_LINES: Readonly<Record<string, readonly [string, string]>> = {
  onInit: ["debug", "init"],
  onStart: ["info", "start"],
  onStop: ["info", "stop"],
  onDestroy: ["debug", "destroy"],
  onFactSet: ["debug", "fact.set"],
  onFactDelete: ["debug", "fact.delete"],
  onFactsBatch: ["debug", "facts.batch"],
  onDerivationCompute: ["debug", "derivation.compute"],
  onDerivationInvalidate: ["debug", "derivation.invalidate"],
  onReconcileStart: ["debug", "reconcile.start"],
  onReconcileEnd: ["debug", "reconcile.end"],
  onConstraintEvaluate: ["debug", "constraint.evaluate"],
  onConstraintError: ["error", "constraint.error"],
  onRequirementCreated: ["debug", "requirement.created"],
  onRequirementMet: ["info", "requirement.met"],
  onRequirementCanceled: ["debug", "requirement.canceled"],
  onResolverStart: ["debug", "resolver.start"],
  onResolverComplete: ["info", "resolver.complete"],
  onResolverError: ["error", "resolver.error"],
  onResolverRetry: ["warn", "resolver.retry"],
  onResolverCancel: ["debug", "resolver.cancel"],
  onResolverWriteRejected: ["warn", "resolver.write.rejected"],
  onEffectRun: ["debug", "effect.run"],
  onEffectError: ["error", "effect.error"],
  onSourceAttach: ["debug", "source.attach"],
  onSourcePublish: ["debug", "source.publish"],
  onSourceDetach: ["debug", "source.detach"],
  onSourceError: ["error", "source.error"],
  onSnapshot: ["debug", "timetravel.snapshot"],
  onHistoryNavigate: ["info", "timetravel.jump"],
  onError: ["error", "error"],
  onErrorRecovery: ["warn", "error.recovery"],
  onDefinitionRegister: ["info", "definition.register"],
  onDefinitionAssign: ["info", "definition.assign"],
  onDefinitionUnregister: ["info", "definition.unregister"],
  onDefinitionCall: ["debug", "definition.call"],
  onTraceComplete: ["debug", "trace.complete"],
};

const PREFIX = "[Directive] ";

/**
 * Externals the plugins after logging (clobber alert, the clobber loop) may
 * record inside the same hook call, between logging's line and the
 * recorder's record (diff/fuzz/model.ts `pluginsOf` order).
 */
const LATER_PLUGIN_EXTERNALS = new Set([
  "clobber alert",
  "clobber loop",
  "clobber loop resolved",
]);

/** A fuzz logging plugin's line: `["log", level, message]`. */
export function isLogLine(entry: TraceEntry): boolean {
  return (
    entry.k === "external" &&
    Array.isArray(entry.data) &&
    entry.data.length === 3 &&
    entry.data[0] === "log"
  );
}

const lineOf = (hook: string): string | undefined => {
  const l = LOG_LINES[hook];

  return l ? JSON.stringify(["log", l[0], `${PREFIX}${l[1]}`]) : undefined;
};

const skippable = (e: TraceEntry) =>
  e.k === "external" &&
  Array.isArray(e.data) &&
  typeof e.data[0] === "string" &&
  LATER_PLUGIN_EXTERNALS.has(e.data[0]);

/**
 * One engine's trace against the projection: [] when every line reports
 * the hook record right after it and every mapped hook has its line.
 * `logging` is whether the case has the logging plugin; without it any
 * line is a problem.
 */
export function logProjectionProblems(
  trace: TraceEntry[],
  logging: boolean,
): string[] {
  const out: string[] = [];
  const lines = trace.filter(isLogLine).length;
  if (!logging) {
    return lines === 0
      ? []
      : [
          `${lines} logging-plugin line(s) in a case without the logging plugin`,
        ];
  }
  const said = (i: number) =>
    `logging projection: record ${i} (${JSON.stringify(trace[i]).slice(0, 120)})`;
  // `init`: the one init line, paired with the one onInit record, which
  // comes later (1.35 calls onInit late in start(), after other hooks).
  const initLine = `{"k":"external","data":${lineOf("onInit")}}`;
  const initLines = trace
    .map((e, i) => (JSON.stringify(e) === initLine ? i : -1))
    .filter((i) => i >= 0);
  const inits = trace
    .map((e, i) => (e.k === "hook" && e.hook === "onInit" ? i : -1))
    .filter((i) => i >= 0);
  const initAt = initLines[0] ?? -1;
  if (
    inits.length !== 1 ||
    initLines.length !== 1 ||
    initAt > (inits[0] as number)
  ) {
    out.push(
      `logging projection: one "init" line must come before the one onInit record (init lines: ${initLines.length}, onInit records: ${inits.length})`,
    );
  }
  const paired = new Set<number>([initAt, inits[0] ?? -1]);
  for (const [i, e] of trace.entries()) {
    if (!isLogLine(e) || paired.has(i)) {
      continue;
    }
    let j = i + 1;
    while (j < trace.length && skippable(trace[j] as TraceEntry)) {
      j++;
    }
    const hook = trace[j];
    const want = hook?.k === "hook" ? lineOf(hook.hook) : undefined;
    if (
      hook?.k !== "hook" ||
      paired.has(j) ||
      want !== JSON.stringify((e as { data: unknown }).data)
    ) {
      out.push(
        `${said(i)}: a line with no hook record of its own right after it`,
      );
      continue;
    }
    paired.add(i);
    paired.add(j);
  }
  for (const [j, e] of trace.entries()) {
    if (e.k === "hook" && LOG_LINES[e.hook] && !paired.has(j)) {
      out.push(`${said(j)}: a hook the logging plugin maps, with no line`);
    }
  }

  return out;
}
