/**
 * Contact Form — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the form, state inspector, and event timeline.
 */

import { createModule, createSystem, t, type ModuleSchema } from "@directive-run/core";

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
        log(
          `Submission #${context.facts.submissionCount} succeeded`,
        );
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

const system = createSystem({ module: contactForm });
system.start();

// ============================================================================
// DOM References
// ============================================================================

// Form inputs
const nameInput = document.getElementById("name") as HTMLInputElement;
const emailInput = document.getElementById("email") as HTMLInputElement;
const subjectInput = document.getElementById("subject") as HTMLSelectElement;
const messageInput = document.getElementById("message") as HTMLTextAreaElement;
const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
const clearBtn = document.getElementById("clear-btn") as HTMLButtonElement;
const statusBanner = document.getElementById("status-banner")!;
const nameErrorEl = document.getElementById("name-error")!;
const emailErrorEl = document.getElementById("email-error")!;
const subjectErrorEl = document.getElementById("subject-error")!;
const messageErrorEl = document.getElementById("message-error")!;
const charCountEl = document.getElementById("char-count")!;

// Inspector
const factName = document.getElementById("cf-fact-name")!;
const factEmail = document.getElementById("cf-fact-email")!;
const factSubject = document.getElementById("cf-fact-subject")!;
const factMessage = document.getElementById("cf-fact-message")!;
const factStatus = document.getElementById("cf-fact-status")!;
const factTouched = document.getElementById("cf-fact-touched")!;
const factSubmissions = document.getElementById("cf-fact-submissions")!;
const factLastSubmit = document.getElementById("cf-fact-lastsubmit")!;
const derivIsValid = document.getElementById("cf-deriv-isvalid")!;
const derivCanSubmit = document.getElementById("cf-deriv-cansubmit")!;
const derivNameError = document.getElementById("cf-deriv-nameerror")!;
const derivEmailError = document.getElementById("cf-deriv-emailerror")!;
const derivSubjectError = document.getElementById("cf-deriv-subjecterror")!;
const derivMessageError = document.getElementById("cf-deriv-messageerror")!;
const derivCharCount = document.getElementById("cf-deriv-charcount")!;

// Timeline
const timelineEl = document.getElementById("cf-timeline")!;

// ============================================================================
// Input Handlers
// ============================================================================

for (const [el, field] of [
  [nameInput, "name"],
  [emailInput, "email"],
  [subjectInput, "subject"],
  [messageInput, "message"],
] as const) {
  el.addEventListener("input", () => {
    system.events.updateField({ field, value: el.value });
    addTimelineEntry("field", `${field} updated`, "field");
  });
  el.addEventListener("blur", () => {
    system.events.touchField({ field });
  });
}

submitBtn.addEventListener("click", () => {
  system.events.submit({});
});

clearBtn.addEventListener("click", () => {
  system.events.reset({});
  addTimelineEntry("clear", "Form cleared", "reset");
});

// ============================================================================
// Render
// ============================================================================

function renderBoolIndicator(el: HTMLElement, value: boolean): void {
  const cls = value ? "true" : "false";
  el.innerHTML = `<span class="cf-deriv-indicator ${cls}"></span> ${value}`;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

function render() {
  // Sync input values (for reset)
  nameInput.value = system.facts.name;
  emailInput.value = system.facts.email;
  subjectInput.value = system.facts.subject;
  messageInput.value = system.facts.message;

  // Derivation values
  const nameError = system.read("nameError") as string;
  const emailError = system.read("emailError") as string;
  const subjectError = system.read("subjectError") as string;
  const messageError = system.read("messageError") as string;
  const charCount = system.read("messageCharCount") as number;
  const canSubmit = system.read("canSubmit") as boolean;
  const isValid = system.read("isValid") as boolean;

  // Form errors
  nameErrorEl.textContent = nameError;
  emailErrorEl.textContent = emailError;
  subjectErrorEl.textContent = subjectError;
  messageErrorEl.textContent = messageError;
  charCountEl.textContent = `${charCount} / 10 min`;

  submitBtn.disabled = !canSubmit;

  const status = system.facts.status as string;
  if (status === "submitting") {
    submitBtn.textContent = "Sending...";
    statusBanner.className = "cf-status-banner visible submitting";
    statusBanner.textContent = "Submitting your message...";
  } else if (status === "success") {
    submitBtn.textContent = "Send Message";
    statusBanner.className = "cf-status-banner visible success";
    statusBanner.textContent = "Message sent! Form will reset shortly.";
  } else if (status === "error") {
    submitBtn.textContent = "Send Message";
    statusBanner.className = "cf-status-banner visible error";
    statusBanner.textContent = system.facts.errorMessage;
  } else {
    submitBtn.textContent = "Send Message";
    statusBanner.className = "cf-status-banner";
    statusBanner.textContent = "";
  }

  // --- Inspector: Facts ---
  factName.textContent = system.facts.name || "\u2014";
  factEmail.textContent = system.facts.email || "\u2014";
  factSubject.textContent = system.facts.subject || "\u2014";
  const msg = system.facts.message as string;
  factMessage.textContent = msg ? (msg.length > 30 ? msg.slice(0, 30) + "\u2026" : msg) : "\u2014";
  factStatus.innerHTML = `<span class="cf-status-badge ${status}">${escapeHtml(status)}</span>`;
  const touched = system.facts.touched as Record<string, boolean>;
  factTouched.textContent = `${Object.keys(touched).length} fields`;
  factSubmissions.textContent = String(system.facts.submissionCount);
  const lastAt = system.facts.lastSubmittedAt as number;
  factLastSubmit.textContent = lastAt > 0 ? new Date(lastAt).toLocaleTimeString() : "\u2014";

  // --- Inspector: Derivations ---
  renderBoolIndicator(derivIsValid, isValid);
  renderBoolIndicator(derivCanSubmit, canSubmit);
  derivNameError.textContent = nameError || "\u2014";
  derivEmailError.textContent = emailError || "\u2014";
  derivSubjectError.textContent = subjectError || "\u2014";
  derivMessageError.textContent = messageError || "\u2014";
  derivCharCount.textContent = String(charCount);

  // --- Timeline ---
  if (timeline.length === 0) {
    timelineEl.innerHTML = '<div class="cf-timeline-empty">Events appear after interactions</div>';
  } else {
    timelineEl.innerHTML = "";
    for (const entry of timeline) {
      const el = document.createElement("div");
      el.className = `cf-timeline-entry ${entry.type}`;

      const time = new Date(entry.time);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      el.innerHTML = `
        <span class="cf-timeline-time">${timeStr}</span>
        <span class="cf-timeline-event">${escapeHtml(entry.event)}</span>
        <span class="cf-timeline-detail">${escapeHtml(entry.detail)}</span>
      `;

      timelineEl.appendChild(el);
    }
  }
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
document.body.setAttribute("data-contact-form-ready", "true");
