---
title: "Declarative Forms with Directive: Zero useState, Zero useEffect"
description: Build a production contact form using Directive's six primitives. Per-field validation, async submission, rate limiting, and auto-reset — without a single useState or useEffect.
layout: blog
date: 2026-02-16
dateModified: 2026-02-16
slug: declarative-forms-with-directive
author: jason-comes
categories: [Tutorial, Architecture]
---

You've built this form before. Four fields, validation, async submission, error states, success states, a loading spinner. Here's what it looks like in React:

```typescript
function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [lastSubmittedAt, setLastSubmittedAt] = useState(0);

  const nameError = touched.name && !name.trim() ? "Name is required" : "";
  const emailError = touched.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? "Enter a valid email" : "";
  // ... subjectError, messageError

  const isValid = name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && subject && message.trim().length >= 10;
  const isRateLimited = lastSubmittedAt > 0 && Date.now() - lastSubmittedAt < 30000;
  const canSubmit = isValid && status === "idle" && !isRateLimited;

  useEffect(() => {
    if (status !== "submitting") return;
    const controller = new AbortController();
    fetch("https://formspree.io/f/...", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, subject, message }),
      signal: controller.signal,
    })
      .then((res) => {
        if (res.ok) { setStatus("success"); setLastSubmittedAt(Date.now()); }
        else { setStatus("error"); setErrorMessage("Something went wrong."); }
      })
      .catch(() => { setStatus("error"); setErrorMessage("Network error."); });
    return () => controller.abort();
  }, [status, name, email, subject, message]);

  useEffect(() => {
    if (status !== "success") return;
    const timer = setTimeout(() => {
      setName(""); setEmail(""); setSubject(""); setMessage("");
      setTouched({}); setStatus("idle"); setErrorMessage("");
    }, 5000);
    return () => clearTimeout(timer);
  }, [status]);

  // ... 60 more lines of JSX
}
```

Six `useState` calls. Two `useEffect` hooks with dependency arrays. Validation logic duplicated between the error messages and the `canSubmit` boolean. The abort controller cleanup. The timeout cleanup. Rate limiting via timestamp comparison that doesn't trigger re-renders when the cooldown expires.

It works. It's also the kind of code that grows into a maintenance burden as soon as you add a fifth field, a multi-step flow, or a second form that shares validation rules.

This is the same form, built with Directive.

---

## The module

The entire form &ndash; state, validation, submission, auto-reset, logging &ndash; lives in one module:

```typescript
import { createModule, createSystem, t } from "@directive-run/core";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MS = 30_000;

const contactForm = createModule("contact-form", {
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
          context.facts.errorMessage = "Network error. Check your connection and try again.";
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
        if (facts.submissionCount !== prev.submissionCount) {
          console.log(`[contact-form] submissions: ${facts.submissionCount}`);
        }
      },
    },
  },
});

const system = createSystem({ module: contactForm });
system.start();
```

Nine facts, seven derivations, four events, two constraints, two resolvers, one effect. That's the whole form. Let's wire it up.

---

## Config and hooks

The system singleton and React hooks:

```typescript
// config.ts
import { createSystem } from "@directive-run/core";
import { contactForm } from "./module";

export const FORMSPREE_ENDPOINT =
  typeof process !== "undefined"
    ? process.env?.NEXT_PUBLIC_FORMSPREE_ID ?? ""
    : "";

let instance = null;

export function getContactFormSystem() {
  if (instance) {
    return instance;
  }

  instance = createSystem({ module: contactForm });
  instance.start();

  return instance;
}
```

```typescript
// hooks.ts
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

export function useFormStatus() {
  return useFact(getContactFormSystem(), "status");
}
```

Each hook subscribes to exactly one fact or derivation. Granular re-renders out of the box.

---

## The React component

Here's the full component. No `useState`, no `useEffect`:

