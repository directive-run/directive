/**
 * The Directive Job — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the mission board, sidebar, and event log.
 */

import { createSystem } from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import { AGENTS, AGENT_ORDER, getApiKey } from "./agents.js";
import { advanceStep, heistModule } from "./goal-module.js";
import type { NodeStatus, StrategyId } from "./goal-module.js";

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: heistModule,
  debug: { runHistory: true },
  plugins: [devtoolsPlugin({ name: "goal-heist" })],
});
system.start();

// ============================================================================
// DOM References
// ============================================================================

const $ = (id: string) => document.getElementById(id)!;

const apiKeyBar = $("apiKeyBar");
const apiKeyInput = $("apiKeyInput") as HTMLInputElement;
const apiKeySave = $("apiKeySave");
const apiKeySaved = $("apiKeySaved");

const btnRun = $("btnRun") as HTMLButtonElement;
const btnStep = $("btnStep") as HTMLButtonElement;
const btnReset = $("btnReset") as HTMLButtonElement;
const strategySelect = $("strategySelect") as HTMLSelectElement;
const chkFailHacker = $("chkFailHacker") as HTMLInputElement;
const chkFailForger = $("chkFailForger") as HTMLInputElement;

const summaryText = $("summaryText");
const satisfactionFill = $("satisfactionFill");
const satisfactionLabel = $("satisfactionLabel");
const factsList = $("factsList");
const strategyBadge = $("strategyBadge");
const crewList = $("crewList");
const statStep = $("statStep");
const statTokens = $("statTokens");
const statAvg = $("statAvg");
const logEntries = $("logEntries");
const mobileSatisfaction = $("mobileSatisfaction");
const mobileStep = $("mobileStep");

// ============================================================================
// Event Handlers
// ============================================================================

// API Key
if (getApiKey()) {
  apiKeyBar.classList.add("hidden");
}

apiKeySave.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();

  if (key) {
    system.dispatch({ type: "setApiKey", key });
    apiKeySaved.style.display = "inline";
    apiKeyInput.value = "";
    setTimeout(() => {
      apiKeyBar.classList.add("hidden");
    }, 1000);
  }
});

// Controls
btnRun.addEventListener("click", () => {
  const { status, stepMode } = system.facts;

  if (status === "idle") {
    system.dispatch({ type: "start" });
  } else if (status === "running" && stepMode) {
    // Continue auto from step mode
    system.dispatch({ type: "setStepMode", enabled: false });
    advanceStep();
  }
});

btnStep.addEventListener("click", () => {
  const status = system.facts.status;

  if (status === "idle") {
    system.dispatch({ type: "step" });
  } else if (status === "running" && system.facts.stepMode) {
    advanceStep();
  }
});

btnReset.addEventListener("click", () => {
  system.dispatch({ type: "reset" });
  lastRenderedLogCount = 0;
  logEntries.innerHTML = "";
});

strategySelect.addEventListener("change", () => {
  system.dispatch({
    type: "changeStrategy",
    strategy: strategySelect.value as StrategyId,
  });
});

chkFailHacker.addEventListener("change", () => {
  system.dispatch({
    type: "toggleFailHacker",
    enabled: chkFailHacker.checked,
  });
});

chkFailForger.addEventListener("change", () => {
  system.dispatch({
    type: "toggleFailForger",
    enabled: chkFailForger.checked,
  });
});

// Node clicks
document.querySelectorAll("[data-node]").forEach((el) => {
  (el as SVGElement).setAttribute("tabindex", "0");
  el.addEventListener("click", () => {
    const nodeId = (el as HTMLElement).dataset.node!;
    system.dispatch({ type: "selectNode", nodeId });
  });
  el.addEventListener("keydown", (e) => {
    if (
      (e as KeyboardEvent).key === "Enter" ||
      (e as KeyboardEvent).key === " "
    ) {
      (e as Event).preventDefault();
      const nodeId = (el as HTMLElement).dataset.node!;
      system.dispatch({ type: "selectNode", nodeId });
    }
  });
});

// ============================================================================
// Rendering
// ============================================================================

const STATUS_COLORS: Record<NodeStatus, string> = {
  pending: "#475569",
  ready: "#3b82f6",
  running: "#fbbf24",
  completed: "#4ade80",
  failed: "#ef4444",
};

const EDGE_MAP: [string, string, string][] = [
  ["gigi", "h4x", "gigi-h4x"],
  ["felix", "luca", "felix-luca"],
  ["h4x", "luca", "h4x-luca"],
  ["vince", "ollie", "vince-ollie"],
  ["luca", "ollie", "luca-ollie"],
];

