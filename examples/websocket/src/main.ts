/**
 * WebSocket Connections — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the status bar, message feed, config sliders,
 * and event timeline. A 500ms timer drives reactive reconnect countdown.
 */

import { createSystem } from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import {
  websocketModule,
  websocketSchema,
  getActiveSocket,
  type EventLogEntry,
  type WsStatus,
} from "./websocket.js";
import type { WsMessage } from "./mock-ws.js";

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: websocketModule,
  plugins: [devtoolsPlugin({ name: "websocket" })],
});
system.start();

const allKeys = [
  ...Object.keys(websocketSchema.facts),
  ...Object.keys(websocketSchema.derivations),
];

// ============================================================================
// DOM References
// ============================================================================

// Status bar
const statusBadge = document.getElementById("ws-status-badge")!;
const urlDisplay = document.getElementById("ws-url-display")!;
const reconnectArea = document.getElementById("ws-reconnect-area")!;
const reconnectCountdownEl = document.getElementById("ws-reconnect-countdown")!;

// Connection & Send
const urlInput = document.getElementById("ws-url-input") as HTMLInputElement;
const connectBtn = document.getElementById("ws-connect-btn") as HTMLButtonElement;
const disconnectBtn = document.getElementById("ws-disconnect-btn") as HTMLButtonElement;
const forceErrorBtn = document.getElementById("ws-force-error-btn") as HTMLButtonElement;
const messageInput = document.getElementById("ws-message-input") as HTMLInputElement;
const sendBtn = document.getElementById("ws-send-btn") as HTMLButtonElement;
const clearBtn = document.getElementById("ws-clear-btn") as HTMLButtonElement;
const connectError = document.getElementById("ws-connect-error")!;

// Messages
const messageFeed = document.getElementById("ws-message-feed")!;
const messageFooter = document.getElementById("ws-message-footer")!;

// Config sliders
const messageRateSlider = document.getElementById("ws-message-rate") as HTMLInputElement;
const rateVal = document.getElementById("ws-rate-val")!;
const connectFailSlider = document.getElementById("ws-connect-failrate") as HTMLInputElement;
const connectFailVal = document.getElementById("ws-connect-fail-val")!;
const reconnectFailSlider = document.getElementById("ws-reconnect-failrate") as HTMLInputElement;
const reconnectFailVal = document.getElementById("ws-reconnect-fail-val")!;
const maxRetriesSlider = document.getElementById("ws-max-retries") as HTMLInputElement;
const maxRetriesVal = document.getElementById("ws-max-retries-val")!;

// Timeline
const timelineEl = document.getElementById("ws-timeline")!;

// ============================================================================
// Render
// ============================================================================

let lastMessageCount = 0;
let lastConnectError = "";

