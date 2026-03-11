/**
 * Topic Guard — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * and renders the chat UI + guardrail log + stats to the DOM.
 */

import { el } from "@directive-run/el";
import { createSystem } from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import { topicGuardModule, topicGuardSchema } from "./topic-guard.js";

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: topicGuardModule,
  trace: true,
  plugins: [devtoolsPlugin({ name: "topic-guard" })],
});
system.start();

const allKeys = [
  ...Object.keys(topicGuardSchema.facts),
  ...Object.keys(topicGuardSchema.derivations),
];

// ============================================================================
// DOM References
// ============================================================================

const inputEl = document.getElementById(
  "topic-guard-input",
) as HTMLInputElement;
const sendBtn = document.getElementById(
  "topic-guard-send",
) as HTMLButtonElement;
const clearBtn = document.getElementById(
  "topic-guard-clear",
) as HTMLButtonElement;
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

  const messages = facts.messages;
  const guardrailLog = facts.guardrailLog;
  const canSend = derive.canSend;
  const blockedCount = derive.blockedCount;
  const allowedCount = derive.allowedCount;
  const blockRate = derive.blockRate;

  // Send button state
  sendBtn.disabled = !canSend;

  // Stats
  allowedCountEl.textContent = String(allowedCount);
  blockedCountEl.textContent = String(blockedCount);
  blockRateEl.textContent = blockRate;

  // Messages
  if (messages.length === 0) {
    messagesEl.replaceChildren(
      el("div", { className: "tg-empty-state" }, "Send a message to see guardrails in action"),
    );
  } else {
    messagesEl.replaceChildren(
      ...messages.map((msg, i) => {
        const className = `tg-message ${msg.role}${msg.blocked ? " blocked" : ""}`;
        const msgEl = el("div", { className },
          msg.text,
          msg.blocked && msg.guardrail
            ? el("div", { className: "tg-guardrail-badge" }, `${msg.guardrail} guardrail`)
            : null,
        );
        msgEl.dataset.testid = `topic-guard-message-${i}`;

        return msgEl;
      }),
    );

    // Auto-scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Guardrail log
  if (guardrailLog.length === 0) {
    logEl.replaceChildren(
      el("div", { className: "tg-log-empty" }, "No guardrail evaluations yet"),
    );
  } else {
    const entries: HTMLDivElement[] = [];
    // Show newest first
    for (let i = guardrailLog.length - 1; i >= 0; i--) {
      const entry = guardrailLog[i];
      const time = new Date(entry.timestamp);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const resultClass = entry.result.blocked ? "blocked" : "allowed";

      entries.push(
        el("div", { className: `tg-log-entry ${resultClass}` },
          el("div", { className: "tg-log-time" }, timeStr),
          el("span", { className: "tg-log-input" }, truncate(entry.input, 40)),
          el("span", { className: `tg-log-result ${resultClass}` },
            entry.result.blocked ? "\u2715 Blocked" : "\u2713 Allowed",
          ),
          el("span", { className: "tg-log-guardrail" },
            `${entry.result.guardrailName} \u2014 ${entry.result.reason}`,
          ),
        ),
      );
    }
    logEl.replaceChildren(...entries);
  }

  // Sync topic checkboxes with state
  const allowedTopics = facts.allowedTopics;
  const checkboxes =
    topicsEl.querySelectorAll<HTMLInputElement>("input[data-topic]");
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
document
  .querySelectorAll<HTMLButtonElement>(".tg-chip[data-example]")
  .forEach((chip) => {
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
