/**
 * Newsletter Signup — DOM Rendering & System Wiring
 *
 * Six-section pattern: System → DOM Refs → Render → Subscribe → Controls → Initial Render
 */

import { el } from "@directive-run/el";
import { addLog, logs, schema, system } from "./module.js";

// ============================================================================
// System Startup
// ============================================================================

system.start();

// ============================================================================
// DOM References
// ============================================================================

const emailInput = document.getElementById("email") as HTMLInputElement;
const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
const statusBanner = document.getElementById("status-banner")!;
const emailErrorEl = document.getElementById("email-error")!;
const logEl = document.getElementById("log")!;

// ============================================================================
// Render
// ============================================================================

function render() {
  // Sync input value (for reset)
  emailInput.value = system.facts.email;

  // Derivation values
  const emailError = system.derive.emailError;
  const canSubmit = system.derive.canSubmit;

  emailErrorEl.textContent = emailError;
  submitBtn.disabled = !canSubmit;

  const status = system.facts.status;
  if (status === "submitting") {
    submitBtn.textContent = "Subscribing...";
    statusBanner.className = "status-banner status-submitting";
    statusBanner.textContent = "Subscribing...";
  } else if (status === "success") {
    submitBtn.textContent = "Subscribe";
    statusBanner.className = "status-banner status-success";
    statusBanner.textContent = "You're in! Form will reset shortly.";
  } else if (status === "error") {
    submitBtn.textContent = "Subscribe";
    statusBanner.className = "status-banner status-error";
    statusBanner.textContent = system.facts.errorMessage;
  } else {
    submitBtn.textContent = "Subscribe";
    statusBanner.className = "status-banner hidden";
    statusBanner.textContent = "";
  }

  // Render logs
  logEl.replaceChildren(...logs.map((entry) => el("div", entry)));
  logEl.scrollTop = logEl.scrollHeight;
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

emailInput.addEventListener("input", () => {
  system.events.updateEmail({ value: emailInput.value });
});

emailInput.addEventListener("blur", () => {
  system.events.touchEmail();
});

submitBtn.addEventListener("click", () => {
  system.events.submit();
});

// ============================================================================
// Initial Render
// ============================================================================

render();
addLog("Newsletter signup ready. Enter an email and subscribe.");