```tsx
const SUBJECTS = [
  { value: "", label: "Select a subject" },
  { value: "general", label: "General inquiry" },
  { value: "bug", label: "Bug report" },
  { value: "feature", label: "Feature request" },
  { value: "partnership", label: "Partnership" },
];

function ContactForm() {
  const name = useContactField("name");
  const email = useContactField("email");
  const subject = useContactField("subject");
  const message = useContactField("message");
  const status = useFormStatus();
  const errorMessage = useContactField("errorMessage");

  const nameError = useContactDerived("nameError");
  const emailError = useContactDerived("emailError");
  const subjectError = useContactDerived("subjectError");
  const messageError = useContactDerived("messageError");
  const charCount = useContactDerived("messageCharCount");
  const canSubmit = useCanSubmit();

  const events = useContactFormEvents();

  const handleChange = useCallback(
    (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      events.updateField({ field, value: e.target.value });
    },
    [events],
  );

  const handleBlur = useCallback(
    (field: string) => () => {
      events.touchField({ field });
    },
    [events],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      events.submit({});
    },
    [events],
  );

  if (status === "success") {
    return (
      <div className="success-panel">
        <CheckCircle className="icon" />
        <h3>Message sent!</h3>
        <p>Thanks for reaching out. We'll get back to you soon.</p>
        <p className="muted">This form will reset automatically in a few seconds.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {status === "error" && errorMessage && (
        <div className="error-banner">
          <XCircle className="icon" />
          <p>{errorMessage}</p>
        </div>
      )}

      <div className="row">
        <Field label="Name" error={nameError}>
          <input
            value={name}
            onChange={handleChange("name")}
            onBlur={handleBlur("name")}
            placeholder="Your name"
          />
        </Field>

        <Field label="Email" error={emailError}>
          <input
            type="email"
            value={email}
            onChange={handleChange("email")}
            onBlur={handleBlur("email")}
            placeholder="you@example.com"
          />
        </Field>
      </div>

      <Field label="Subject" error={subjectError}>
        <select value={subject} onChange={handleChange("subject")} onBlur={handleBlur("subject")}>
          {SUBJECTS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Message" error={messageError}>
        <textarea
          rows={5}
          value={message}
          onChange={handleChange("message")}
          onBlur={handleBlur("message")}
          placeholder="What can we help with?"
        />
        <span className="char-count">{charCount} / 10 min</span>
      </Field>

      <div className="controls">
        <button type="submit" disabled={!canSubmit}>
          {status === "submitting" ? (
            <>
              <CircleNotch className="spinner" />
              Sending…
            </>
          ) : (
            <>
              <Envelope className="icon" />
              Send Message
            </>
          )}
        </button>

        {(name || email || subject || message) && status === "idle" && (
          <button type="button" onClick={() => events.reset({})}>Clear form</button>
        )}
      </div>
    </form>
  );
}
```

Zero `useState`. Zero `useEffect`. The `Field` component is a thin wrapper that renders a label, its children, and an error message &ndash; nothing stateful. The component reads state and dispatches events. Everything else is the module's job.

---

## How it all connects

Now that you've seen the code, here's what's actually happening at each layer.

### Facts replace useState

Nine facts replace six `useState` calls. The key difference: `lastSubmittedAt` and `submissionCount` are facts that React doesn't even know about. They're used by derivations and effects but never rendered directly. In the imperative version, you'd use `useRef` for non-rendering state or accept a needless re-render.

### Derivations replace inline validation

Each error derivation checks `facts.touched.name` before returning an error string &ndash; no error shows until the user blurs the field. This is the same pattern as the imperative version, but it's a derivation, not an inline expression buried in JSX.

The key pattern is **derivation composition**: `canSubmit` reads `derive.isValid` instead of recomputing validity from raw facts. One chain, no duplication. And no dependency arrays &ndash; the runtime auto-tracks which facts each derivation reads. `nameError` recomputes when `facts.name` or `facts.touched` changes, nothing else.

### Events replace scattered setState

The `submit` event touches all fields (so validation errors show on incomplete forms) and sets status to `"submitting"`. That's all it does. What *happens* when status becomes `"submitting"` is the constraint's job.

### Constraints replace useEffect

This is where Directive diverges most from React patterns. The two constraints &ndash; `submitForm` and `resetAfterSuccess` &ndash; replace the two `useEffect` hooks from the imperative version:

