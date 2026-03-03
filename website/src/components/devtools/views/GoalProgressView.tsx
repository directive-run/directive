"use client";

import { useSelector } from "@directive-run/react";
import { useMemo, useState } from "react";
import { useDevToolsSystem } from "../DevToolsSystemContext";
import { EmptyState } from "../EmptyState";
import type { DebugEvent } from "../types";

// ---------------------------------------------------------------------------
// Types — aligned with GoalStepMetrics from @directive-run/ai
// ---------------------------------------------------------------------------

interface GoalStep {
  step: number;
  /** nodesRun in GoalStepMetrics — agents that ran this step */
  nodesRun: string[];
  satisfaction: number;
  satisfactionDelta: number;
  tokensConsumed: number;
  durationMs: number;
  factsProduced: string[];
}

interface GoalExecution {
  startTimestamp: number;
  endTimestamp: number | null;
  achieved: boolean | null;
  steps: GoalStep[];
  relaxations: Array<{ step: number; label: string; strategy: string }>;
  totalTokens: number;
  totalDurationMs: number;
  finalSatisfaction: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Event parsing — extract goal executions from the event stream
// ---------------------------------------------------------------------------

function isValidStep(s: unknown): s is GoalStep {
  if (typeof s !== "object" || s === null) {
    return false;
  }
  const obj = s as Record<string, unknown>;

  return (
    typeof obj.step === "number" &&
    Array.isArray(obj.nodesRun) &&
    typeof obj.satisfaction === "number" &&
    typeof obj.satisfactionDelta === "number"
  );
}

function extractGoalExecutions(events: DebugEvent[]): GoalExecution[] {
  const executions: GoalExecution[] = [];
  let current: GoalExecution | null = null;

  for (const e of events) {
    if (e.type === "pattern_start" && e.patternType === "goal") {
      current = {
        startTimestamp: e.timestamp,
        endTimestamp: null,
        achieved: null,
        steps: [],
        relaxations: [],
        totalTokens: 0,
        totalDurationMs: 0,
        finalSatisfaction: 0,
      };
    }

    if (e.type === "pattern_complete" && e.patternType === "goal" && current) {
      current.endTimestamp = e.timestamp;
      current.achieved = typeof e.achieved === "boolean" ? e.achieved : null;
      current.totalDurationMs =
        e.durationMs ?? e.timestamp - current.startTimestamp;
      current.totalTokens =
        typeof e.totalTokens === "number" ? e.totalTokens : current.totalTokens;
      current.error = typeof e.error === "string" ? e.error : undefined;

      // Accept stepMetrics from the event payload (validated per-item)
      const stepMetrics = e.stepMetrics;
      if (Array.isArray(stepMetrics)) {
        current.steps = stepMetrics.filter(isValidStep);
        if (current.steps.length > 0) {
          current.finalSatisfaction =
            current.steps[current.steps.length - 1].satisfaction;
        }
      }

      const relaxations = e.relaxations;
      if (Array.isArray(relaxations)) {
        current.relaxations = relaxations as GoalExecution["relaxations"];
      }

      executions.push(current);
      current = null;
    }

    // Build partial step data from goal_step events (live progress)
    if (current && e.type === "goal_step" && typeof e.step === "number") {
      const stepNum = e.step as number;
      const existing = current.steps.find((s) => s.step === stepNum);

      if (existing) {
        if (typeof e.nodeId === "string") {
          existing.nodesRun.push(e.nodeId as string);
        }
      } else {
        current.steps.push({
          step: stepNum,
          nodesRun: typeof e.nodeId === "string" ? [e.nodeId as string] : [],
          satisfaction:
            typeof e.satisfaction === "number" ? (e.satisfaction as number) : 0,
          satisfactionDelta:
            typeof e.satisfactionDelta === "number"
              ? (e.satisfactionDelta as number)
              : 0,
          tokensConsumed: 0,
          durationMs: 0,
          factsProduced: [],
        });
      }

      if (current.steps.length > 0) {
        current.finalSatisfaction =
          current.steps[current.steps.length - 1].satisfaction;
      }
    }

    // Accumulate tokens from agent completions during an active goal
    if (current && e.type === "agent_complete" && e.totalTokens) {
      current.totalTokens += e.totalTokens;
    }
  }

  // Include in-progress goal (no pattern_complete yet)
  if (current) {
    current.totalDurationMs =
      events.length > 0
        ? events[events.length - 1].timestamp - current.startTimestamp
        : 0;
    executions.push(current);
  }

  return executions;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GoalView() {
  const system = useDevToolsSystem();
  const events = useSelector(system, (s) => s.facts.connection.events);
  const executions = useMemo(() => extractGoalExecutions(events), [events]);
  const [selectedIdx, setSelectedIdx] = useState(-1);

  if (executions.length === 0) {
    return (
      <EmptyState message="No goal pattern executions detected. Run a goal pattern to see progress." />
    );
  }

  // Default to latest execution; allow selection if multiple exist
  const idx =
    selectedIdx >= 0 && selectedIdx < executions.length
      ? selectedIdx
      : executions.length - 1;
  const latest = executions[idx];

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Execution selector (E11: when multiple executions exist) */}
      {executions.length > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">Execution:</span>
          <select
            value={idx}
            onChange={(e) => setSelectedIdx(Number(e.target.value))}
            className="rounded border border-zinc-300 bg-white px-2 py-0.5 font-mono text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white"
            aria-label="Select goal execution"
          >
            {executions.map((ex, i) => (
              <option key={i} value={i}>
                #{i + 1} —{" "}
                {ex.achieved === true
                  ? "achieved"
                  : ex.achieved === false
                    ? "not achieved"
                    : "in progress"}
                {ex.steps.length > 0 ? ` (${ex.steps.length} steps)` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Summary stats */}
      <div className="flex flex-wrap gap-6 text-xs">
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Status</span>
          <div
            className={`text-lg font-semibold ${
              latest.achieved === true
                ? "text-emerald-600 dark:text-emerald-400"
                : latest.achieved === false
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {latest.achieved === true
              ? "Achieved"
              : latest.achieved === false
                ? "Not achieved"
                : "In progress"}
          </div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Steps</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">
            {latest.steps.length}
          </div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Satisfaction</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">
            {latest.finalSatisfaction.toFixed(3)}
          </div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Tokens</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">
            {latest.totalTokens.toLocaleString()}
          </div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Duration</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">
            {latest.totalDurationMs.toLocaleString()}ms
          </div>
        </div>
        {latest.relaxations.length > 0 && (
          <div>
            <span className="text-zinc-500 dark:text-zinc-400">
              Relaxations
            </span>
            <div className="text-lg font-semibold text-amber-600 dark:text-amber-400">
              {latest.relaxations.length}
            </div>
          </div>
        )}
      </div>

      {/* Error display */}
      {latest.error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 font-mono text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {latest.error}
        </div>
      )}

      {/* Explanatory snippet */}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Each step dispatches agents toward the goal, collects their output as
        facts, and re-evaluates satisfaction (0&rarr;1) &mdash; how close the
        goal is to being met. Satisfaction can plateau or dip along the way.
      </p>

      {/* Per-step table (E8: overflow-x-auto for mobile) */}
      {latest.steps.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                <th className="py-1 text-left font-medium">Step</th>
                <th className="py-1 text-left font-medium">Agents</th>
                <th
                  className="py-1 text-left font-medium"
                  title={"0\u20131 score measuring goal completion"}
                >
                  Satisfaction
                </th>
                <th
                  className="py-1 text-right font-medium"
                  title="Change in satisfaction from previous step"
                >
                  Delta
                </th>
                <th className="py-1 text-right font-medium">Tokens</th>
                <th className="py-1 text-right font-medium">Duration</th>
                <th
                  className="py-1 text-right font-medium"
                  title="Data produced by agents this step"
                >
                  Facts
                </th>
              </tr>
            </thead>
            <tbody className="text-zinc-700 dark:text-zinc-300">
              {latest.steps.map((step) => {
                const hasRelaxation = latest.relaxations.some(
                  (r) => r.step === step.step,
                );

                return (
                  <tr
                    key={step.step}
                    className="border-b border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-1.5 font-mono">
                      <span className="flex items-center gap-1.5">
                        {step.step}
                        {hasRelaxation && (
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400"
                            title="Relaxation applied"
                          />
                        )}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {step.nodesRun.map((agent) => (
                          <span
                            key={agent}
                            className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-mono dark:bg-zinc-700"
                          >
                            {agent}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-1.5 font-mono">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-zinc-200 dark:bg-zinc-700">
                          <div
                            className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400"
                            style={{
                              width: `${(step.satisfaction * 100).toFixed(1)}%`,
                            }}
                          />
                        </div>
                        <span>{step.satisfaction.toFixed(3)}</span>
                      </div>
                    </td>
                    <td
                      className={`py-1.5 text-right font-mono ${
                        step.satisfactionDelta > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : step.satisfactionDelta < 0
                            ? "text-red-600 dark:text-red-400"
                            : ""
                      }`}
                    >
                      {step.satisfactionDelta >= 0 ? "+" : ""}
                      {step.satisfactionDelta.toFixed(3)}
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      {step.tokensConsumed.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      {step.durationMs}ms
                    </td>
                    <td className="py-1.5 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {step.factsProduced.length > 0 ? (
                          step.factsProduced.map((fact) => (
                            <span
                              key={fact}
                              className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-mono dark:bg-zinc-700"
                            >
                              {fact}
                            </span>
                          ))
                        ) : (
                          <span className="text-zinc-400 dark:text-zinc-500">
                            -
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Relaxation events (E10: aria-label) */}
      {latest.relaxations.length > 0 && (
        <div
          className="rounded border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
          role="region"
          aria-label="Relaxation events applied"
        >
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Relaxations applied
          </div>
          <div className="space-y-1.5">
            {latest.relaxations.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="shrink-0 font-mono text-zinc-500 dark:text-zinc-400">
                  Step {r.step}
                </span>
                <span className="rounded bg-amber-200/50 px-1.5 py-0.5 font-mono text-[10px] text-amber-800 dark:bg-amber-800/30 dark:text-amber-300">
                  {r.strategy}
                </span>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {r.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
