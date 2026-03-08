---
title: "Declarative Newsletter Signup with Directive: The Simplest Module"
description: We said newsletter signup didn't need Directive. Here's why we were wrong.
layout: blog
date: 2026-02-16
dateModified: 2026-02-16
slug: declarative-newsletter-with-directive
author: jason-comes
categories: [Tutorial, Architecture]
---

In [Declarative Forms with Directive](/blog/declarative-forms-with-directive), we listed "single-field newsletter signup" under "not a good fit." One input, one submit. `useState` and `fetch` are fine.

Here's what the full imperative version looks like with validation, rate limiting, auto-reset, and logging:

```typescript
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MS = 60_000;
const RESET_DELAY_MS = 8_000;

function Newsletter() {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const lastSubmittedAt = useRef(0);
  const prevStatus = useRef(status);

  const emailError = touched
    ? !email.trim()
      ? "Email is required"
      : !EMAIL_REGEX.test(email)
        ? "Enter a valid email address"
        : ""
    : "";

  const isValid = EMAIL_REGEX.test(email);
  const isRateLimited = lastSubmittedAt.current > 0
    && Date.now() - lastSubmittedAt.current < RATE_LIMIT_MS;
  const canSubmit = isValid && status === "idle" && !isRateLimited;

  // Auto-reset after success
  useEffect(() => {
    if (status !== "success") {
      return;
    }
    const timer = setTimeout(() => {
      setEmail("");
      setTouched(false);
      setStatus("idle");
      setErrorMessage("");
    }, RESET_DELAY_MS);

    return () => clearTimeout(timer);
  }, [status]);

  // Dev logging
  useEffect(() => {
    if (prevStatus.current !== status) {
      console.log(`[newsletter] status: ${prevStatus.current} → ${status}`);
      prevStatus.current = status;
    }
  }, [status]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) {
      return;
    }

    setStatus("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error || "Something went wrong. Try again.");

        return;
      }

      setStatus("success");
      lastSubmittedAt.current = Date.now();
    } catch {
      setStatus("error");
      setErrorMessage("Network error. Check your connection and try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={() => setTouched(true)}
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
      {status === "success" && <p className="success">You're in!</p>}
    </form>
  );
}
```

Four `useState` calls, a `useRef`, two `useEffect` hooks, manual cleanup, derived values scattered across the function body, and a `handleSubmit` that manages status transitions by hand. It works. But read through it &ndash; can you tell at a glance what behaviors this component has?

---

## The module

Here's the same signup as a Directive module:

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

    canSubmit: (facts, derived) => {
      if (!derived.isValid) {
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

  const email = useSelector(system, (state) => state.email, "");
  const status = useSelector(system, (state) => state.status, "idle");
  const errorMessage = useSelector(system, (state) => state.errorMessage, "");
  const emailError = useSelector(system, (state) => state.emailError, "");
  const canSubmit = useSelector(system, (state) => state.canSubmit, false);

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

### Facts replace useState + useRef

Five facts replace four `useState` calls and a `useRef`. The imperative version needs `lastSubmittedAt` as a ref because it's not render-driving state &ndash; but the component still reads it during render for the `canSubmit` check. In Directive, it's just another fact.

### Derivations replace inline computations

The imperative version computes `emailError`, `isValid`, `isRateLimited`, and `canSubmit` as local variables scattered across the function body. They re-run on every render whether their inputs changed or not.

In the module, each is a named derivation with auto-tracked dependencies. `canSubmit` composes `derived.isValid` &ndash; if `isValid` hasn't changed, `canSubmit` doesn't recompute.

### Events replace scattered setState

The imperative `handleSubmit` calls `setTouched(true)`, then checks `canSubmit`, then calls `setStatus("submitting")` and `setErrorMessage("")`. Four state updates across multiple lines.

The Directive event `submit` sets `facts.touched = true` and `facts.status = "submitting"`. What *happens* when status becomes `"submitting"` is the constraint's job, not the event's.

### Constraints replace useEffect

The imperative version needs two `useEffect` hooks &ndash; one for auto-reset with `setTimeout` + `clearTimeout`, one for logging with a `prevStatus` ref. Both require manual dependency arrays and cleanup.

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

The imperative version inlines `fetch` inside `handleSubmit` with a try/catch that manually sets four different state values across three branches. The `subscribe` resolver does the same work but the status transitions are the resolver's only job &ndash; no event handler orchestration.

The `resetAfterDelay` resolver waits 8 seconds and clears the form. If status changes before the delay completes, the resolver is cancelled automatically &ndash; no `clearTimeout` needed.

---

## Side by side

| Concern | Imperative (React) | Directive |
|---|---|---|
| Email state | `useState("")` | `email` fact |
| Status state | `useState("idle")` | `status` fact |
| Touched state | `useState(false)` | `touched` fact |
| Error state | `useState("")` | `errorMessage` fact |
| Last submitted | `useRef(0)` | `lastSubmittedAt` fact |
| Validation | Inline ternary chain | `emailError` + `isValid` derivations |
| Submit guard | Local `canSubmit` variable | `canSubmit` derivation (composing `derived.isValid`) |
| Rate limiting | `Date.now()` check in render | `lastSubmittedAt` fact + `canSubmit` derivation |
| Auto-reset | `useEffect` + `setTimeout` + `clearTimeout` | `resetAfterSuccess` constraint + resolver |
| Logging | `useEffect` + `useRef` for prev status | `logSubscription` effect with `deps: ["status"]` |
| Submission | Inline `fetch` in `handleSubmit` | `subscribe` constraint + resolver |

Both versions have the same behaviors. The difference is *how* each behavior is expressed.

---

## Where the imperative version breaks down

The imperative version works. Both versions do the same thing. But the imperative approach has structural problems that compound as the component grows:

- **Scattered state transitions.** `setStatus`, `setErrorMessage`, `setTouched`, and `setEmail` are called across `handleSubmit`, two `useEffect` hooks, and the auto-reset timer callback. Following a single status change means jumping between four locations.
- **Manual cleanup.** The auto-reset `useEffect` needs `clearTimeout` in its cleanup function. Forget it and you get stale state updates after unmount.
- **Implicit dependencies.** `canSubmit` reads `lastSubmittedAt.current` during render, but nothing tells React that this value changed. The rate limit only takes effect when something else triggers a re-render.
- **No composition.** `isValid` and `isRateLimited` are local variables. They can't be observed, subscribed to, or tested independently.

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

