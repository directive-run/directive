/**
 * Topic Guard — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * and renders the chat UI + guardrail log + stats to the DOM.
 */

import { createSystem } from "@directive-run/core";
import {
  topicGuardModule,
  topicGuardSchema,
  type ChatMessage,
  type GuardrailLogEntry,
} from "./topic-guard.js";

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: topicGuardModule,
});
system.start();

const allKeys = [
  ...Object.keys(topicGuardSchema.facts),
  ...Object.keys(topicGuardSchema.derivations),
];

// ============================================================================
// DOM References
// ============================================================================

const inputEl = document.getElementById("topic-guard-input") as HTMLInputElement;
const sendBtn = document.getElementById("topic-guard-send") as HTMLButtonElement;
const clearBtn = document.getElementById("topic-guard-clear") as HTMLButtonElement;
const messagesEl = document.getElementById("topic-guard-messages")!;
const logEl = document.getElementById("topic-guard-log")!;
const allowedCountEl = document.getElementById("topic-guard-allowed-count")!;
const blockedCountEl = document.getElementById("topic-guard-blocked-count")!;
const blockRateEl = document.getElementById("topic-guard-block-rate")!;
const topicsEl = document.getElementById("topic-guard-topics")!;

// ============================================================================
// Render
// ============================================================================

function render(): void {
  const facts = system.facts;
  const derive = system.derive;

  const messages = facts.messages as ChatMessage[];
  const guardrailLog = facts.guardrailLog as GuardrailLogEntry[];
  const canSend = derive.canSend as boolean;
  const blockedCount = derive.blockedCount as number;
  const allowedCount = derive.allowedCount as number;
  const blockRate = derive.blockRate as string;

  // Send button state
  sendBtn.disabled = !canSend;

  // Stats
  allowedCountEl.textContent = String(allowedCount);
  blockedCountEl.textContent = String(blockedCount);
  blockRateEl.textContent = blockRate;

  // Messages
  if (messages.length === 0) {
    messagesEl.innerHTML =
      '<div class="tg-empty-state">Send a message to see guardrails in action</div>';
  } else {
    messagesEl.innerHTML = "";
    messages.forEach((msg, i) => {
      const el = document.createElement("div");
      el.className = `tg-message ${msg.role}`;
      if (msg.blocked) {
        el.classList.add("blocked");
      }
      el.dataset.testid = `topic-guard-message-${i}`;

      let html = escapeHtml(msg.text);
      if (msg.blocked && msg.guardrail) {
        html += `<div class="tg-guardrail-badge">${escapeHtml(msg.guardrail)} guardrail</div>`;
      }
      el.innerHTML = html;

      messagesEl.appendChild(el);
    });

    // Auto-scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Guardrail log
  if (guardrailLog.length === 0) {
    logEl.innerHTML =
      '<div class="tg-log-empty">No guardrail evaluations yet</div>';
  } else {
    logEl.innerHTML = "";
    // Show newest first
    for (let i = guardrailLog.length - 1; i >= 0; i--) {
      const entry = guardrailLog[i];
      const el = document.createElement("div");
      el.className = `tg-log-entry ${entry.result.blocked ? "blocked" : "allowed"}`;

      const time = new Date(entry.timestamp);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      el.innerHTML = `
        <div class="tg-log-time">${timeStr}</div>
        <span class="tg-log-input">${escapeHtml(truncate(entry.input, 40))}</span>
        <span class="tg-log-result ${entry.result.blocked ? "blocked" : "allowed"}">
          ${entry.result.blocked ? "\u2715 Blocked" : "\u2713 Allowed"}
        </span>
        <span class="tg-log-guardrail">${escapeHtml(entry.result.guardrailName)} &mdash; ${escapeHtml(entry.result.reason)}</span>
      `;

      logEl.appendChild(el);
    }
  }

  // Sync topic checkboxes with state
  const allowedTopics = facts.allowedTopics as string[];
  const checkboxes = topicsEl.querySelectorAll<HTMLInputElement>("input[data-topic]");
  checkboxes.forEach((cb) => {
    cb.checked = allowedTopics.includes(cb.dataset.topic!);
  });
}

// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(allKeys, render);

// ============================================================================
// Controls
// ============================================================================

// Send message
function handleSend(): void {
  if (!system.derive.canSend) {
    return;
  }
  system.events.send();
}

sendBtn.addEventListener("click", handleSend);

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleSend();
  }
});

inputEl.addEventListener("input", () => {
  system.events.setInput({ value: inputEl.value });
});

// Clear chat
clearBtn.addEventListener("click", () => {
  system.events.clear();
});

// Example chips
document.querySelectorAll<HTMLButtonElement>(".tg-chip[data-example]").forEach((chip) => {
  chip.addEventListener("click", () => {
    const text = chip.dataset.example!;
    inputEl.value = text;
    system.events.setInput({ value: text });
    inputEl.focus();
  });
});

// Topic toggles
topicsEl.addEventListener("change", (e) => {
  const target = e.target as HTMLInputElement;
  if (target.dataset.topic) {
    system.events.toggleTopic({ topic: target.dataset.topic });
  }
});

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }

  return text.slice(0, max) + "...";
}

// ============================================================================
// Initial Render
// ============================================================================

render();

// Signal to tests that the module script has fully initialized
document.body.setAttribute("data-topic-guard-ready", "true");
