---
title: How to Build a Multi-Step Form Wizard
description: Implement a step-by-step form with constraint-gated advancement, per-step validation, and persistence for save-and-resume.
---

Multi-step forms where advancement is gated on validation, steps have dependencies, and partial data is preserved on back-navigation. {% .lead %}

---

## The Problem

The form validation example covers single-page forms. Multi-step wizards need: per-step validation before advancing, async validation between steps (e.g., payment pre-auth), conditional step skipping, back-navigation without data loss, and save-and-resume. Wiring this imperatively means scattered `if/else` chains and brittle step logic.

## The Solution

```typescript
import { createModule, createSystem, t } from '@directive-run/core';
import { persistencePlugin } from '@directive-run/core/plugins';

const wizard = createModule('wizard', {
  schema: {
    currentStep: t.number(),
    totalSteps: t.number(),
    advanceRequested: t.boolean(),
    // Step 1: Account
    email: t.string(),
    password: t.string(),
    // Step 2: Profile
    name: t.string(),
    company: t.string(),
    // Step 3: Preferences
    plan: t.string<'free' | 'pro' | 'enterprise'>(),
    newsletter: t.boolean(),
  },

  init: (facts) => {
    facts.currentStep = 0;
    facts.totalSteps = 3;
    facts.advanceRequested = false;
    facts.email = '';
    facts.password = '';
    facts.name = '';
    facts.company = '';
    facts.plan = 'free';
    facts.newsletter = false;
  },

  derive: {
    step0Valid: (facts) => facts.email.includes('@') && facts.password.length >= 8,
    step1Valid: (facts) => facts.name.trim().length > 0,
    step2Valid: (facts) => facts.plan !== '',
    currentStepValid: (facts, derive) => {
      const validators = [derive.step0Valid, derive.step1Valid, derive.step2Valid];

      return validators[facts.currentStep] ?? false;
    },
    canAdvance: (facts, derive) => derive.currentStepValid && facts.currentStep < facts.totalSteps - 1,
    canGoBack: (facts) => facts.currentStep > 0,
    progress: (facts) => Math.round(((facts.currentStep + 1) / facts.totalSteps) * 100),
  },

  constraints: {
    advance: {
      priority: 50,
      when: (facts) => {
        const step0Valid = facts.email.includes('@') && facts.password.length >= 8;
        const step1Valid = facts.name.trim().length > 0;
        const step2Valid = facts.plan !== '';
        const validators = [step0Valid, step1Valid, step2Valid];
        const currentStepValid = validators[facts.currentStep] ?? false;

        return facts.advanceRequested && currentStepValid;
      },
      require: { type: 'ADVANCE_STEP' },
    },
  },

  resolvers: {
    advanceStep: {
      requirement: 'ADVANCE_STEP',
      resolve: async (req, context) => {
        context.facts.currentStep = context.facts.currentStep + 1;
        context.facts.advanceRequested = false;
      },
    },
  },

  events: {
    requestAdvance: (facts) => {
      facts.advanceRequested = true;
    },
    goBack: (facts) => {
      if (facts.currentStep > 0) {
        facts.currentStep = facts.currentStep - 1;
      }
      facts.advanceRequested = false;
    },
    setField: (facts, { field, value }: { field: string; value: string | boolean }) => {
      const allowed = ['email', 'name', 'company', 'plan', 'newsletter'];
      if (allowed.includes(field)) {
        facts[field] = value;
      }
    },
  },
});

const validation = createModule('validation', {
  schema: {
    emailAvailable: t.boolean(),
    checkingEmail: t.boolean(),
  },

  init: (facts) => {
    facts.emailAvailable = true;
    facts.checkingEmail = false;
  },

  constraints: {
    checkEmail: {
      crossModuleDeps: ['wizard.email'],
      after: ['wizard::advance'],
      when: (facts) => {
        return facts.wizard.email.includes('@') && !facts.checkingEmail;
      },
      require: (facts) => ({
        type: 'CHECK_EMAIL',
        email: facts.wizard.email,
      }),
    },
  },

  resolvers: {
    checkEmail: {
      requirement: 'CHECK_EMAIL',
      resolve: async (req, context) => {
        context.facts.checkingEmail = true;
        const res = await fetch(`/api/check-email?email=${encodeURIComponent(req.email)}`);
        if (!res.ok) {
          throw new Error(`Email check failed: ${res.status}`);
        }
        const data = await res.json();
        context.facts.emailAvailable = data.available;
        context.facts.checkingEmail = false;
      },
    },
  },
});

const system = createSystem({
  modules: { wizard, validation },
  plugins: [
    persistencePlugin({
      key: 'form-wizard-draft',
      include: [
        'wizard::email', 'wizard::name',
        'wizard::company', 'wizard::plan', 'wizard::currentStep',
      ],
    }),
  ],
});
```