```typescript
// Imperative: "when status changes to submitting, do this..."
useEffect(() => {
  if (status !== "submitting") return;
  fetch(...)
  return () => controller.abort();
}, [status, name, email, subject, message]);

// Directive: "when status is submitting, this must be resolved"
submitForm: {
  when: (facts) => facts.status === "submitting",
  require: { type: "SEND_MESSAGE" },
}
```

The constraint declares *what must be true*. The `useEffect` declares *what to do when something changes* and manually manages cleanup. The constraint doesn't need an abort controller or a `clearTimeout` &ndash; the runtime handles resolver lifecycle.

### Resolvers handle the async work

The `sendMessage` resolver is pure async work &ndash; POST to Formspree, update status. `resetAfterDelay` waits 5 seconds and clears the form. In the imperative version, this is a `useEffect` with a `setTimeout` and a cleanup that calls `clearTimeout`. Here, the delay is just part of the resolver. If status changes before the delay completes, the resolver is cancelled automatically.

---

## Side by side

| Concern | Imperative (React) | Directive |
|---|---|---|
| Field state | 4 `useState` calls | 4 facts in schema |
| UI state | 2 `useState` (status, error) | 2 facts in schema |
| Touch tracking | 1 `useState` + manual `setTouched` | 1 fact + `touchField` event |
| Validation | Inline expressions / useMemo | Derivations (auto-tracked) |
| Submit logic | `useEffect` with cleanup | Constraint + resolver |
| Auto-reset | `useEffect` + `setTimeout` + `clearTimeout` | Constraint + resolver |
| Rate limiting | Manual timestamp check | `canSubmit` derivation |
| Logging | Scattered `console.log` or custom hook | Effect with `deps` |

The imperative version has **6 `useState`**, **2 `useEffect`**, and **~120 lines** of orchestration. The Directive version has **~120 lines** of module definition but **~40 lines** of component code. The total is similar &ndash; but the module is testable without React, reusable across frameworks, and inspectable at runtime.

---

## Rate limiting: a derivation, not a timer

After a successful submission, `lastSubmittedAt` is set to `Date.now()`. For 30 seconds, `canSubmit` returns `false` because the derivation checks the timestamp against `RATE_LIMIT_MS`. No `setInterval` polling. No `useEffect` with a timer. The derivation rechecks on the next interaction (field change or submit attempt).

In the imperative version, you'd need either a `useEffect` with a `setInterval` to re-render when the cooldown expires (wasteful), a check at submit time that shows an error (bad UX &ndash; button appears enabled), or a `useState` + `setTimeout` combo to disable the button for 30 seconds (yet another effect to manage).

The derivation approach means the button is disabled whenever the constraint says so, and re-enables reactively when facts change.

---

## When to use this pattern

**Good fit:**
- **Cross-field validation.** When field A's validity depends on field B's value (password confirmation, date ranges, conditional required fields).
- **Async side effects.** Submission, auto-save, file uploads &ndash; anything that needs lifecycle management beyond `useEffect` cleanup.
- **Multi-step forms.** Each step's constraints determine when the user can proceed. The constraint system prevents invalid state transitions.
- **Forms shared across frameworks.** The module works with React, Vue, Svelte, Solid, and Lit. Write validation once, use everywhere.

**Not a good fit:**
- **No validation.** If there's nothing to validate, there's nothing to derive.
- **Static forms.** If the form doesn't need async behavior, rate limiting, or cross-field logic, the overhead isn't justified.

Even a [single-field newsletter signup](/blog/declarative-newsletter-with-directive) benefits from Directive once you add validation, rate limiting, and auto-reset &ndash; behaviors that look simple but accumulate imperative complexity quickly.

---

## Try it

The contact form is live at [directive.run/contact](/contact). It uses the same module described here, submitting to Formspree and auto-resetting after success.

A standalone vanilla TypeScript example (no React) is in `examples/contact-form/`:

```bash
cd examples/contact-form
pnpm install
pnpm dev
```

It uses a simulated submission instead of Formspree, so no API key is needed.

