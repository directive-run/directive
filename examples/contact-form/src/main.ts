/**
 * Contact Form — DOM Rendering & System Wiring
 *
 * Six-section pattern: System → DOM Refs → Render → Subscribe → Controls → Initial Render
 */

import { addTimelineEntry, log, schema, system, timeline } from "./module.js";

// ============================================================================
// System Startup
// ============================================================================

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

// Timeline
const timelineEl = document.getElementById("cf-timeline")!;

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

// ============================================================================
// Render
// ============================================================================

function render() {
  // Sync input values (for reset)
  nameInput.value = system.facts.name;
  emailInput.value = system.facts.email;
  subjectInput.value = system.facts.subject;
  messageInput.value = system.facts.message;

  // Derivation values
  const nameError = system.derive.nameError;
  const emailError = system.derive.emailError;
  const subjectError = system.derive.subjectError;
  const messageError = system.derive.messageError;
  const charCount = system.derive.messageCharCount;
  const canSubmit = system.derive.canSubmit;

  // Form errors
  nameErrorEl.textContent = nameError;
  emailErrorEl.textContent = emailError;
  subjectErrorEl.textContent = subjectError;
  messageErrorEl.textContent = messageError;
  charCountEl.textContent = `${charCount} / 10 min`;

  submitBtn.disabled = !canSubmit;

  const status = system.facts.status;
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

  // --- Timeline ---
  if (timeline.length === 0) {
    timelineEl.innerHTML =
      '<div class="cf-timeline-empty">Events appear after interactions</div>';
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

// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(
  [...Object.keys(schema.facts), ...Object.keys(schema.derivations)],
  render,
);

// ============================================================================
// Controls
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
  system.events.submit();
});

clearBtn.addEventListener("click", () => {
  system.events.reset();
  addTimelineEntry("clear", "Form cleared", "reset");
});

// ============================================================================
// Initial Render
// ============================================================================

render();
log("Contact form ready. Fill in all fields and submit.");

// Signal to tests that initialization is complete
document.body.setAttribute("data-contact-form-ready", "true");