```tsx
function WizardForm({ system }) {
  const { facts, derived } = useDirective(system);
  const step = facts['wizard::currentStep'];

  return (
    <div>
      <progress value={derived['wizard::progress']} max={100} />

      {step === 0 && <AccountStep system={system} />}
      {step === 1 && <ProfileStep system={system} />}
      {step === 2 && <PreferencesStep system={system} />}

      <div className="wizard-nav">
        <button
          disabled={!derived['wizard::canGoBack']}
          onClick={() => system.events.goBack()}
        >
          Back
        </button>
        <button
          disabled={!derived['wizard::canAdvance']}
          onClick={() => system.events.requestAdvance()}
        >
          {step === 2 ? 'Submit' : 'Next'}
        </button>
      </div>
    </div>
  );
}
```

## Step by Step

1. **Per-step derivations** (`step0Valid`, `step1Valid`, `step2Valid`) evaluate validation rules independently. `currentStepValid` selects the right one based on `currentStep`.

2. **Constraint-gated advancement** — the `advance` constraint only fires when `advanceRequested && currentStepValid`. If the user clicks "Next" on an invalid step, nothing happens.

3. **Async validation** — the `validation` module checks email availability using `after: ['wizard::advance']` to sequence after step advancement. This prevents the check from blocking the form.

4. **`persistencePlugin`** saves field values and current step to sessionStorage. Closing the tab and reopening restores the wizard exactly where the user left off.

5. **Back navigation** — `goBack` decrements `currentStep` without clearing any field data. All previous values are preserved because facts persist until explicitly cleared.

## Common Variations

### Conditional step skipping

```typescript
derive: {
  shouldSkipShipping: (facts) => facts.productType === 'digital',
},
events: {
  requestAdvance: (facts) => {
    let nextStep = facts.currentStep + 1;
    if (nextStep === 2 && facts.productType === 'digital') {
      nextStep = 3;
    }
    facts.currentStep = nextStep;
  },
},
```

### Async validation between steps

```typescript
resolvers: {
  advanceStep: {
    requirement: 'ADVANCE_STEP',
    resolve: async (req, context) => {
      if (context.facts.currentStep === 1) {
        const valid = await validatePaymentPreAuth(context.facts);
        if (!valid) {
          throw new Error('Payment pre-authorization failed');
        }
      }
      context.facts.currentStep = context.facts.currentStep + 1;
      context.facts.advanceRequested = false;
    },
  },
},
```

### Save and resume with explicit save button

```typescript
events: {
  saveDraft: (facts) => {
    facts.lastSavedAt = Date.now();
    // persistencePlugin automatically persists included facts
  },
},
```

## Related

- [Interactive Example](/docs/examples/form-wizard) — try it in your browser
- [Persistence Plugin](/docs/plugins/persistence) — save and restore state
- [Constraints](/docs/constraints) — priority and `after` ordering
- [Schema & Types](/docs/schema-overview) — runtime validation in dev mode
- [Choosing Primitives](/docs/choosing-primitives) — constraints vs events for gating
