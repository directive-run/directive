---
title: Form Validation Example
description: Multi-field form validation with constraints and async validation.
---

Validate forms declaratively with constraints. {% .lead %}

---

## The Module

```typescript
import { createModule, createSystem, t } from 'directive';

const formModule = createModule("signup-form", {
  // Every field and its validation state lives in typed facts
  schema: {
    facts: {
      email: t.string(),
      password: t.string(),
      confirmPassword: t.string(),
      emailValid: t.boolean().nullable(),
      emailChecking: t.boolean(),
      submitted: t.boolean(),
    },
  },

  // All fields start empty, no validation has run yet
  init: (facts) => {
    facts.email = "";
    facts.password = "";
    facts.confirmPassword = "";
    facts.emailValid = null;
    facts.emailChecking = false;
    facts.submitted = false;
  },

  derive: {
    // Collect all password rule violations into a single array
    passwordErrors: (facts) => {
      const errors: string[] = [];
      if (facts.password.length < 8) {
        errors.push("Password must be at least 8 characters");
      }
      if (!/[A-Z]/.test(facts.password)) {
        errors.push("Password must contain uppercase letter");
      }
      if (!/[0-9]/.test(facts.password)) {
        errors.push("Password must contain a number");
      }
      return errors;
    },

    // Simple equality check between the two password fields
    passwordsMatch: (facts) =>
      facts.password === facts.confirmPassword,

    // Composed derivation – depends on other derivations and facts
    isValid: (facts, derive) =>
      facts.emailValid === true &&
      derive.passwordErrors.length === 0 &&
      derive.passwordsMatch,
  },

  constraints: {
    // Auto-check email availability once the user types a valid-looking address
    checkEmail: {
      when: (facts) =>
        facts.email.length > 0 &&
        facts.email.includes("@") &&
        facts.emailValid === null &&
        !facts.emailChecking,
      require: { type: "CHECK_EMAIL" },
    },

    // Only allow submission when every validation rule passes
    canSubmit: {
      when: (facts) =>
        facts.submitted &&
        facts.emailValid === true &&
        facts.password.length >= 8 &&
        /[A-Z]/.test(facts.password) &&
        /[0-9]/.test(facts.password) &&
        facts.password === facts.confirmPassword,
      require: { type: "SUBMIT_FORM" },
    },
  },

  resolvers: {
    // Hit the server to see if the email is already taken
    checkEmail: {
      requirement: "CHECK_EMAIL",
      resolve: async (req, context) => {
        context.facts.emailChecking = true;
        try {
          const available = await api.checkEmail(context.facts.email);
          context.facts.emailValid = available;
        } finally {
          context.facts.emailChecking = false;
        }
      },
    },

    // Submit the form payload and reset the submitted flag
    submitForm: {
      requirement: "SUBMIT_FORM",
      resolve: async (req, context) => {
        await api.signup({
          email: context.facts.email,
          password: context.facts.password,
        });
        context.facts.submitted = false;
      },
    },
  },
});
```

---

## React Component

```typescript
import { createSystem } from 'directive';
import { useFact, useDerived } from 'directive/react';

// Boot the form system once at module scope
const system = createSystem({ module: formModule });
system.start();

function SignupForm() {
  // Subscribe to raw field values (facts)
  const email = useFact(system, 'email');
  const password = useFact(system, 'password');
  const confirmPassword = useFact(system, 'confirmPassword');
  const emailValid = useFact(system, 'emailValid');
  const emailChecking = useFact(system, 'emailChecking');

  // Subscribe to computed validation state (derivations)
  const passwordErrors = useDerived(system, 'passwordErrors');
  const passwordsMatch = useDerived(system, 'passwordsMatch');
  const isValid = useDerived(system, 'isValid');

  return (
    // Setting submitted = true triggers the canSubmit constraint
    <form onSubmit={(e) => { e.preventDefault(); system.facts.submitted = true; }}>

      {/* Email field – resets validation on every keystroke */}
      <div>
        <input
          type="email"
          value={email}
          onChange={(e) => {
            system.facts.email = e.target.value;
            system.facts.emailValid = null;
          }}
        />
        {emailChecking && <span>Checking...</span>}
        {emailValid === false && <span>Email taken</span>}
        {emailValid === true && <span>Available</span>}
      </div>

      {/* Password field – errors auto-update via the passwordErrors derivation */}
      <div>
        <input
          type="password"
          value={password}
          onChange={(e) => { system.facts.password = e.target.value }}
        />
        {passwordErrors.map((err) => <p key={err}>{err}</p>)}
      </div>

      {/* Confirm password – passwordsMatch derivation drives the inline error */}
      <div>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => { system.facts.confirmPassword = e.target.value }}
        />
        {!passwordsMatch && <span>Passwords must match</span>}
      </div>

      {/* Button stays disabled until every validation derivation passes */}
      <button disabled={!isValid}>Sign Up</button>
    </form>
  );
}
```

---

## Next Steps

- See [Data Fetching](/docs/examples/data-fetching) for input handling
- See [Derivations](/docs/derivations) for computed values
- See [Constraints](/docs/constraints) for validation logic
