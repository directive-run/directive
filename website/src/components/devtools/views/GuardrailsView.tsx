"use client";

import { useSelector } from "@directive-run/react";
import { useMemo, useState } from "react";
import { useDevToolsSystem } from "../DevToolsSystemContext";
import { EmptyState } from "../EmptyState";
import { GUARDRAIL_INFO } from "../constants";

// Guardrail aggregation wrapped in useMemo

export function GuardrailsView() {
  const system = useDevToolsSystem();
  const events = useSelector(system, (s) => s.facts.connection.events);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Memoize guardrail filtering and aggregation
  const { guardrailEvents, guardrails, totalChecks, totalBlocked, passRate } =
    useMemo(() => {
      const gEvents = events.filter((e) => e.type === "guardrail_check");

      const guardrailMap = new Map<
        string,
        {
          total: number;
          passed: number;
          blocked: number;
          totalMs: number;
          type: string | null;
          lastReason: string | null;
        }
      >();
      for (const e of gEvents) {
        const name = e.guardrailName ?? "unknown";
        const prev = guardrailMap.get(name) ?? {
          total: 0,
          passed: 0,
          blocked: 0,
          totalMs: 0,
          type: null,
          lastReason: null,
        };
        const didPass = e.passed !== false;
        guardrailMap.set(name, {
          total: prev.total + 1,
          passed: prev.passed + (didPass ? 1 : 0),
          blocked: prev.blocked + (didPass ? 0 : 1),
          totalMs: prev.totalMs + (e.durationMs ?? 0),
          type: (e.guardrailType as string) ?? prev.type,
          lastReason:
            !didPass && e.reason ? (e.reason as string) : prev.lastReason,
        });
      }

      const gList = Array.from(guardrailMap.entries()).map(([name, data]) => ({
        name,
        ...data,
      }));
      const tChecks = gEvents.length;
      const tBlocked = gList.reduce((s, g) => s + g.blocked, 0);
      const rate = tChecks > 0 ? ((tChecks - tBlocked) / tChecks) * 100 : 100;

      return {
        guardrailEvents: gEvents,
        guardrails: gList,
        totalChecks: tChecks,
        totalBlocked: tBlocked,
        passRate: rate,
      };
    }, [events]);

  if (guardrailEvents.length === 0) {
    return <EmptyState message="No guardrail checks recorded yet." />;
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Summary */}
      <div className="flex flex-wrap gap-6 text-xs">
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Total checks</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">
            {totalChecks}
          </div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Passed</span>
          <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
            {totalChecks - totalBlocked}
          </div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Blocked</span>
          <div
            className={`text-lg font-semibold ${totalBlocked > 0 ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-white"}`}
          >
            {totalBlocked}
          </div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Pass rate</span>
          <div
            className={`text-lg font-semibold ${passRate === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
          >
            {passRate.toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Pass rate bar */}
      <div className="flex h-4 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
        <div
          className="bg-emerald-500 transition-all"
          style={{ width: `${passRate}%` }}
          title={`${totalChecks - totalBlocked} passed`}
        />
        {totalBlocked > 0 && (
          <div
            className="bg-red-500 transition-all"
            style={{ width: `${100 - passRate}%` }}
            title={`${totalBlocked} blocked`}
          />
        )}
      </div>

      {/* Per-guardrail cards */}
      <div className="space-y-2">
        {guardrails.map((g) => {
          const info = GUARDRAIL_INFO[g.name];
          const rate =
            g.total > 0 ? ((g.passed / g.total) * 100).toFixed(0) : "100";
          const avgMs = g.total > 0 ? Math.round(g.totalMs / g.total) : 0;
          const isExpanded = expanded === g.name;

          return (
            <div
              key={g.name}
              className="rounded border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50"
            >
              <button
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left"
                onClick={() => setExpanded(isExpanded ? null : g.name)}
              >
                {/* Status dot */}
                <span
                  className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${g.blocked > 0 ? "bg-red-500" : "bg-emerald-500"}`}
                />

                {/* Name + type badge */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium text-zinc-900 dark:text-white">
                      {g.name}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        (info?.type ?? g.type) === "input"
                          ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
                          : "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
                      }`}
                    >
                      {info?.type ?? g.type ?? "input"}
                    </span>
                  </div>
                  {info && (
                    <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {info.description}
                    </div>
                  )}
                </div>

                {/* Stats summary */}
                <div className="flex shrink-0 items-center gap-3 text-[11px]">
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {g.total} checks
                  </span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    {rate}%
                  </span>
                  <span className="text-zinc-400 dark:text-zinc-500">
                    {avgMs}ms
                  </span>
                  <span
                    className={`text-xs transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  >
                    ▾
                  </span>
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
                  <div className="grid grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        Checks
                      </span>
                      <div className="font-semibold text-zinc-900 dark:text-white">
                        {g.total}
                      </div>
                    </div>
                    <div>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        Passed
                      </span>
                      <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {g.passed}
                      </div>
                    </div>
                    <div>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        Blocked
                      </span>
                      <div
                        className={`font-semibold ${g.blocked > 0 ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-white"}`}
                      >
                        {g.blocked}
                      </div>
                    </div>
                    <div>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        Avg latency
                      </span>
                      <div className="font-semibold text-zinc-900 dark:text-white">
                        {avgMs}ms
                      </div>
                    </div>
                  </div>

                  {g.lastReason && (
                    <div className="mt-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-900/20 dark:text-red-400">
                      Last block reason: {g.lastReason}
                    </div>
                  )}

                  {/* Recent events for this guardrail */}
                  <div className="mt-2">
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Recent
                    </div>
                    <div className="space-y-0.5">
                      {[...guardrailEvents]
                        .filter((e) => e.guardrailName === g.name)
                        .reverse()
                        .slice(0, 5)
                        .map((e) => (
                          <div
                            key={e.id}
                            className="flex items-center gap-2 font-mono text-[10px]"
                          >
                            <span
                              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${e.passed !== false ? "bg-emerald-500" : "bg-red-500"}`}
                            />
                            <span className="text-zinc-400 dark:text-zinc-500">
                              {e.durationMs ?? 0}ms
                            </span>
                            {e.passed === false && e.reason && (
                              <span className="truncate text-red-500 dark:text-red-400">
                                {e.reason}
                              </span>
                            )}
                            {e.passed !== false && (
                              <span className="text-emerald-600 dark:text-emerald-400">
                                passed
                              </span>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent guardrail events (all) */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          All recent checks
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {[...guardrailEvents]
            .reverse()
            .slice(0, 20)
            .map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2 font-mono text-[11px]"
              >
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${e.passed !== false ? "bg-emerald-500" : "bg-red-500"}`}
                />
                <span className="text-zinc-500 dark:text-zinc-400">
                  {e.guardrailName ?? "unknown"}
                </span>
                {e.durationMs != null && (
                  <span className="text-zinc-400 dark:text-zinc-500">
                    {e.durationMs}ms
                  </span>
                )}
                {e.passed === false && e.reason && (
                  <span className="truncate text-red-500 dark:text-red-400">
                    {e.reason}
                  </span>
                )}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
