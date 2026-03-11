/**
 * Form Wizard — Directive Modules
 *
 * Two-module system demonstrating multi-step form validation,
 * constraint-driven step advancement, cross-module async email
 * availability checking, and persistence of draft data.
 *
 * - wizard module: step navigation, field data, derivations for per-step
 *   validity, constraints to advance/submit, resolvers for step transitions.
 * - validation module: cross-module email availability check using
 *   crossModuleDeps on the wizard schema.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin, persistencePlugin } from "@directive-run/core/plugins";

// ============================================================================
// Types
// ============================================================================

export type PlanType = "free" | "pro" | "enterprise";

// ============================================================================
// Wizard Schema
// ============================================================================

export const wizardSchema = {
  facts: {
    currentStep: t.number(),
    totalSteps: t.number(),
    advanceRequested: t.boolean(),
    email: t.string(),
    password: t.string(),
    name: t.string(),
    company: t.string(),
    plan: t.string<PlanType>(),
    newsletter: t.boolean(),
    submitted: t.boolean(),
  },
  derivations: {
    step0Valid: t.boolean(),
    step1Valid: t.boolean(),
    step2Valid: t.boolean(),
    currentStepValid: t.boolean(),
    canAdvance: t.boolean(),
    canGoBack: t.boolean(),
    progress: t.number(),
    isLastStep: t.boolean(),
  },
  events: {
    requestAdvance: {},
    goBack: {},
    setField: { field: t.string(), value: t.object<unknown>() },
    reset: {},
  },
  requirements: {
    ADVANCE_STEP: {},
    SUBMIT_FORM: {},
  },
} satisfies ModuleSchema;

// ============================================================================
// Helpers
// ============================================================================

/** Inline step validity check for use in constraints (which only receive facts). */
function isStepValid(facts: Record<string, unknown>, step: number): boolean {
  if (step === 0) {
    return (
      (facts.email as string).includes("@") &&
      (facts.password as string).length >= 8
    );
  }
  if (step === 1) {
    return (facts.name as string).trim().length > 0;
  }
  if (step === 2) {
    return (facts.plan as string) !== "";
  }

  return false;
}

// ============================================================================
// Wizard Module
// ============================================================================

export const wizardModule = createModule("wizard", {
  schema: wizardSchema,

  init: (facts) => {
    facts.currentStep = 0;
    facts.totalSteps = 3;
    facts.advanceRequested = false;
    facts.email = "";
    facts.password = "";
    facts.name = "";
    facts.company = "";
    facts.plan = "free";
    facts.newsletter = false;
    facts.submitted = false;
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    step0Valid: (facts) => {
      return facts.email.includes("@") && facts.password.length >= 8;
    },

    step1Valid: (facts) => {
      return facts.name.trim().length > 0;
    },

    step2Valid: (facts) => {
      return facts.plan !== "";
    },

    currentStepValid: (facts, derived) => {
      if (facts.currentStep === 0) {
        return derived.step0Valid;
      }
      if (facts.currentStep === 1) {
        return derived.step1Valid;
      }
      if (facts.currentStep === 2) {
        return derived.step2Valid;
      }

      return false;
    },

    canAdvance: (facts, derived) => {
      return (
        derived.currentStepValid && facts.currentStep < facts.totalSteps - 1
      );
    },

    canGoBack: (facts) => {
      return facts.currentStep > 0;
    },

    progress: (facts) => {
      return Math.round(((facts.currentStep + 1) / facts.totalSteps) * 100);
    },

    isLastStep: (facts) => {
      return facts.currentStep === facts.totalSteps - 1;
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    requestAdvance: (facts) => {
      facts.advanceRequested = true;
    },

    goBack: (facts) => {
      if (facts.currentStep > 0) {
        facts.currentStep = facts.currentStep - 1;
      }
    },

    setField: (facts, { field, value }) => {
      (facts as Record<string, unknown>)[field] = value;
    },

    reset: (facts) => {
      facts.currentStep = 0;
      facts.advanceRequested = false;
      facts.email = "";
      facts.password = "";
      facts.name = "";
      facts.company = "";
      facts.plan = "free";
      facts.newsletter = false;
      facts.submitted = false;
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    submit: {
      priority: 60,
      when: (facts) => {
        const isLastStep = facts.currentStep === facts.totalSteps - 1;
        const stepValid = isStepValid(facts, facts.currentStep);

        return facts.advanceRequested && isLastStep && stepValid;
      },
      require: { type: "SUBMIT_FORM" },
    },

    advance: {
      priority: 50,
      when: (facts) => {
        const isLastStep = facts.currentStep === facts.totalSteps - 1;
        const stepValid = isStepValid(facts, facts.currentStep);

        return facts.advanceRequested && !isLastStep && stepValid;
      },
      require: { type: "ADVANCE_STEP" },
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    advanceStep: {
      requirement: "ADVANCE_STEP",
      resolve: async (req, context) => {
        context.facts.currentStep = context.facts.currentStep + 1;
        context.facts.advanceRequested = false;
      },
    },

    submitForm: {
      requirement: "SUBMIT_FORM",
      timeout: 10000,
      resolve: async (req, context) => {
        // Simulate API submission
        await new Promise((resolve) => setTimeout(resolve, 800));
        context.facts.submitted = true;
        context.facts.advanceRequested = false;
      },
    },
  },
});

// ============================================================================
// Validation Schema
// ============================================================================

export const validationSchema = {
  facts: {
    emailAvailable: t.boolean(),
    checkingEmail: t.boolean(),
    emailChecked: t.string(),
  },
  derivations: {},
  events: {},
  requirements: {
    CHECK_EMAIL: { email: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Validation Module
// ============================================================================

export const validationModule = createModule("validation", {
  schema: validationSchema,

  crossModuleDeps: { wizard: wizardSchema },

  init: (facts) => {
    facts.emailAvailable = true;
    facts.checkingEmail = false;
    facts.emailChecked = "";
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    checkEmail: {
      when: (facts) => {
        const email = facts.wizard.email;
        const checked = facts.self.emailChecked;

        return email.includes("@") && email !== checked;
      },
      require: (facts) => ({
        type: "CHECK_EMAIL",
        email: facts.wizard.email,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    checkEmail: {
      requirement: "CHECK_EMAIL",
      resolve: async (req, context) => {
        context.facts.checkingEmail = true;

        try {
          // Simulate API availability check
          await new Promise((resolve) => setTimeout(resolve, 500));
          context.facts.emailAvailable = req.email !== "taken@test.com";
          context.facts.emailChecked = req.email;
        } finally {
          context.facts.checkingEmail = false;
        }
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  modules: {
    wizard: wizardModule,
    validation: validationModule,
  },
  trace: true,
  plugins: [
    devtoolsPlugin({ name: "form-wizard" }),
    persistencePlugin({
      storage: localStorage,
      key: "form-wizard-draft",
      include: [
        "wizard::email",
        "wizard::name",
        "wizard::company",
        "wizard::plan",
        "wizard::currentStep",
      ],
    }),
  ],
});
