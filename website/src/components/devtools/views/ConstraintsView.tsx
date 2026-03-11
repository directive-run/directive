"use client";

import type { TraceEntry } from "@directive-run/core";
import { useSelector } from "@directive-run/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDevToolsSystem } from "../DevToolsSystemContext";
import { EmptyState } from "../EmptyState";
import type {
  RuntimeConstraintInfo,
  RuntimeRequirementInfo,
  RuntimeResolverDef,
} from "../modules/devtools-runtime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Constraint = RuntimeConstraintInfo;
type Requirement = RuntimeRequirementInfo;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(timestamp: number, now: number): string {
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) {
    return "";
  }

  const delta = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (delta < 2) {
    return "just now";
  }
  if (delta < 60) {
    return `${delta}s ago`;
  }
  if (delta < 3600) {
    return `${Math.floor(delta / 60)}m ago`;
  }

  return `${Math.floor(delta / 3600)}h ago`;
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

// ---------------------------------------------------------------------------
// LatestTraceSummary — Zone 2
// ---------------------------------------------------------------------------

function LatestTraceSummary({ run }: { run: TraceEntry }) {
  const [expanded, setExpanded] = useState(false);

  const statusColor =
    run.status === "settled"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-amber-600 dark:text-amber-400";

  const chainParts: string[] = [];
  if (run.factChanges.length > 0)
    chainParts.push(
      `${run.factChanges.length} fact${run.factChanges.length !== 1 ? "s" : ""}`,
    );
  if (run.constraintsHit.length > 0)
    chainParts.push(
      `${run.constraintsHit.length} constraint${run.constraintsHit.length !== 1 ? "s" : ""}`,
    );
  if (run.resolversStarted.length > 0)
    chainParts.push(
      `${run.resolversStarted.length} resolver${run.resolversStarted.length !== 1 ? "s" : ""}`,
    );

  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left font-mono text-[11px]"
        aria-expanded={expanded}
      >
        <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
          Run #{run.id}
        </span>
        <span className={`shrink-0 ${statusColor}`}>{run.status}</span>
        <span className="shrink-0 text-zinc-400 dark:text-zinc-500">
          {run.duration.toFixed(0)}ms
        </span>
        {run.causalChain && (
          <span className="truncate text-zinc-500 dark:text-zinc-400">
            {run.causalChain}
          </span>
        )}
        {!run.causalChain && chainParts.length > 0 && (
          <span className="truncate text-zinc-500 dark:text-zinc-400">
            {chainParts.join(" → ")}
          </span>
        )}
        {run.anomalies && run.anomalies.length > 0 && (
          <span className="rounded bg-amber-100 px-1 py-px text-[9px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            anomaly
          </span>
        )}
        <span className="ml-auto text-zinc-400 dark:text-zinc-500">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
          {/* Fact changes */}
          {run.factChanges.length > 0 && (
            <RunSection
              title="Fact Changes"
              count={run.factChanges.length}
              color="sky"
            >
              {run.factChanges.map((fc, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 font-mono text-[10px]"
                >
                  <span className="text-sky-600 dark:text-sky-400">
                    {fc.key}
                  </span>
                  <span className="text-zinc-400">:</span>
                  <span className="text-red-500 line-through">
                    {formatValue(fc.oldValue)}
                  </span>
                  <span className="text-zinc-400">→</span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {formatValue(fc.newValue)}
                  </span>
                </div>
              ))}
            </RunSection>
          )}

          {/* Derivations recomputed */}
          {run.derivationsRecomputed.length > 0 && (
            <RunSection
              title="Derivations"
              count={run.derivationsRecomputed.length}
              color="purple"
            >
              {run.derivationsRecomputed.map((d, i) => (
                <div key={i} className="font-mono text-[10px]">
                  <div className="flex items-center gap-2">
                    <span className="text-purple-600 dark:text-purple-400">
                      {d.id}
                    </span>
                    <span className="text-zinc-400">
                      deps: [{d.deps.join(", ")}]
                    </span>
                  </div>
                  <div className="ml-2 flex items-center gap-2">
                    <span className="text-red-500 line-through">
                      {formatValue(d.oldValue)}
                    </span>
                    <span className="text-zinc-400">→</span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {formatValue(d.newValue)}
                    </span>
                  </div>
                </div>
              ))}
            </RunSection>
          )}

          {/* Constraints hit */}
          {run.constraintsHit.length > 0 && (
            <RunSection
              title="Constraints Hit"
              count={run.constraintsHit.length}
              color="emerald"
            >
              {run.constraintsHit.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 font-mono text-[10px]"
                >
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {c.id}
                  </span>
                  <span className="rounded bg-zinc-200 px-1 py-px text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400">
                    p{c.priority}
                  </span>
                  <span className="text-zinc-400">
                    deps: [{c.deps.join(", ")}]
                  </span>
                </div>
              ))}
            </RunSection>
          )}

          {/* Requirements added/removed */}
          {(run.requirementsAdded.length > 0 ||
            run.requirementsRemoved.length > 0) && (
            <RunSection
              title="Requirements"
              count={
                run.requirementsAdded.length + run.requirementsRemoved.length
              }
              color="amber"
            >
              {run.requirementsAdded.map((r, i) => (
                <div
                  key={`a-${i}`}
                  className="flex items-center gap-2 font-mono text-[10px]"
                >
                  <span className="rounded bg-emerald-100 px-1 py-px text-[9px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                    +
                  </span>
                  <span className="text-amber-700 dark:text-amber-400">
                    {r.type}
                  </span>
                  <span className="text-zinc-400">from {r.fromConstraint}</span>
                </div>
              ))}
              {run.requirementsRemoved.map((r, i) => (
                <div
                  key={`r-${i}`}
                  className="flex items-center gap-2 font-mono text-[10px]"
                >
                  <span className="rounded bg-red-100 px-1 py-px text-[9px] text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    −
                  </span>
                  <span className="text-zinc-500 line-through">{r.type}</span>
                  <span className="text-zinc-400">from {r.fromConstraint}</span>
                </div>
              ))}
            </RunSection>
          )}

          {/* Resolvers */}
          {(run.resolversStarted.length > 0 ||
            run.resolversCompleted.length > 0 ||
            run.resolversErrored.length > 0) && (
            <RunSection
              title="Resolvers"
              count={run.resolversStarted.length}
              color="indigo"
            >
              {run.resolversCompleted.map((r, i) => (
                <div
                  key={`c-${i}`}
                  className="flex items-center gap-2 font-mono text-[10px]"
                >
                  <span className="text-emerald-500">✓</span>
                  <span className="text-indigo-600 dark:text-indigo-400">
                    {r.resolver}
                  </span>
                  <span className="text-zinc-400">
                    {r.duration.toFixed(0)}ms
                  </span>
                </div>
              ))}
              {run.resolversErrored.map((r, i) => (
                <div key={`e-${i}`} className="font-mono text-[10px]">
                  <div className="flex items-center gap-2">
                    <span className="text-red-500">✗</span>
                    <span className="text-indigo-600 dark:text-indigo-400">
                      {r.resolver}
                    </span>
                  </div>
                  <div className="ml-4 text-red-500">{r.error}</div>
                </div>
              ))}
              {run.resolversStarted
                .filter(
                  (s) =>
                    !run.resolversCompleted.some(
                      (c) => c.resolver === s.resolver,
                    ) &&
                    !run.resolversErrored.some(
                      (e) => e.resolver === s.resolver,
                    ),
                )
                .map((r, i) => (
                  <div
                    key={`s-${i}`}
                    className="flex items-center gap-2 font-mono text-[10px]"
                  >
                    <span className="animate-pulse text-amber-500">●</span>
                    <span className="text-indigo-600 dark:text-indigo-400">
                      {r.resolver}
                    </span>
                    <span className="text-zinc-400">inflight</span>
                  </div>
                ))}
            </RunSection>
          )}

          {/* Effects */}
          {run.effectsRun.length > 0 && (
            <RunSection
              title="Effects"
              count={run.effectsRun.length}
              color="fuchsia"
            >
              {run.effectsRun.map((e, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 font-mono text-[10px]"
                >
                  <span className="text-fuchsia-600 dark:text-fuchsia-400">
                    {e.id}
                  </span>
                  <span className="text-zinc-400">
                    triggered by [{e.triggeredBy.join(", ")}]
                  </span>
                </div>
              ))}
              {run.effectErrors.map((e, i) => (
                <div key={`err-${i}`} className="font-mono text-[10px]">
                  <span className="text-fuchsia-600 dark:text-fuchsia-400">
                    {e.id}
                  </span>
                  <span className="ml-2 text-red-500">{e.error}</span>
                </div>
              ))}
            </RunSection>
          )}

          {/* Anomalies */}
          {run.anomalies && run.anomalies.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 dark:border-amber-800/30 dark:bg-amber-900/10">
              <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                Anomalies
              </div>
              {run.anomalies.map((a, i) => (
                <div
                  key={i}
                  className="font-mono text-[10px] text-amber-600 dark:text-amber-400"
                >
                  {a}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunSection({
  title,
  count,
  color,
  children,
}: { title: string; count: number; color: string; children: React.ReactNode }) {
  const colorMap: Record<string, string> = {
    sky: "text-sky-600 dark:text-sky-400",
    purple: "text-purple-600 dark:text-purple-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    indigo: "text-indigo-600 dark:text-indigo-400",
    fuchsia: "text-fuchsia-600 dark:text-fuchsia-400",
  };

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide">
        <span className={colorMap[color] ?? "text-zinc-500"}>{title}</span>
        <span className="font-mono font-normal text-zinc-400">{count}</span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConstraintRow — expandable constraint with deps + disable toggle
// ---------------------------------------------------------------------------

function ConstraintRow({
  c,
  now,
  latestTrace,
  isExpanded,
  onToggle,
  onToggleDisable,
}: {
  c: Constraint;
  now: number;
  latestTrace: TraceEntry | null;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  onToggleDisable: (c: Constraint) => void;
}) {
  // Find deps from the latest trace that hit this constraint
  const deps = useMemo(() => {
    if (!latestTrace) {
      return null;
    }

    const hit = latestTrace.constraintsHit.find((h) => h.id === c.id);

    return hit?.deps ?? null;
  }, [latestTrace, c.id]);

  // Visual state: disabled takes precedence over active/inactive
  const isDisabled = c.disabled;
  const dotClass = isDisabled
    ? "bg-red-400"
    : c.active
      ? "bg-emerald-500"
      : "bg-zinc-400";
  const rowBg = isDisabled
    ? "bg-red-50/50 dark:bg-red-900/5"
    : c.active
      ? "bg-emerald-50 dark:bg-emerald-900/10"
      : "opacity-60";

  return (
    <div className={`rounded font-mono text-xs ${rowBg}`}>
      <div className="flex items-center gap-3 px-2 py-1.5">
        <div
          className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`}
          aria-hidden="true"
        />
        <span
          className={
            isDisabled
              ? "text-red-400 line-through dark:text-red-500"
              : c.active
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-zinc-500 dark:text-zinc-500"
          }
        >
          {c.id}
        </span>
        {isDisabled && (
          <span className="rounded bg-red-100 px-1 py-px text-[9px] font-semibold uppercase leading-none text-red-700 dark:bg-red-900/30 dark:text-red-400">
            disabled
          </span>
        )}
        {c.priority !== undefined && (
          <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400">
            p{c.priority}
          </span>
        )}
        {c.hitCount > 0 && (
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
            &times;{c.hitCount}
          </span>
        )}
        {c.lastActiveAt != null && c.lastActiveAt > 0 && (
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            {formatRelativeTime(c.lastActiveAt, now)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => onToggleDisable(c)}
            className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] transition ${
              isDisabled
                ? "text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
                : "text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
            }`}
            aria-label={
              isDisabled
                ? `Enable constraint ${c.id}`
                : `Disable constraint ${c.id}`
            }
            title={isDisabled ? "Enable constraint" : "Disable constraint"}
          >
            {isDisabled ? "enable" : "disable"}
          </button>
          {deps && (
            <button
              onClick={() => onToggle(c.id)}
              aria-expanded={isExpanded}
              aria-label={
                isExpanded ? `Hide deps for ${c.id}` : `Show deps for ${c.id}`
              }
              className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
            >
              {isExpanded ? "Hide" : "Deps"}
            </button>
          )}
        </div>
      </div>
      {isExpanded && deps && (
        <div className="border-t border-zinc-200 px-3 py-1.5 text-[10px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Depends on:{" "}
          {deps.map((d, i) => (
            <span key={d}>
              {i > 0 && ", "}
              <span className="text-sky-600 dark:text-sky-400">{d}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RequirementRow — unified inflight + unmet
// ---------------------------------------------------------------------------

function RequirementRow({
  r,
  latestTrace,
  resolverStats,
  isExpanded,
  onToggle,
}: {
  r: Requirement;
  latestTrace: TraceEntry | null;
  resolverStats: Record<string, { count: number; errors: number }>;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}) {
  const isInflight = r.status === "inflight";
  const bgClass = isInflight
    ? "bg-amber-50 dark:bg-amber-900/10"
    : "bg-red-50 dark:bg-red-900/10";
  const dotClass = isInflight ? "animate-pulse bg-amber-500" : "bg-red-500";
  const textClass = isInflight
    ? "text-amber-700 dark:text-amber-400"
    : "text-red-700 dark:text-red-400";
  const btnClass = isInflight
    ? "text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-800/30"
    : "text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-800/30";
  const borderClass = isInflight
    ? "border-amber-200 dark:border-amber-800/30"
    : "border-red-200 dark:border-red-800/30";

  // Find resolver from trace (actual data, not heuristic)
  const resolverFromHistory = useMemo(() => {
    if (!latestTrace) {
      return null;
    }

    const started = latestTrace.resolversStarted.find(
      (s) => s.requirementId === r.id,
    );
    if (started) {
      return started.resolver;
    }

    // Fallback: heuristic match on type
    return (
      Object.keys(resolverStats).find((key) => {
        const norm = key.toLowerCase().replace(/[_-]/g, "");
        const typeNorm = r.type.toLowerCase().replace(/[_-]/g, "");

        return (
          norm === typeNorm ||
          norm.includes(typeNorm) ||
          typeNorm.includes(norm)
        );
      }) ?? null
    );
  }, [latestTrace, r.id, r.type, resolverStats]);

  // Find actual error from trace
  const resolverError = useMemo(() => {
    if (!latestTrace || !resolverFromHistory) {
      return null;
    }

    const errored = latestTrace.resolversErrored.find(
      (e) => e.resolver === resolverFromHistory,
    );

    return errored?.error ?? null;
  }, [latestTrace, resolverFromHistory]);

  return (
    <div className={`rounded font-mono text-xs ${bgClass}`}>
      <div className="flex items-center gap-3 px-2 py-1.5">
        <div
          className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`}
          aria-hidden="true"
        />
        <span className={textClass}>{r.type}</span>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          from {r.fromConstraint}
        </span>
        <span
          className={`rounded px-1 py-px text-[9px] font-semibold uppercase leading-none ${
            isInflight
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          }`}
        >
          {r.status}
        </span>
        <button
          onClick={() => onToggle(r.id)}
          aria-expanded={isExpanded}
          aria-label={
            isExpanded ? `Hide trace for ${r.type}` : `Show trace for ${r.type}`
          }
          className={`ml-auto cursor-pointer rounded px-1.5 py-0.5 text-[10px] ${btnClass}`}
        >
          {isExpanded ? "Hide" : "Trace"}
        </button>
      </div>
      {isExpanded && (
        <div className={`border-t px-3 py-2 text-[10px] ${borderClass}`}>
          <div className="flex flex-wrap items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
            <span className="rounded bg-emerald-100 px-1 py-px text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              {r.fromConstraint}
            </span>
            <span className="text-zinc-300 dark:text-zinc-600">→</span>
            <span
              className={`rounded px-1 py-px ${
                isInflight
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              }`}
            >
              {r.type}
            </span>
            {resolverFromHistory && (
              <>
                <span className="text-zinc-300 dark:text-zinc-600">→</span>
                <span className="rounded bg-indigo-100 px-1 py-px text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                  {resolverFromHistory}
                </span>
                {resolverStats[resolverFromHistory] && (
                  <span className="text-zinc-400">
                    ({resolverStats[resolverFromHistory].count} runs,{" "}
                    {resolverStats[resolverFromHistory].errors} errors)
                  </span>
                )}
              </>
            )}
            {!resolverFromHistory && (
              <span className="text-red-400 dark:text-red-500">
                (no resolver matched)
              </span>
            )}
          </div>
          {resolverError && (
            <div className="mt-1.5 rounded border border-red-200 bg-red-50 px-2 py-1 text-red-600 dark:border-red-800/30 dark:bg-red-900/10 dark:text-red-400">
              {resolverError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResolverRow — with duration bar, success rate, error details
// ---------------------------------------------------------------------------

function ResolverRow({
  name,
  stats,
  maxCount,
  latestTrace,
  requirementType,
  isExpanded,
  onToggle,
}: {
  name: string;
  stats: { count: number; errors: number; totalMs?: number };
  maxCount: number;
  latestTrace: TraceEntry | null;
  requirementType?: string;
  isExpanded: boolean;
  onToggle: (name: string) => void;
}) {
  const avgMs =
    stats.count > 0 && stats.totalMs != null
      ? stats.totalMs / stats.count
      : null;
  const successRate =
    stats.count > 0 ? ((stats.count - stats.errors) / stats.count) * 100 : null;
  const durationBarWidth =
    stats.count > 0 && maxCount > 0
      ? Math.max(4, (stats.count / maxCount) * 100)
      : 0;
  const isIdle = stats.count === 0 && stats.errors === 0;

  // Get latest error from trace
  const latestError = useMemo(() => {
    if (!latestTrace) {
      return null;
    }

    const errored = latestTrace.resolversErrored.find((e) => e.resolver === name);

    return errored?.error ?? null;
  }, [latestTrace, name]);

  return (
    <div
      className={`rounded font-mono text-xs ${isIdle ? "bg-zinc-50 dark:bg-zinc-800/30" : "bg-indigo-50 dark:bg-indigo-900/10"}`}
    >
      <div className="flex items-center gap-3 px-2 py-1.5">
        <div
          className={`h-2 w-2 shrink-0 rounded-full ${isIdle ? "bg-zinc-300 dark:bg-zinc-600" : "bg-indigo-500"}`}
          aria-hidden="true"
        />
        <span
          className={
            isIdle
              ? "text-zinc-500 dark:text-zinc-400"
              : "text-indigo-700 dark:text-indigo-400"
          }
        >
          {name}
        </span>
        {requirementType && (
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            {requirementType}
          </span>
        )}
        {isIdle && (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] text-zinc-400 dark:bg-zinc-700/50 dark:text-zinc-500">
            idle
          </span>
        )}
        {stats.count > 0 && (
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
            {stats.count}x
          </span>
        )}
        {avgMs != null && (
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            avg {avgMs.toFixed(1)}ms
          </span>
        )}
        {successRate != null && (
          <span
            className={`text-[10px] ${successRate === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
          >
            {successRate.toFixed(0)}%
          </span>
        )}
        {stats.errors > 0 && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-900/30 dark:text-red-400">
            {stats.errors} error{stats.errors !== 1 ? "s" : ""}
          </span>
        )}
        {(stats.errors > 0 || latestError) && (
          <button
            onClick={() => onToggle(name)}
            aria-expanded={isExpanded}
            className="ml-auto cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          >
            {isExpanded ? "Hide" : "Error"}
          </button>
        )}
      </div>
      {/* Duration bar */}
      {stats.count > 0 && (
        <div className="mx-2 mb-1.5 h-1 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-900/20">
          <div
            className="h-full rounded-full bg-indigo-400 dark:bg-indigo-500 transition-all"
            style={{ width: `${durationBarWidth}%` }}
          />
        </div>
      )}
      {isExpanded && latestError && (
        <div className="border-t border-indigo-200 px-3 py-1.5 dark:border-indigo-800/30">
          <div className="text-[10px] text-red-600 dark:text-red-400">
            {latestError}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PipelineView — main export
// ---------------------------------------------------------------------------

export function PipelineView() {
  const system = useDevToolsSystem();
  const connected = useSelector(system, (s) => s.facts.runtime.connected);
  const constraints = useSelector(system, (s) => s.facts.runtime.constraints);
  const inflight = useSelector(system, (s) => s.facts.runtime.inflight);
  const unmet = useSelector(system, (s) => s.facts.runtime.unmet);
  const resolverStats = useSelector(
    system,
    (s) => s.facts.runtime.resolverStats,
  );
  const resolverDefs = useSelector(
    system,
    (s) => s.facts.runtime.resolverDefs,
  ) as RuntimeResolverDef[];
  const traceLog = useSelector(system, (s) => s.facts.runtime.trace);
  const systemName = useSelector(system, (s) => s.facts.runtime.systemName);
  const traceEnabled = useSelector(
    system,
    (s) => s.facts.runtime.traceEnabled,
  );
  const latestTrace = useSelector(
    system,
    (s) => s.derive.runtime.latestTrace,
  ) as TraceEntry | null;
  const traceCount = useSelector(
    system,
    (s) => s.derive.runtime.traceCount,
  ) as number;

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [now, setNow] = useState(Date.now);

  // Tick every second so relative timestamps stay fresh
  const hasAnyLastActiveAt = constraints.some(
    (c) => c.lastActiveAt != null && c.lastActiveAt > 0,
  );
  useEffect(() => {
    if (!hasAnyLastActiveAt) {
      return;
    }

    const id = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(id);
  }, [hasAnyLastActiveAt]);

  const toggleItem = useCallback((id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }, []);

  const handleToggleDisable = useCallback(
    (c: Constraint) => {
      try {
        if (typeof window === "undefined" || !window.__DIRECTIVE__) {
          return;
        }

        const sys = window.__DIRECTIVE__.getSystem(systemName ?? undefined);
        if (!sys) {
          return;
        }

        if (c.disabled) {
          sys.constraints.enable(c.id);
        } else {
          sys.constraints.disable(c.id);
        }
      } catch (err) {
        console.error("[DevTools] Failed to toggle constraint:", c.id, err);

        return;
      }

      // Force DevTools to re-inspect immediately (separate try-catch so toggle errors aren't masked)
      try {
        system.events.runtime.forceSync();
      } catch (err) {
        console.warn("[DevTools] forceSync failed after toggle:", err);
      }
    },
    [systemName, system],
  );

  // Merge inflight + unmet into unified requirements list
  const allRequirements: Requirement[] = [...inflight, ...unmet];

  // Merge resolverDefs (all defined resolvers) with resolverStats (runtime stats)
  // This ensures resolvers always show even before they've executed
  const resolverEntries = useMemo(() => {
    const statsEntries = Object.entries(resolverStats);
    if (resolverDefs.length === 0) {
      return statsEntries;
    }

    const seen = new Set(statsEntries.map(([name]) => name));
    const merged = [...statsEntries];
    for (const def of resolverDefs) {
      if (!seen.has(def.id)) {
        merged.push([def.id, { count: 0, totalMs: 0, errors: 0 }]);
      }
    }

    return merged;
  }, [resolverStats, resolverDefs]);

  // Derive requirement types from resolverDefs for display
  const requirementTypes = useMemo(() => {
    if (resolverDefs.length === 0) {
      return [];
    }

    const types = new Set<string>();
    for (const def of resolverDefs) {
      if (def.requirement && def.requirement !== "(predicate)") {
        types.add(def.requirement);
      }
    }

    return [...types];
  }, [resolverDefs]);

  // Build resolver-to-requirement mapping for display
  const resolverRequirementMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const def of resolverDefs) {
      map.set(def.id, def.requirement);
    }

    return map;
  }, [resolverDefs]);

  const totalCount = constraints.length + resolverEntries.length;

  // Filter — memoize to stabilize references for downstream useMemos
  // (must be called unconditionally to satisfy React's rules of hooks)
  const lowerFilter = filter.toLowerCase();
  const filteredConstraints = useMemo(
    () =>
      filter
        ? constraints.filter((c) => c.id.toLowerCase().includes(lowerFilter))
        : constraints,
    [constraints, lowerFilter, filter],
  );
  const filteredRequirements = useMemo(
    () =>
      filter
        ? allRequirements.filter(
            (r) =>
              r.type.toLowerCase().includes(lowerFilter) ||
              r.fromConstraint.toLowerCase().includes(lowerFilter),
          )
        : allRequirements,
    [allRequirements, lowerFilter, filter],
  );
  const filteredResolvers = useMemo(
    () =>
      filter
        ? resolverEntries.filter(([name]) =>
            name.toLowerCase().includes(lowerFilter),
          )
        : resolverEntries,
    [resolverEntries, lowerFilter, filter],
  );

  // Sort disabled constraints to the bottom
  const sortedConstraints = useMemo(() => {
    if (!filteredConstraints.some((c) => c.disabled)) {
      return filteredConstraints;
    }

    return [...filteredConstraints].sort((a, b) => {
      if (a.disabled === b.disabled) {
        return 0;
      }

      return a.disabled ? 1 : -1;
    });
  }, [filteredConstraints]);

  if (!connected) {
    return (
      <EmptyState
        message="No Directive system connected"
        docsUrl="/docs/plugins/devtools"
      />
    );
  }

  if (
    constraints.length === 0 &&
    allRequirements.length === 0 &&
    resolverEntries.length === 0 &&
    requirementTypes.length === 0
  ) {
    return <EmptyState message="No constraints, requirements, or resolvers" />;
  }

  const hasResults =
    filteredConstraints.length > 0 ||
    filteredRequirements.length > 0 ||
    filteredResolvers.length > 0;
  const maxResolverCount = Math.max(
    ...resolverEntries.map(([, s]) => s.count),
    1,
  );
  const hasTrace = traceLog && traceLog.length > 0;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Zone 1: Header bar */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Pipeline
          <span className="ml-2 font-mono font-normal text-zinc-400 dark:text-zinc-500">
            {totalCount}
          </span>
        </h4>
        <input
          type="text"
          placeholder="Filter..."
          aria-label="Filter pipeline"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-40 rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-[11px] text-zinc-700 placeholder-zinc-400 outline-none focus:border-sky-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:placeholder-zinc-500"
        />
      </div>

      {/* Zone 2: Latest Trace Summary */}
      {hasTrace && latestTrace && <LatestTraceSummary run={latestTrace} />}

      {!hasTrace && traceEnabled && (
        <div className="rounded border border-dashed border-zinc-200 px-3 py-2 text-center font-mono text-[10px] text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
          Waiting for first reconciliation...
        </div>
      )}

      {!traceEnabled && (
        <div className="rounded border border-dashed border-zinc-200 px-3 py-2 text-center font-mono text-[10px] text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
          Enable{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
            trace: true
          </code>{" "}
          in debug config for pipeline timeline
        </div>
      )}

      {!hasResults && filter && (
        <EmptyState message={`No results matching "${filter}"`} />
      )}

      {/* Zone 3: Current State */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">
        {/* Constraints */}
        {sortedConstraints.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              Constraints
              <span className="ml-2 font-mono font-normal text-emerald-500 dark:text-emerald-500">
                {sortedConstraints.length}
              </span>
            </h4>
            <div className="space-y-1">
              {sortedConstraints.map((c) => (
                <ConstraintRow
                  key={c.id}
                  c={c}
                  now={now}
                  latestTrace={latestTrace}
                  isExpanded={expandedItems.has(`c:${c.id}`)}
                  onToggle={(id) => toggleItem(`c:${id}`)}
                  onToggleDisable={handleToggleDisable}
                />
              ))}
            </div>
          </div>
        )}

        {/* Requirements (active inflight + unmet, or defined types when idle) */}
        {(filteredRequirements.length > 0 || requirementTypes.length > 0) && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Requirements
              <span className="ml-2 font-mono font-normal text-amber-500 dark:text-amber-500">
                {filteredRequirements.length > 0
                  ? filteredRequirements.length
                  : requirementTypes.length}
              </span>
            </h4>
            <div className="space-y-1">
              {filteredRequirements.length > 0
                ? filteredRequirements.map((r, i) => (
                    <RequirementRow
                      key={`${r.id}:${r.fromConstraint}:${i}`}
                      r={r}
                      latestTrace={latestTrace}
                      resolverStats={resolverStats}
                      isExpanded={expandedItems.has(`r:${r.id}`)}
                      onToggle={(id) => toggleItem(`r:${id}`)}
                    />
                  ))
                : requirementTypes.map((type) => (
                    <div
                      key={type}
                      className="rounded bg-zinc-50 px-2 py-1.5 font-mono text-xs dark:bg-zinc-800/30"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="h-2 w-2 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600"
                          aria-hidden="true"
                        />
                        <span className="text-zinc-500 dark:text-zinc-400">
                          {type}
                        </span>
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] text-zinc-400 dark:bg-zinc-700/50 dark:text-zinc-500">
                          idle
                        </span>
                      </div>
                    </div>
                  ))}
            </div>
          </div>
        )}

        {/* Resolvers */}
        {filteredResolvers.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
              Resolvers
              <span className="ml-2 font-mono font-normal text-indigo-500 dark:text-indigo-500">
                {filteredResolvers.length}
              </span>
            </h4>
            <div className="space-y-1">
              {filteredResolvers.map(([name, stats]) => (
                <ResolverRow
                  key={name}
                  name={name}
                  stats={stats}
                  maxCount={maxResolverCount}
                  latestTrace={latestTrace}
                  requirementType={resolverRequirementMap.get(name)}
                  isExpanded={expandedItems.has(`res:${name}`)}
                  onToggle={(n) => toggleItem(`res:${n}`)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
