---
title: Contact Form Example
description: A production contact form using all six Directive primitives — facts, derivations, constraints, resolvers, effects, and events. Zero useState, zero useEffect.
---

A real contact form built with Directive. Per-field validation, async Formspree submission, rate limiting, and auto-reset &ndash; all declarative. {% .lead %}

---

## Overview

This example powers the live [/contact](/contact) page on directive.run. It demonstrates all six primitives:

- **Facts** &ndash; 9 pieces of form state (field values, touched map, status, error, timestamps)
- **Derivations** &ndash; per-field errors (touch-gated), `isValid`, `canSubmit` (with rate limiting), char count
- **Events** &ndash; `updateField`, `touchField`, `submit`, `reset`
- **Constraints** &ndash; `submitForm` (when submitting &rarr; send message), `resetAfterSuccess` (when success &rarr; auto-reset)
- **Resolvers** &ndash; `sendMessage` (POST to Formspree), `resetAfterDelay` (5s wait then clear form)
- **Effects** &ndash; `logSubmission` (dev-mode status change logging)

---

## The Module

```typescript
import { createModule, t } from "@directive-run/core";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MS = 30_000;

const contactForm = createModule("contact-form", {
  schema: {
    facts: {
      name: t.string(),
      email: t.string(),
      subject: t.string(),
      message: t.string(),
      touched: t.any<Record<string, boolean>>(),
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
      if (facts.lastSubmittedAt > 0 && Date.now() - facts.lastSubmittedAt < RATE_LIMIT_MS) {
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
        const url = `https://formspree.io/f/${process.env.NEXT_PUBLIC_FORMSPREE_ID}`;
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
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
            context.facts.status = "error";
            context.facts.errorMessage = "Something went wrong. Please try again.";
          }
        } catch {
          context.facts.status = "error";
          context.facts.errorMessage = "Network error. Check your connection.";
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

  effects: {
    logSubmission: {
      deps: ["status", "submissionCount"],
      run: (facts, prev) => {
        if (!prev) {
          return;
        }
        if (facts.status !== prev.status) {
          console.log(`[contact-form] status: ${prev.status} → ${facts.status}`);
        }
      },
    },
  },
});
```

---

## Constraint &rarr; Resolver Chain

The two constraints drive the entire async lifecycle:

### Submit chain

1. User calls `events.submit({})` &rarr; sets `status = "submitting"`
2. Constraint `submitForm` fires: `status === "submitting"` &rarr; require `SEND_MESSAGE`
3. Resolver `sendMessage` POSTs to Formspree
4. On success: sets `status = "success"`, records `lastSubmittedAt`

### Auto-reset chain

5. Constraint `resetAfterSuccess` fires: `status === "success"` &rarr; require `RESET_AFTER_DELAY`
6. Resolver `resetAfterDelay` waits 5 seconds, then clears all form fields

No `useEffect`. No cleanup functions. No dependency arrays. The constraint system manages the lifecycle.

---

## Derivation Composition

The `canSubmit` derivation reads another derivation (`derive.isValid`) instead of recomputing validity from raw facts:

```typescript
canSubmit: (facts, derive) => {
  if (!derive.isValid) {
    return false;
  }
  if (facts.status !== "idle") {
    return false;
  }
  if (facts.lastSubmittedAt > 0 && Date.now() - facts.lastSubmittedAt < RATE_LIMIT_MS) {
    return false;
  }

  return true;
},
```

This is derivation composition. `isValid` computes once; `canSubmit` reuses it. No duplication of validation logic.

---

## Touch-Gated Validation

Error derivations return an empty string when the field hasn't been touched:

```typescript
nameError: (facts) => {
  if (!facts.touched.name) {
    return "";
  }
  // validation rules...
},
```

The `submit` event touches all fields at once, so errors appear for any incomplete fields when the user tries to submit without filling in the form:

```typescript
submit: (facts) => {
  facts.touched = { name: true, email: true, subject: true, message: true };
  facts.status = "submitting";
},
```

---

## React Hooks

Thin wrappers around `useFact`, `useDerived`, and `useEvents`:

```typescript
import { useFact, useDerived, useEvents } from "@directive-run/react";
import { getContactFormSystem } from "./config";

export function useContactField(key) {
  return useFact(getContactFormSystem(), key);
}

export function useContactDerived(key) {
  return useDerived(getContactFormSystem(), key);
}

export function useContactFormEvents() {
  return useEvents(getContactFormSystem());
}

export function useCanSubmit() {
  return useDerived(getContactFormSystem(), "canSubmit");
}
```

Each hook subscribes to exactly one fact or derivation. Granular re-renders &ndash; changing `name` doesn't re-render the email field.

---

## Run It

### Live site

The form is live at [/contact](/contact) using Formspree for real email delivery.

### Standalone example

```bash
cd examples/contact-form
pnpm install
pnpm dev
```

Uses simulated submission (no Formspree account needed). 20% random failure rate for testing error states.

---

## Related

- [Declarative Forms with Directive](/blog/declarative-forms-with-directive) &ndash; full blog post comparing imperative vs declarative
- [Form Validation](/docs/examples/form-validation) &ndash; simpler signup form example
- [Constraints](/docs/constraints) &ndash; how `when` / `require` works
- [Derivations](/docs/derivations) &ndash; auto-tracked computed values
- [Resolvers](/docs/resolvers) &ndash; async requirement fulfillment
- [React Adapter](/docs/adapters/react) &ndash; `useFact`, `useDerived`, `useEvents`
