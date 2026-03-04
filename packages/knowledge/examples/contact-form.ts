// Example: contact-form
// Source: examples/contact-form/src/main.ts
// Extracted for AI rules — DOM wiring stripped

/**
 * Contact Form — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the form and event timeline.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";

// ============================================================================
// Constants
// ============================================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MS = 10_000; // 10 seconds (shorter for demo)

// ============================================================================
// Timeline
// ============================================================================

interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: string;
}

const timeline: TimelineEntry[] = [];

function addTimelineEntry(event: string, detail: string, type: string) {
  timeline.unshift({ time: Date.now(), event, detail, type });
}

function log(msg: string) {
  console.log(`[contact-form] ${msg}`);

  // Classify and add to timeline
  if (msg.startsWith("Sending:")) {
    addTimelineEntry("submit", msg.replace("Sending: ", ""), "submit");
  } else if (msg.includes("succeeded")) {
    addTimelineEntry("success", msg, "submit");
  } else if (msg.includes("failed")) {
    addTimelineEntry("error", msg, "error");
  } else if (msg.startsWith("Status:")) {
    addTimelineEntry("status", msg.replace("Status: ", ""), "field");
  } else if (msg.includes("Auto-resetting")) {
    addTimelineEntry("auto-reset", msg, "reset");
  } else if (msg === "Form reset") {
    addTimelineEntry("reset", "Form cleared", "reset");
  } else if (msg.includes("ready")) {
    addTimelineEntry("init", msg, "field");
  }
}

// ============================================================================
// Schema
// ============================================================================

const schema = {
  facts: {
    name: t.string(),
    email: t.string(),
    subject: t.string(),
    message: t.string(),
    touched: t.object<Record<string, boolean>>(),
    status: t.string<"idle" | "submitting" | "success" | "error">(),
    errorMessage: t.string(),
    lastSubmittedAt: t.number(),
    submissionCount: t.number(),
  },
  derivations: {
    nameError: t.string(),
    emailError: t.string(),
    subjectError: t.string(),
    messageError: t.string(),
    isValid: t.boolean(),
    canSubmit: t.boolean(),
    messageCharCount: t.number(),
  },
  events: {
    updateField: { field: t.string(), value: t.string() },
    touchField: { field: t.string() },
    submit: {},
    reset: {},
  },
  requirements: {
    SEND_MESSAGE: {},
    RESET_AFTER_DELAY: {},
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================


// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: contactForm,
  plugins: [devtoolsPlugin({ name: "contact-form" })],
});
system.start();

// ============================================================================
// DOM References
// ============================================================================

// Form inputs

// Timeline

// ============================================================================
// Input Handlers
// ============================================================================

for (const [el, field] of [
  [nameInput, "name"],
  [emailInput, "email"],
  [subjectInput, "subject"],
  [messageInput, "message"],
] as const) {
}


// ============================================================================
// Render
// ============================================================================

function escapeHtml(text: string): string {

  return div.innerHTML;
}


// Subscribe to all relevant facts and derivations
system.subscribe(
  [
    "name",
    "email",
    "subject",
    "message",
    "touched",
    "status",
    "errorMessage",
    "lastSubmittedAt",
    "submissionCount",
    "nameError",
    "emailError",
    "subjectError",
    "messageError",
    "isValid",
    "canSubmit",
    "messageCharCount",
  ],
  render,
);

// Initial render
render();
log("Contact form ready. Fill in all fields and submit.");

// Signal to tests that initialization is complete
