---
title: "Declarative Newsletter Signup with Directive: The Simplest Module"
description: We said newsletter signup didn't need Directive. Here's why we were wrong.
layout: blog
date: 2026-02-17
dateModified: 2026-02-17
slug: declarative-newsletter-with-directive
author: jason-comes
categories: [Tutorial, Architecture]
---

In [Declarative Forms with Directive](/blog/declarative-forms-with-directive), we listed "single-field newsletter signup" under "not a good fit." One input, one submit. `useState` and `fetch` are fine.

Here's the code we were defending:

```typescript
function Newsletter() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) { return; }

    setStatus("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error || "Something went wrong. Try again.");
        return;
      }

      setStatus("success");
      setEmail("");
    } catch {
      setStatus("error");
      setErrorMessage("Something went wrong. Try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <button disabled={status === "submitting"}>Subscribe</button>
      {status === "error" && <p>{errorMessage}</p>}
      {status === "success" && <p>You're in!</p>}
    </form>
  );
}
```

Three `useState` calls. A `handleSubmit` that manages status transitions manually. It works. Ship it.

But look at what's missing.

---

## The hidden complexity

1. **No validation.** The `required` attribute on the input stops empty submissions at the browser level, but there's no email format check, no error message for invalid input, and nothing happens on blur.

2. **No rate limiting.** A user can hammer the subscribe button and fire a POST on every click. The only guard is `disabled={status === "submitting"}` &ndash; which re-enables the moment the request completes.

3. **No auto-reset.** After success, the "You're in!" message stays forever. The user sees a stale success state if they scroll back up to the footer.

4. **No logging.** Status transitions are invisible. In development, you'd add a `console.log` somewhere and remove it later. Maybe.

Adding these four behaviors imperatively means two `useEffect` hooks (one for the auto-reset timer, one to re-enable the button after a cooldown), a `useRef` for the last-submitted timestamp, timer cleanup in both effects, and email validation duplicated between an error message and the submit guard.

For one field.

---

## The module

Here's the same signup with all four missing behaviors, built as a Directive module:

```typescript
import { createModule, t } from "@directive-run/core";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MS = 60_000;

const newsletter = createModule("newsletter", {
  schema: {
    facts: {
      email: t.string(),
      touched: t.boolean(),
      status: t.string<"idle" | "submitting" | "success" | "error">(),
      errorMessage: t.string(),
      lastSubmittedAt: t.number(),
    },
    derivations: {
      emailError: t.string(),
      isValid: t.boolean(),
      canSubmit: t.boolean(),
    },
    events: {
      updateEmail: { value: t.string() },
      touchEmail: {},
      submit: {},
    },
    requirements: {
      SUBSCRIBE: {},
      RESET_AFTER_DELAY: {},
    },
  },

  init: (facts) => {
    facts.email = "";
    facts.touched = false;
    facts.status = "idle";
    facts.errorMessage = "";
    facts.lastSubmittedAt = 0;
  },

  derive: {
    emailError: (facts) => {
      if (!facts.touched) {
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

    isValid: (facts) => EMAIL_REGEX.test(facts.email),

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
  },

  events: {
    updateEmail: (facts, { value }) => {
      facts.email = value;
    },

    touchEmail: (facts) => {
      facts.touched = true;
    },

    submit: (facts) => {
      facts.touched = true;
      facts.status = "submitting";
    },
  },

  constraints: {
    subscribe: {
      when: (facts) => facts.status === "submitting",
      require: { type: "SUBSCRIBE" },
    },

    resetAfterSuccess: {
      when: (facts) => facts.status === "success",
      require: { type: "RESET_AFTER_DELAY" },
    },
  },

  resolvers: {
    subscribe: {
      requirement: "SUBSCRIBE",
      resolve: async (req, context) => {
        try {
          const response = await fetch("/api/newsletter", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: context.facts.email }),
          });

          if (response.ok) {
            context.facts.status = "success";
            context.facts.lastSubmittedAt = Date.now();
          } else {
            const data = await response.json().catch(() => ({}));
            context.facts.status = "error";
            context.facts.errorMessage = data.error ?? "Something went wrong. Please try again.";
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
        await new Promise((resolve) => setTimeout(resolve, 8000));
        context.facts.email = "";
        context.facts.touched = false;
        context.facts.status = "idle";
        context.facts.errorMessage = "";
      },
    },
  },

  effects: {
    logSubscription: {
      deps: ["status"],
      run: (facts, prev) => {
        if (!prev) {
          return;
        }
        if (facts.status !== prev.status) {
          console.log(`[newsletter] status: ${prev.status} → ${facts.status}`);
        }
      },
    },
  },
});
```