const FACT_KEYS = [
  "guard_schedule",
  "blueprints",
  "escape_route",
  "cameras_disabled",
  "vault_cracked",
  "all_clear",
];

let lastRenderedLogCount = 0;
let renderRAF = 0;

function scheduleRender() {
  if (!renderRAF) {
    renderRAF = requestAnimationFrame(() => {
      renderRAF = 0;
      render();
    });
  }
}

function render() {
  const facts = system.facts;
  const nodeStatuses = facts.nodeStatuses;
  const goalFacts = facts.goalFacts;
  const stepHistory = facts.stepHistory;
  const relaxations = facts.relaxations;
  const progressPercent = Number(system.read("progressPercent") ?? 0);
  const summaryStr = String(system.read("summaryText") ?? "");
  const isStalled = Boolean(system.read("isStalled"));
  const status = facts.status;
  const achieved = facts.achieved;
  const selectedStrategy = facts.selectedStrategy;
  const selectedNode = facts.selectedNode;

  // ── Summary text ──
  summaryText.textContent = summaryStr;
  summaryText.className = `heist-status${isStalled ? " stalled" : ""}`;

  // ── Button states ──
  const isIdle = status === "idle";
  const isRunning = status === "running";
  const isDone = status === "completed" || status === "error";
  const inStepMode = isRunning && facts.stepMode;

  btnRun.disabled = (isRunning && !facts.stepMode) || isDone;
  btnRun.textContent = isIdle
    ? "Run Heist"
    : inStepMode
      ? "Continue Auto"
      : isRunning
        ? "Running..."
        : achieved
          ? "Complete"
          : "Run Heist";
  btnStep.disabled = isDone;
  btnReset.disabled = isIdle;
  chkFailHacker.disabled = !isIdle;
  chkFailForger.disabled = !isIdle;

  // ── SVG nodes ──
  for (const id of AGENT_ORDER) {
    const nodeStatus = (nodeStatuses[id] ?? "pending") as NodeStatus;
    const group = document.querySelector(`[data-node="${id}"]`);

    if (!group) {
      continue;
    }

    const rect = group.querySelector("rect")!;
    const label = group.querySelector(`[data-status-label="${id}"]`)!;
    const isSelected = selectedNode === id;

    rect.setAttribute("stroke", STATUS_COLORS[nodeStatus]);

    if (nodeStatus === "running") {
      rect.setAttribute("stroke-width", "2.5");
      (rect as SVGElement).style.animation = "pulse 1s infinite";
    } else if (nodeStatus === "failed") {
      rect.setAttribute("stroke-width", "2.5");
      (rect as SVGElement).style.animation = "shake 0.3s";
    } else {
      rect.setAttribute("stroke-width", isSelected ? "2.5" : "1.5");
      (rect as SVGElement).style.animation = "";
    }

    // Highlight selected node
    if (isSelected && nodeStatus !== "running" && nodeStatus !== "failed") {
      rect.setAttribute("stroke", "#a78bfa");
    }

    if (nodeStatus === "completed") {
      const agent = AGENTS[id];
      label.textContent = `\u2713 ${agent.produces[0]}`;
      label.setAttribute("fill", "#4ade80");
    } else if (nodeStatus === "failed") {
      label.textContent = "\u2717 failed";
      label.setAttribute("fill", "#ef4444");
    } else {
      label.textContent = nodeStatus;
      label.setAttribute("fill", "#64748b");
    }
  }

  // ── SVG edges ──
  for (const [from, to, edgeId] of EDGE_MAP) {
    const line = document.querySelector(`[data-edge="${edgeId}"]`);

    if (!line) {
      continue;
    }

    const fromStatus = (nodeStatuses[from] ?? "pending") as NodeStatus;
    const toStatus = (nodeStatuses[to] ?? "pending") as NodeStatus;

    if (toStatus === "completed") {
      line.setAttribute("stroke", "#4ade80");
      line.setAttribute("stroke-dasharray", "");
    } else if (toStatus === "running" || fromStatus === "completed") {
      line.setAttribute("stroke", "#fbbf24");
      line.setAttribute("stroke-dasharray", "6,3");
    } else {
      line.setAttribute("stroke", "#334155");
      line.setAttribute("stroke-dasharray", "6,3");
    }
  }

  // ── Sidebar: satisfaction ──
  satisfactionFill.style.width = `${progressPercent}%`;
  satisfactionLabel.textContent = `${progressPercent}%`;

  // ── Mobile: compact stats ──
  mobileSatisfaction.textContent = `${progressPercent}%`;
  mobileStep.textContent = `Step ${facts.currentStep}`;

  // ── Sidebar: facts (createElement, no innerHTML) ──
  factsList.textContent = "";

  for (const key of FACT_KEYS) {
    const hasValue = goalFacts[key] != null;
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = hasValue ? "fact-check" : "fact-empty";
    dot.textContent = hasValue ? "\u25CF" : "\u25CB";
    const label = document.createElement("span");
    label.className = "fact-key";
    label.textContent = key;
    li.append(dot, label);
    factsList.appendChild(li);
  }

  // ── Sidebar: strategy ──
  strategyBadge.textContent = selectedStrategy;

  // ── Sidebar: crew (createElement, no innerHTML) ──
  crewList.textContent = "";

  for (const id of AGENT_ORDER) {
    const agent = AGENTS[id];
    const nodeStatus = (nodeStatuses[id] ?? "pending") as NodeStatus;
    const tokens = facts.nodeTokens[id] ?? 0;
    const row = document.createElement("div");
    row.className = "agent-row";
    const dot = document.createElement("span");
    dot.className = `agent-dot ${nodeStatus}`;
    const name = document.createElement("span");
    name.className = "agent-name";
    name.textContent = `${agent.emoji} ${agent.name}`;
    const tok = document.createElement("span");
    tok.className = "agent-tokens";
    tok.textContent = tokens > 0 ? `${tokens}t` : "";
    row.append(dot, name, tok);
    crewList.appendChild(row);
  }

  // ── Sidebar: stats ──
  statStep.textContent = String(facts.currentStep);
  statTokens.textContent = String(facts.totalTokens);
  statAvg.textContent = String(Number(system.read("avgTokensPerStep") ?? 0));

  // ── Event log (append only new entries, no innerHTML) ──
  const totalEntries = stepHistory.length + relaxations.length;

  if (
    totalEntries > lastRenderedLogCount ||
    (achieved && !logEntries.querySelector(".completion"))
  ) {
    // Render new step entries
    for (let i = lastRenderedLogCount; i < stepHistory.length; i++) {
      const entry = stepHistory[i];
      const names = entry.nodesRun
        .map((nid) => AGENTS[nid]?.name ?? nid)
        .join(", ");
      const deltaClass = entry.satisfactionDelta > 0 ? "" : "zero";
      const deltaSign = entry.satisfactionDelta > 0 ? "+" : "";

      const div = document.createElement("div");
      div.className = "log-entry";
      const stepSpan = document.createElement("span");
      stepSpan.className = "log-step";
      stepSpan.textContent = `Step ${entry.step}:`;
      const deltaSpan = document.createElement("span");
      deltaSpan.className = `log-delta ${deltaClass}`;
      deltaSpan.textContent = `${deltaSign}${(entry.satisfactionDelta * 100).toFixed(0)}%`;
      div.append(stepSpan, ` ${names} `, deltaSpan);
      logEntries.appendChild(div);
    }

    // Render relaxation entries
    for (const rel of relaxations) {
      const existing = logEntries.querySelector(
        `[data-rel-step="${rel.step}-${rel.strategy}"]`,
      );

      if (!existing) {
        const div = document.createElement("div");
        div.className = "log-entry relaxation";
        div.setAttribute("data-rel-step", `${rel.step}-${rel.strategy}`);
        const relStep = document.createElement("span");
        relStep.className = "log-step";
        relStep.textContent = `\u26A0 Step ${rel.step}:`;
        div.append(relStep, ` ${rel.label} [${rel.strategy}]`);
        logEntries.appendChild(div);
      }
    }

    // Completion
    if (achieved && !logEntries.querySelector(".completion")) {
      const div = document.createElement("div");
      div.className = "log-entry completion";
      div.textContent = `\u2705 Mission complete! ${stepHistory.length} steps, ${facts.totalTokens} tokens.`;
      logEntries.appendChild(div);
    }

    // Error
    if (status === "error" && !logEntries.querySelector(".error")) {
      const div = document.createElement("div");
      div.className = "log-entry error";
      div.textContent = `\u274C ${facts.error}`;
      logEntries.appendChild(div);
    }

    lastRenderedLogCount = stepHistory.length;

    // Auto-scroll
    logEntries.scrollTop = logEntries.scrollHeight;
  }
}

// ============================================================================
// Subscribe & Initial Render
// ============================================================================

system.subscribe(
  [
    "status",
    "currentStep",
    "satisfaction",
    "nodeStatuses",
    "goalFacts",
    "stepHistory",
    "relaxations",
    "achieved",
    "error",
    "selectedStrategy",
    "selectedNode",
    "totalTokens",
    "nodeTokens",
    "nodeProduced",
    "stallCount",
    "stepMode",
  ],
  scheduleRender,
);

render();
