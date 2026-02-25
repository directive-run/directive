/**
 * Form Wizard — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the multi-step form with progress bar, step content,
 * navigation buttons, and validation feedback.
 */

import { system, wizardSchema, validationSchema } from "./form-wizard.js";

// ============================================================================
// Start System
// ============================================================================

system.start();

const allKeys = [
  ...Object.keys(wizardSchema.facts).map((k) => `wizard::${k}`),
  ...Object.keys(wizardSchema.derivations).map((k) => `wizard::${k}`),
  ...Object.keys(validationSchema.facts).map((k) => `validation::${k}`),
];

// ============================================================================
// DOM References
// ============================================================================

// Progress
const progressFill = document.getElementById("fw-progress-fill")!;
const progressText = document.getElementById("fw-progress-text")!;
const stepIndicators = document.querySelectorAll<HTMLElement>(".fw-step-indicator");

// Step containers
const step0 = document.getElementById("fw-step-0")!;
const step1 = document.getElementById("fw-step-1")!;
const step2 = document.getElementById("fw-step-2")!;
const steps = [step0, step1, step2];

// Inputs
const emailInput = document.getElementById("fw-email") as HTMLInputElement;
const passwordInput = document.getElementById("fw-password") as HTMLInputElement;
const nameInput = document.getElementById("fw-name") as HTMLInputElement;
const companyInput = document.getElementById("fw-company") as HTMLInputElement;
const planFree = document.getElementById("fw-plan-free") as HTMLInputElement;
const planPro = document.getElementById("fw-plan-pro") as HTMLInputElement;
const planEnterprise = document.getElementById("fw-plan-enterprise") as HTMLInputElement;
const newsletterInput = document.getElementById("fw-newsletter") as HTMLInputElement;

// Navigation
const backBtn = document.getElementById("fw-back-btn") as HTMLButtonElement;
const nextBtn = document.getElementById("fw-next-btn") as HTMLButtonElement;
const submitBtn = document.getElementById("fw-submit-btn") as HTMLButtonElement;

// Validation feedback
const emailStatus = document.getElementById("fw-email-status")!;
const passwordHint = document.getElementById("fw-password-hint")!;
const nameHint = document.getElementById("fw-name-hint")!;

// Success
const successScreen = document.getElementById("fw-success")!;
const formContainer = document.getElementById("fw-form-container")!;

// ============================================================================
// Render
// ============================================================================