function render(): void {
  const facts = system.facts;
  const derive = system.derive;

  const status = facts.status as WsStatus;
  const url = facts.url as string;
  const messages = facts.messages as WsMessage[];
  const reconnectCountdown = derive.reconnectCountdown as number;
  const canSend = derive.canSend as boolean;
  const messageCount = derive.messageCount as number;
  const eventLog = facts.eventLog as EventLogEntry[];

  // --- Status bar ---
  statusBadge.textContent = status;
  statusBadge.className = `ws-status-badge ${status}`;
  urlDisplay.textContent = url;

  // Reconnect countdown
  if (status === "reconnecting" && reconnectCountdown > 0) {
    reconnectArea.style.display = "flex";
    reconnectCountdownEl.textContent = `Reconnecting in ${reconnectCountdown}s...`;
  } else {
    reconnectArea.style.display = "none";
  }

  // --- Connection form state ---
  connectBtn.disabled = status === "connected" || status === "connecting" || status === "reconnecting";
  disconnectBtn.disabled = status === "disconnected";
  forceErrorBtn.disabled = status !== "connected";
  sendBtn.disabled = !canSend;

  // Show connect error from event log
  const latestError = eventLog
    .slice()
    .reverse()
    .find((e) => e.event === "connect-error");
  const errorMsg = latestError ? latestError.detail : "";
  if (errorMsg !== lastConnectError) {
    lastConnectError = errorMsg;
    connectError.textContent = errorMsg;
    connectError.classList.toggle("visible", errorMsg !== "");
  }

  // --- Message feed ---
  if (messages.length === 0) {
    messageFeed.innerHTML = '<div class="ws-message-empty">Messages will appear here after connecting</div>';
  } else {
    messageFeed.innerHTML = "";
    for (const msg of messages) {
      const el = document.createElement("div");
      const isEcho = msg.from === "You";
      el.className = `ws-message-item ${isEcho ? "" : msg.type}`;
      if (isEcho) {
        el.style.borderLeft = `3px solid var(--brand-text-dim)`;
      }

      const time = new Date(msg.timestamp);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      el.innerHTML = `
        <span class="ws-msg-type ${msg.type}">${escapeHtml(isEcho ? "echo" : msg.type)}</span>
        <span class="ws-msg-from">${escapeHtml(msg.from)}</span>
        <span class="ws-msg-text">${escapeHtml(msg.text)}</span>
        <span class="ws-msg-time">${timeStr}</span>
      `;

      messageFeed.appendChild(el);
    }

    // Auto-scroll when new messages arrive
    if (messages.length > lastMessageCount) {
      messageFeed.scrollTop = messageFeed.scrollHeight;
    }
  }

  lastMessageCount = messages.length;
  messageFooter.textContent = `${messageCount} message${messageCount !== 1 ? "s" : ""}`;

  // --- Slider labels ---
  rateVal.textContent = `${facts.messageRate}s`;
  connectFailVal.textContent = `${facts.connectFailRate}%`;
  reconnectFailVal.textContent = `${facts.reconnectFailRate}%`;
  maxRetriesVal.textContent = `${facts.maxRetries}`;

  // --- Timeline ---
  if (eventLog.length === 0) {
    timelineEl.innerHTML = '<div class="ws-timeline-empty">Events will appear here after connecting</div>';
  } else {
    timelineEl.innerHTML = "";
    for (let i = eventLog.length - 1; i >= 0; i--) {
      const entry = eventLog[i];
      const el = document.createElement("div");
      el.className = `ws-timeline-entry ${entry.event}`;

      const time = new Date(entry.timestamp);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      el.innerHTML = `
        <span class="ws-timeline-time">${timeStr}</span>
        <span class="ws-timeline-event">${escapeHtml(entry.event)}</span>
        <span class="ws-timeline-detail">${escapeHtml(entry.detail)}</span>
      `;

      timelineEl.appendChild(el);
    }
  }
}

// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(allKeys, render);

// Timer — tick every 500ms for reconnect countdown
const tickInterval = setInterval(() => {
  system.events.tick();
}, 500);

// ============================================================================
// Controls
// ============================================================================

// Connect
connectBtn.addEventListener("click", () => {
  connectError.classList.remove("visible");
  lastConnectError = "";
  system.events.requestConnect();
});

// Disconnect
disconnectBtn.addEventListener("click", () => {
  connectError.classList.remove("visible");
  lastConnectError = "";
  system.events.disconnect();
});

// Force Error
forceErrorBtn.addEventListener("click", () => {
  system.events.forceError();
});

// URL input
urlInput.addEventListener("input", () => {
  system.events.setUrl({ value: urlInput.value });
});

// Message input
messageInput.addEventListener("input", () => {
  system.events.setMessageToSend({ value: messageInput.value });
});

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleSend();
  }
});

// Send
function handleSend(): void {
  const socket = getActiveSocket();
  const msg = (system.facts.messageToSend as string).trim();

  if (!socket || !msg) {
    return;
  }

  socket.send(msg);
  system.events.messageSent();
  messageInput.value = "";
}

sendBtn.addEventListener("click", handleSend);

// Clear messages
clearBtn.addEventListener("click", () => {
  system.events.clearMessages();
});

// Sliders
messageRateSlider.addEventListener("input", () => {
  system.events.setMessageRate({ value: Number(messageRateSlider.value) });
});

connectFailSlider.addEventListener("input", () => {
  system.events.setConnectFailRate({ value: Number(connectFailSlider.value) });
});

reconnectFailSlider.addEventListener("input", () => {
  system.events.setReconnectFailRate({ value: Number(reconnectFailSlider.value) });
});

maxRetriesSlider.addEventListener("input", () => {
  system.events.setMaxRetries({ value: Number(maxRetriesSlider.value) });
});

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

// ============================================================================
// Initial Render
// ============================================================================

// Set initial values from pre-filled inputs
system.events.setUrl({ value: urlInput.value });

render();

// Signal to tests that the module script has fully initialized
document.body.setAttribute("data-websocket-ready", "true");
