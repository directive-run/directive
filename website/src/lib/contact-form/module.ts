// @ts-nocheck
/**
 * Contact Form Directive Module
 *
 * Demonstrates all six primitives working together:
 * facts, derivations, constraints, resolvers, effects, and events.
 *
 * Real async submission via Formspree, rate limiting via derivation,
 * auto-reset after success via constraint → resolver chain.
 */
import { createModule, t } from "@directive-run/core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MS = 30_000; // 30 seconds between submissions

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const contactForm = createModule("contact-form", {
  schema: {
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
  },

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

  // ---------------------------------------------------------------------------
  // Derivations
  // ---------------------------------------------------------------------------

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

    canSubmit: (facts, derive) => {
      if (!derive.isValid) {
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

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  events: {
    updateField: (facts, { field, value }) => {
      const key = field as "name" | "email" | "subject" | "message";
      if (key in facts && typeof facts[key] === "string") {
        (facts as Record<string, string>)[key] = value;
      }
    },

    touchField: (facts, { field }) => {
      facts.touched = { ...facts.touched, [field]: true };
    },

    submit: (facts) => {
      // Touch all fields to show validation errors
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

  // ---------------------------------------------------------------------------
  // Constraints
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Resolvers
  // ---------------------------------------------------------------------------

  resolvers: {
    sendMessage: {
      requirement: "SEND_MESSAGE",
      resolve: async (req, context) => {
        const endpoint =
          typeof process !== "undefined"
            ? process.env?.NEXT_PUBLIC_FORMSPREE_ID
            : undefined;
        const url = endpoint ? `https://formspree.io/f/${endpoint}` : null;

        if (!url) {
          context.facts.status = "error";
          context.facts.errorMessage =
            "Contact form is not configured. Please try again later.";

          return;
        }

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              name: context.facts.name,
              email: context.facts.email,
              subject: context.facts.subject,
              message: context.facts.message,
            }),
          });

          if (response.ok) {
            context.facts.status = "success";
            context.facts.lastSubmittedAt = Date.now();
            context.facts.submissionCount++;
          } else {
            const data = await response.json().catch(() => ({}));
            context.facts.status = "error";
            context.facts.errorMessage =
              data.error ?? "Something went wrong. Please try again.";
          }
        } catch {
          context.facts.status = "error";
          context.facts.errorMessage =
            "Network error. Check your connection and try again.";
        }
      },
    },

    resetAfterDelay: {
      requirement: "RESET_AFTER_DELAY",
      resolve: async (req, context) => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        context.facts.name = "";
        context.facts.email = "";
        context.facts.subject = "";
        context.facts.message = "";
        context.facts.touched = {};
        context.facts.status = "idle";
        context.facts.errorMessage = "";
      },
    },
  },

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  effects: {
    logSubmission: {
      deps: ["status", "submissionCount"],
      run: (facts, prev) => {
        if (process.env.NODE_ENV !== "development") {
          return;
        }

        if (!prev) {
          return;
        }

        if (facts.status !== prev.status) {
          console.log(
            `[contact-form] status: ${prev.status} → ${facts.status}`,
          );
        }
        if (facts.submissionCount !== prev.submissionCount) {
          console.log(`[contact-form] submissions: ${facts.submissionCount}`);
        }
      },
    },
  },
});
