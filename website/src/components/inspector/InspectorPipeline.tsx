"use client";

import { useSelector } from "@directive-run/react";
import { useMemo } from "react";
import { useDevToolsSystem } from "../devtools/DevToolsSystemContext";
import type {
  RuntimeConstraintInfo,
  RuntimeRequirementInfo,
  RuntimeResolverDef,
} from "../devtools/modules/devtools-runtime";

export function InspectorPipeline() {
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

  const allRequirements: RuntimeRequirementInfo[] = [...inflight, ...unmet];

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

  const resolverRequirementMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const def of resolverDefs) {
      map.set(def.id, def.requirement);
    }

    return map;
  }, [resolverDefs]);

  if (!connected) {
    return (
      <div className="py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Connecting...
      </div>
    );
  }

  if (
    constraints.length === 0 &&
    allRequirements.length === 0 &&
    resolverEntries.length === 0
  ) {
    return (
      <div className="py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
        No constraints, requirements, or resolvers
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Constraints */}
      {constraints.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            Constraints
            <span className="font-mono font-normal text-emerald-500">
              {constraints.length}
            </span>
          </div>
          <div className="space-y-0.5">
            {constraints.map((c) => (
              <ConstraintRow key={c.id} c={c} />
            ))}
          </div>
        </div>
      )}

      {/* Requirements */}
      {allRequirements.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Requirements
            <span className="font-mono font-normal text-amber-500">
              {allRequirements.length}
            </span>
          </div>
          <div className="space-y-0.5">
            {allRequirements.map((r, i) => (
              <RequirementRow key={`${r.id}:${i}`} r={r} />
            ))}
          </div>
        </div>
      )}

      {/* Resolvers */}
      {resolverEntries.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            Resolvers
            <span className="font-mono font-normal text-indigo-500">
              {resolverEntries.length}
            </span>
          </div>
          <div className="space-y-0.5">
            {resolverEntries.map(([name, stats]) => (
              <ResolverRow
                key={name}
                name={name}
                stats={stats}
                requirementType={resolverRequirementMap.get(name)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConstraintRow({ c }: { c: RuntimeConstraintInfo }) {
  const dotClass = c.disabled
    ? "bg-red-400"
    : c.active
      ? "bg-emerald-500"
      : "bg-zinc-400";

  return (
    <div className="flex items-center gap-2 rounded px-2 py-1 font-mono text-[11px]">
      <div
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}
        aria-hidden="true"
      />
      <span
        className={
          c.disabled
            ? "text-red-400 line-through dark:text-red-500"
            : c.active
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-zinc-500"
        }
      >
        {c.id}
      </span>
      {c.priority !== undefined && (
        <span className="rounded bg-zinc-200 px-1 py-px text-[9px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400">
          p{c.priority}
        </span>
      )}
      {c.hitCount > 0 && (
        <span className="rounded bg-sky-100 px-1 py-px text-[9px] text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
          &times;{c.hitCount}
        </span>
      )}
    </div>
  );
}

function RequirementRow({ r }: { r: RuntimeRequirementInfo }) {
  const isInflight = r.status === "inflight";

  return (
    <div className="flex items-center gap-2 rounded px-2 py-1 font-mono text-[11px]">
      <div
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${isInflight ? "animate-pulse bg-amber-500" : "bg-red-500"}`}
        aria-hidden="true"
      />
      <span
        className={
          isInflight
            ? "text-amber-700 dark:text-amber-400"
            : "text-red-700 dark:text-red-400"
        }
      >
        {r.type}
      </span>
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
    </div>
  );
}

function ResolverRow({
  name,
  stats,
  requirementType,
}: {
  name: string;
  stats: { count: number; errors: number; totalMs?: number };
  requirementType?: string;
}) {
  const isIdle = stats.count === 0 && stats.errors === 0;
  const successRate =
    stats.count > 0 ? ((stats.count - stats.errors) / stats.count) * 100 : null;

  return (
    <div className="flex items-center gap-2 rounded px-2 py-1 font-mono text-[11px]">
      <div
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${isIdle ? "bg-zinc-300 dark:bg-zinc-600" : "bg-indigo-500"}`}
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
        <span className="rounded bg-zinc-100 px-1 py-px text-[9px] text-zinc-400 dark:bg-zinc-700/50 dark:text-zinc-500">
          idle
        </span>
      )}
      {stats.count > 0 && (
        <span className="rounded bg-indigo-100 px-1 py-px text-[9px] text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
          {stats.count}x
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
        <span className="rounded bg-red-100 px-1 py-px text-[9px] text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {stats.errors} err
        </span>
      )}
    </div>
  );
}
