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

  init: (facts) => {
    facts.email = "";
    facts.password = "";
    facts.confirmPassword = "";
    facts.emailValid = null;
    facts.emailChecking = false;
    facts.submitted = false;
  },

  derive: {
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
    passwordsMatch: (facts) =>
      facts.password === facts.confirmPassword,
    isValid: (facts, derive) =>
      facts.emailValid === true &&
      derive.passwordErrors.length === 0 &&
      derive.passwordsMatch,
  },

  constraints: {
    checkEmail: {
      when: (facts) =>
        facts.email.length > 0 &&
        facts.email.includes("@") &&
        facts.emailValid === null &&
        !facts.emailChecking,
      require: { type: "CHECK_EMAIL" },
    },
    canSubmit: {
      when: (facts, derive) =>
        facts.submitted && derive.isValid,
      require: { type: "SUBMIT_FORM" },
    },
  },

  resolvers: {
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
    submitForm: {
      requirement: "SUBMIT_FORM",
      resolve: async (req, context) => {
        await api.signup({
          email: context.facts.email,
          password: context.facts.password,
        });
        context.dispatch("SIGNUP_COMPLETE");
      },
    },
  },
});
```

---

## React Component

```typescript
function SignupForm() {
  const email = useFact('email');
  const password = useFact('password');
  const confirmPassword = useFact('confirmPassword');
  const emailValid = useFact('emailValid');
  const emailChecking = useFact('emailChecking');
  const passwordErrors = useDerived('passwordErrors');
  const passwordsMatch = useDerived('passwordsMatch');
  const isValid = useDerived('isValid');
  const { facts } = useSystem();

  return (
    <form onSubmit={(e) => { e.preventDefault(); facts.submitted = true; }}>
      <div>
        <input
          type="email"
          value={email}
          onChange={(e) => {
            facts.email = e.target.value;
            facts.emailValid = null;
          }}
        />
        {emailChecking && <span>Checking...</span>}
        {emailValid === false && <span>Email taken</span>}
        {emailValid === true && <span>Available</span>}
      </div>

      <div>
        <input
          type="password"
          value={password}
          onChange={(e) => { facts.password = e.target.value }}
        />
        {passwordErrors.map((err) => <p key={err}>{err}</p>)}
      </div>

      <div>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => { facts.confirmPassword = e.target.value }}
        />
        {!passwordsMatch && <span>Passwords must match</span>}
      </div>

      <button disabled={!isValid}>Sign Up</button>
    </form>
  );
}
```

---

## Next Steps

- See Data Fetching for async patterns
- See Derivations for computed values
- See Constraints for validation logic
