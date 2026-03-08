/**
 * Contact Form — Directive Module
 *
 * Multi-field contact form showcasing validation, constraints, and resolvers:
 * - Facts: name, email, subject, message, touched, status, errorMessage, etc.
 * - Derivations: field errors, isValid, canSubmit, messageCharCount
 * - Events: updateField, touchField, submit, reset
 * - Constraints: submitForm, resetAfterSuccess
 * - Resolvers: simulated async send, auto-reset after delay
 * - Effects: logging status transitions
 *
 * Uses a simulated setTimeout instead of a real API so no account is needed.
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
// Types
// ============================================================================

export interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: string;
}

// ============================================================================
// Timeline (external mutable array, same pattern as fraud-analysis)
// ============================================================================

export const timeline: TimelineEntry[] = [];

export function addTimelineEntry(
  event: string,
  detail: string,
  type: string,
): void {
  timeline.unshift({ time: Date.now(), event, detail, type });
}

// ============================================================================
// Logs helper
// ============================================================================

export function log(msg: string): void {
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

export const schema = {
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

const contactForm = createModule("contact-form", {
  schema,

  init: (facts) => {
    facts.name = "";
    facts.email = "";
    facts.subject = "";
    facts.message = "";
    facts.touched = {};
    facts.status = "idle";
    facts.errorMessage = "";
    facts.lastSubmittedAt = 0;
    facts.submissionCount = 0;
  },

  derive: {
    nameError: (facts) => {
      if (!facts.touched.name) {
        return "";
      }
      if (!facts.name.trim()) {
        return "Name is required";
      }
      if (facts.name.trim().length < 2) {
        return "Name must be at least 2 characters";
      }

      return "";
    },

    emailError: (facts) => {
      if (!facts.touched.email) {
        return "";
      }
      if (!facts.email.trim()) {
        return "Email is required";
      }
      if (!EMAIL_REGEX.test(facts.email)) {
        return "Enter a valid email address";
      }

      return "";
    },

    subjectError: (facts) => {
      if (!facts.touched.subject) {
        return "";
      }
      if (!facts.subject) {
        return "Please select a subject";
      }

      return "";
    },

    messageError: (facts) => {
      if (!facts.touched.message) {
        return "";
      }
      if (!facts.message.trim()) {
        return "Message is required";
      }
      if (facts.message.trim().length < 10) {
        return "Message must be at least 10 characters";
      }

      return "";
    },

    isValid: (facts) =>
      facts.name.trim().length >= 2 &&
      EMAIL_REGEX.test(facts.email) &&
      facts.subject !== "" &&
      facts.message.trim().length >= 10,

    canSubmit: (facts, derived) => {
      if (!derived.isValid) {
        return false;
      }
      if (facts.status !== "idle") {
        return false;
      }
      if (
        facts.lastSubmittedAt > 0 &&
        Date.now() - facts.lastSubmittedAt < RATE_LIMIT_MS
      ) {
        return false;
      }

      return true;
    },

    messageCharCount: (facts) => facts.message.length,
  },

  events: {
    updateField: (facts, { field, value }) => {
      const key = field as "name" | "email" | "subject" | "message";
      if (key in facts && typeof facts[key] === "string") {
        (facts as unknown as Record<string, string>)[key] = value;
      }
    },

    touchField: (facts, { field }) => {
      facts.touched = { ...facts.touched, [field]: true };
    },

    submit: (facts) => {
      facts.touched = { name: true, email: true, subject: true, message: true };
      facts.status = "submitting";
    },

    reset: (facts) => {
      facts.name = "";
      facts.email = "";
      facts.subject = "";
      facts.message = "";
      facts.touched = {};
      facts.status = "idle";
      facts.errorMessage = "";
    },
  },

  constraints: {
    submitForm: {
      when: (facts) => facts.status === "submitting",
      require: { type: "SEND_MESSAGE" },
    },

    resetAfterSuccess: {
      when: (facts) => facts.status === "success",
      require: { type: "RESET_AFTER_DELAY" },
    },
  },

  resolvers: {
    sendMessage: {
      requirement: "SEND_MESSAGE",
      resolve: async (req, context) => {
        log(
          `Sending: ${context.facts.name} <${context.facts.email}> [${context.facts.subject}]`,
        );

        await new Promise((resolve) => setTimeout(resolve, 1500));

        if (Math.random() < 0.2) {
          context.facts.status = "error";
          context.facts.errorMessage =
            "Simulated error — try again (20% failure rate for demo).";
          log("Submission failed (simulated)");

          return;
        }

        context.facts.status = "success";
        context.facts.lastSubmittedAt = Date.now();
        context.facts.submissionCount++;
        log(`Submission #${context.facts.submissionCount} succeeded`);
      },
    },

    resetAfterDelay: {
      requirement: "RESET_AFTER_DELAY",
      resolve: async (req, context) => {
        log("Auto-resetting in 3 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 3000));
        context.facts.name = "";
        context.facts.email = "";
        context.facts.subject = "";
        context.facts.message = "";
        context.facts.touched = {};
        context.facts.status = "idle";
        context.facts.errorMessage = "";
        log("Form reset");
      },
    },
  },

  effects: {
    logSubmission: {
      deps: ["status", "submissionCount"],
      run: (facts, prev) => {
        if (!prev) {
          return;
        }

        if (facts.status !== prev.status) {
          log(`Status: ${prev.status} → ${facts.status}`);
        }
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  module: contactForm,
  debug: { runHistory: true },
  plugins: [devtoolsPlugin({ name: "contact-form" })],
});