The module is pure configuration &ndash; no system instantiation. `useDirectiveRef` handles that on the React side.

5 facts, 3 derivations, 3 events, 2 constraints, 2 resolvers, 1 effect. That's the whole signup.

---

## The React component

No config file. No custom hooks. `useDirectiveRef` creates a component-scoped system, `useSelector` reads facts and derivations through the same auto-tracking proxy, and `useEvents` dispatches:

```tsx
import { useCallback } from "react";
import { useDirectiveRef, useSelector, useEvents } from "@directive-run/react";
import { newsletter } from "./module";

function Newsletter() {
  const system = useDirectiveRef(newsletter);

  const email = useSelector(system, (s) => s.email, "");
  const status = useSelector(system, (s) => s.status, "idle");
  const errorMessage = useSelector(system, (s) => s.errorMessage, "");
  const emailError = useSelector(system, (s) => s.emailError, "");
  const canSubmit = useSelector(system, (s) => s.canSubmit, false);

  const events = useEvents(system);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      events.updateEmail({ value: e.target.value });
    },
    [events],
  );

  const handleBlur = useCallback(() => {
    events.touchEmail();
  }, [events]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      events.submit();
    },
    [events],
  );

  if (status === "success") {
    return <p className="success">You're in! Watch for updates.</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="Enter your email"
      />
      <button disabled={!canSubmit}>
        {status === "submitting" ? "Subscribing..." : "Subscribe"}
      </button>

      {emailError ? (
        <p className="error">{emailError}</p>
      ) : status === "error" && errorMessage ? (
        <p className="error">{errorMessage}</p>
      ) : (
        <p className="privacy">We'll never share your email.</p>
      )}
    </form>
  );
}
```

`useDirectiveRef` creates the system on first render and calls `start()` / `destroy()` via a `useEffect`. No singleton, no manual lifecycle. `useSelector`'s proxy auto-detects whether each key is a fact or a derivation &ndash; `s.email` reads a fact, `s.emailError` reads a derivation, same syntax. Each selector subscribes only to the keys it accesses.

---

## What changed

### Facts replace useState

Five facts replace three `useState` calls. `touched` and `lastSubmittedAt` are new &ndash; they back validation and rate limiting that the imperative version didn't have. `touched` is a simple boolean (not `Record<string, boolean>` like the contact form) because there's only one field.

### Derivations replace inline checks

`emailError` is touch-gated &ndash; no error shows until the user blurs the input. `isValid` checks the email regex without caring about touch state. `canSubmit` composes `derive.isValid` with status and rate-limit checks. One chain, no duplication.

The button uses `disabled={!canSubmit}` instead of `disabled={status === "submitting"}`. This single change adds rate limiting and validation gating for free.

### Events replace scattered setState

`updateEmail` sets the email. `touchEmail` sets touched. `submit` does both (so validation errors show on premature submit) and sets status to `"submitting"`. What *happens* when status becomes `"submitting"` is the constraint's job, not the event's.

### Constraints add missing behavior

The two constraints &ndash; `subscribe` and `resetAfterSuccess` &ndash; are the behaviors the imperative version was missing:

```typescript
// "When status is submitting, this must be resolved"
subscribe: {
  when: (facts) => facts.status === "submitting",
  require: { type: "SUBSCRIBE" },
}

// "When status is success, this must be resolved"
resetAfterSuccess: {
  when: (facts) => facts.status === "success",
  require: { type: "RESET_AFTER_DELAY" },
}
```

No `useEffect`. No dependency arrays. No cleanup functions. The constraint declares *what must be true*. The runtime handles lifecycle.

### Resolvers handle async

The `subscribe` resolver POSTs to `/api/newsletter` and updates status. The `resetAfterDelay` resolver waits 8 seconds and clears the form. If status changes before the delay completes, the resolver is cancelled automatically &ndash; no `clearTimeout` needed.

---

## Side by side

| Concern | Imperative (React) | Directive |
|---|---|---|
| Email state | `useState("")` | `email` fact |
| Status state | `useState("idle")` | `status` fact |
| Error state | `useState("")` | `errorMessage` fact |
| Validation | None (missing) | `emailError` + `isValid` derivations |
| Submit guard | `status === "submitting"` only | `canSubmit` derivation (valid + idle + rate limit) |
| Rate limiting | None (missing) | `lastSubmittedAt` fact + `canSubmit` derivation |
| Auto-reset | None (missing) | `resetAfterSuccess` constraint + resolver |
| Logging | None (missing) | `logSubscription` effect |
| Submission | Inline `fetch` in handler | `subscribe` constraint + resolver |

The imperative version is shorter &ndash; but it's missing four behaviors. Adding them imperatively would make it longer than the Directive version, with more complexity to manage.

---

## When the simplest case isn't simple

The imperative newsletter signup looks simple because it's *incomplete*. It has no validation, no rate limiting, no auto-reset, and no logging. Those aren't gold-plating &ndash; they're the kind of behaviors you add after the first user reports a problem.

Adding all four imperatively requires:

- A `useEffect` with `setTimeout` + `clearTimeout` for auto-reset
- A `useRef` or `useState` for the last-submitted timestamp
- A `useEffect` or `setInterval` to re-enable the button after the cooldown (or accept that the button re-enables on the next interaction)
- Email regex validation duplicated between an error message and the submit guard
- A `console.log` you'll forget to remove

The Directive module expresses each behavior as a named primitive. Validation is a derivation. Rate limiting is a derivation that composes another derivation. Auto-reset is a constraint that triggers a resolver. Logging is an effect with explicit deps. Each one is declared, named, and testable in isolation.

---

## The best first example

If you're learning Directive, start here &ndash; not with the contact form.

The contact form has four fields, a `Record<string, boolean>` for touch tracking, generic `updateField` / `touchField` events that route by field name, seven derivations, and a Formspree integration. It's a better showcase but a worse tutorial.

The newsletter module has one field, a boolean for touched, named events (`updateEmail`, `touchEmail`, `submit`), three derivations, and a single API call. Every primitive appears once. Nothing is routed or generic. You can read the entire module top to bottom and understand every line.

Same six primitives. Same patterns. A fraction of the surface area.

---

## Try it

The newsletter signup is live in the footer of every page on [directive.run](/).

A standalone vanilla TypeScript example (no React) is in `examples/newsletter/`:

```bash
cd examples/newsletter
pnpm install
pnpm dev
```

It uses a simulated submission with a 20% failure rate and a 10-second rate limit, so you can see every state transition without an API key.

---

## Related

- **[Declarative Forms with Directive](/blog/declarative-forms-with-directive)** &ndash; the full contact form tutorial (four fields, seven derivations)
- **[Constraints](/docs/constraints)** &ndash; how `when` / `require` works
- **[Derivations](/docs/derivations)** &ndash; auto-tracked computed values
- **[Resolvers](/docs/resolvers)** &ndash; async requirement fulfillment
- **[Effects](/docs/effects)** &ndash; fire-and-forget side effects
- **[React Adapter](/docs/adapters/react)** &ndash; `useDirectiveRef`, `useSelector`, `useEvents`