function render(): void {
  const facts = system.facts;
  const derive = system.derive;

  const currentStep = facts.wizard.currentStep;
  const submitted = facts.wizard.submitted;
  const progress = derive.wizard.progress;
  const canAdvance = derive.wizard.canAdvance;
  const canGoBack = derive.wizard.canGoBack;
  const isLastStep = derive.wizard.isLastStep;
  const currentStepValid = derive.wizard.currentStepValid;
  const emailAvailable = facts.validation.emailAvailable;
  const checkingEmail = facts.validation.checkingEmail;

  // --- Success screen ---
  if (submitted) {
    formContainer.style.display = "none";
    successScreen.style.display = "flex";

    return;
  }

  formContainer.style.display = "";
  successScreen.style.display = "none";

  // --- Progress bar ---
  progressFill.style.width = `${progress}%`;
  progressText.textContent = `Step ${currentStep + 1} of ${facts.wizard.totalSteps}`;

  // --- Step indicators ---
  stepIndicators.forEach((el, i) => {
    el.classList.remove("active", "completed");
    if (i === currentStep) {
      el.classList.add("active");
    } else if (i < currentStep) {
      el.classList.add("completed");
    }
  });

  // --- Show/hide step content ---
  steps.forEach((el, i) => {
    el.style.display = i === currentStep ? "" : "none";
  });

  // --- Sync input values from persisted state ---
  if (emailInput.value !== facts.wizard.email) {
    emailInput.value = facts.wizard.email;
  }
  if (nameInput.value !== facts.wizard.name) {
    nameInput.value = facts.wizard.name;
  }
  if (companyInput.value !== facts.wizard.company) {
    companyInput.value = facts.wizard.company;
  }

  const currentPlan = facts.wizard.plan;
  planFree.checked = currentPlan === "free";
  planPro.checked = currentPlan === "pro";
  planEnterprise.checked = currentPlan === "enterprise";
  newsletterInput.checked = facts.wizard.newsletter;

  // --- Email availability ---
  if (checkingEmail) {
    emailStatus.textContent = "Checking availability...";
    emailStatus.className = "fw-field-status checking";
  } else if (facts.wizard.email.includes("@")) {
    if (emailAvailable) {
      emailStatus.textContent = "Email available";
      emailStatus.className = "fw-field-status available";
    } else {
      emailStatus.textContent = "Email already taken";
      emailStatus.className = "fw-field-status taken";
    }
  } else {
    emailStatus.textContent = "";
    emailStatus.className = "fw-field-status";
  }

  // --- Password hint ---
  const pw = facts.wizard.password;
  if (pw.length > 0 && pw.length < 8) {
    passwordHint.textContent = `${8 - pw.length} more characters needed`;
    passwordHint.className = "fw-field-hint invalid";
  } else if (pw.length >= 8) {
    passwordHint.textContent = "Password strength: OK";
    passwordHint.className = "fw-field-hint valid";
  } else {
    passwordHint.textContent = "";
    passwordHint.className = "fw-field-hint";
  }

  // --- Name hint ---
  if (currentStep === 1 && facts.wizard.name.trim().length === 0) {
    nameHint.textContent = "Name is required";
    nameHint.className = "fw-field-hint invalid";
  } else {
    nameHint.textContent = "";
    nameHint.className = "fw-field-hint";
  }

  // --- Navigation buttons ---
  backBtn.style.display = canGoBack ? "" : "none";
  nextBtn.style.display = isLastStep ? "none" : "";
  submitBtn.style.display = isLastStep ? "" : "none";
  nextBtn.disabled = !canAdvance;
  submitBtn.disabled = !currentStepValid;

}

// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(allKeys, render);

// ============================================================================
// Controls
// ============================================================================

// Step 0: Account
emailInput.addEventListener("input", () => {
  system.events.wizard.setField({ field: "email", value: emailInput.value });
});

passwordInput.addEventListener("input", () => {
  system.events.wizard.setField({ field: "password", value: passwordInput.value });
});

// Step 1: Profile
nameInput.addEventListener("input", () => {
  system.events.wizard.setField({ field: "name", value: nameInput.value });
});

companyInput.addEventListener("input", () => {
  system.events.wizard.setField({ field: "company", value: companyInput.value });
});

// Step 2: Preferences
planFree.addEventListener("change", () => {
  if (planFree.checked) {
    system.events.wizard.setField({ field: "plan", value: "free" });
  }
});

planPro.addEventListener("change", () => {
  if (planPro.checked) {
    system.events.wizard.setField({ field: "plan", value: "pro" });
  }
});

planEnterprise.addEventListener("change", () => {
  if (planEnterprise.checked) {
    system.events.wizard.setField({ field: "plan", value: "enterprise" });
  }
});

newsletterInput.addEventListener("change", () => {
  system.events.wizard.setField({ field: "newsletter", value: newsletterInput.checked });
});

// Navigation
backBtn.addEventListener("click", () => {
  system.events.wizard.goBack();
});

nextBtn.addEventListener("click", () => {
  system.events.wizard.requestAdvance();
});

submitBtn.addEventListener("click", () => {
  system.events.wizard.requestAdvance();
});

// Success: Start Over
document.getElementById("fw-start-over")?.addEventListener("click", () => {
  system.events.wizard.reset();
  // Clear persisted draft
  localStorage.removeItem("form-wizard-draft");
});

// ============================================================================
// Initial Render
// ============================================================================

render();

// Signal to tests that the module script has fully initialized
document.body.setAttribute("data-form-wizard-ready", "true");
