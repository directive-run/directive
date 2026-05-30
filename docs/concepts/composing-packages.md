# Composing packages – a real-time order dashboard

> Four small packages – `@directive-run/query`, `@directive-run/mutator`,
> `@directive-run/optimistic`, `@directive-run/timeline` – compose into
> one declarative module. Eighty lines of dispatch and UI replace the
> Redux + TanStack + Zustand + custom-rollback stack that does the same
> job in many times that.

This is a worked tutorial, not a brochure. The example is a restaurant
kitchen display: orders stream in over a WebSocket, staff mark items
cooking / ready / cancelled, the customer-facing UI updates
optimistically while the server confirms, and stale orders auto-cancel.
Read end-to-end in about thirty minutes. Each section drops in code you
could paste into a fresh app and keep working on.

## The four packages, the four pains

**`@directive-run/query`** is declarative data fetching. Subscriptions,
queries, mutations, and infinite queries register as constraints; the
fact set they read is the cache key; changes to those facts refetch.
The pain it removes: hand-keyed `invalidateQueries` everywhere, drifting
`useEffect` subscriptions, "why did that fetch?" with no answer.

**`@directive-run/mutator`** collapses the "fact + event + constraint +
resolver" ceremony into a typed handler map. You declare a discriminated
union of mutations; the package contributes all four module fragments.
The pain it removes: fifty lines of boilerplate per discriminator, four
files to keep in sync.

**`@directive-run/optimistic`** is the snapshot-restore macro. Wrap a
handler, list the keys that need rollback, throw freely. The pain it
removes: the manual `try { facts.x = guess; ... } catch { facts.x =
prior; throw }` block written from memory every time, plus the silent
corruption when someone reaches for `JSON.parse(JSON.stringify(...))`.

**`@directive-run/timeline`** is the recorded causal chain. Every
`ObservationEvent` the system emits is stored as a frame; on test
failure a vitest reporter prints the trace. The pain it removes:
`expected 'loading' to be 'ready'` with no further detail.

Each is useful alone. Together they collapse the four boilerplate
layers of an optimistic-realtime-with-rollback UI into one declarative
module.

## The example domain

A kitchen display screen for a restaurant. Orders stream in over a
WebSocket the moment a customer places them. Kitchen staff tap an
order's row to mark it `cooking`, then `ready`, or cancel it. The
customer-facing screen mirrors the same fact set – it updates the
moment staff taps, before the server has acknowledged anything.

The shape of an order:

```ts
// One row on the kitchen screen.
interface Order {
  id: string;
  item: string;                                       // "Margherita 12in"
  status: "queued" | "cooking" | "ready" | "cancelled";
  placedAt: number;                                   // Date.now()
}
```

That is the whole domain. Everything else – WebSocket, optimistic
update, rollback, stale-order cleanup, debug trace – is plumbing that
the four packages remove.

### What the four packages contribute, at a glance

| Concern | Package | Fragment it owns |
| --- | --- | --- |
| WebSocket stream | `query` | `subscriptions.orders` |
| Three staff actions | `mutator` | `pendingMutation` fact, `MUTATE` event, `PROCESS_MUTATION` requirement, resolver |
| Rollback on throw | `optimistic` | `withOptimisticHandlers` wrapping the handler map |
| Causal trace | `timeline` | `recordTimeline` + vitest matchers |
| Stale cleanup | `core` | one constraint that re-uses the `cancel` mutation |
| React binding | `react` | `useDerived`, `useFact`, `sys.events.MUTATE` |

Six packages total if you count `core` and `react` – four "feature"
packages and two foundational ones. Every fragment is declarative.
There is no orchestration code anywhere.

## Bootstrap the system with `createQuerySystem`

The simple path. One call, no `createSystem`, no `createModule`, no
hand-spread fragments.

```ts
import { createQuerySystem } from "@directive-run/query";

interface KitchenFacts {
  kitchenId: string;
  connected: boolean;
  orders: Order[];                                    // server's view, hydrated by the stream
}

const sys = createQuerySystem({
  // Initial facts. The names here drive every cache key downstream.
  facts: {
    kitchenId: "kitchen-12",
    connected: true,
    orders: [] as Order[],
  } satisfies KitchenFacts,

  subscriptions: {
    // The stream re-keys whenever kitchenId changes OR the socket drops.
    // `key` returning null detaches the subscription – the resolver
    // cleans up automatically on the next reconcile.
    orders: {
      key: (f) => (f.connected ? { kitchen: f.kitchenId } : null),
      subscribe: (params, { onData, onError, onComplete, signal }) => {
        const ws = new WebSocket(`wss://api.kitchen.dev/${params.kitchen}`);

        ws.onmessage = (e) => {
          const frame = JSON.parse(e.data) as
            | { kind: "order"; order: Order }
            | { kind: "closed" };
          if (frame.kind === "closed") {
            // The server signals end-of-stream. Subscription stops
            // refetching, isComplete flips true on the ResourceState.
            onComplete?.();
            return;
          }
          // Accumulator – the subscription's data IS the live order list.
          onData((prev) => upsertOrder(prev ?? [], frame.order));
        };

        ws.onerror = () => onError(new Error("kitchen stream lost"));
        signal.addEventListener("abort", () => ws.close());

        return () => ws.close();
      },
    },
  },
});

// Outside any React, the bound handle just works.
sys.subscriptions.orders.setData([]);                 // optimistic reset on logout
```

`upsertOrder` is a pure list update – replace by `id`, append if new.
It is the only piece of "plumbing code" outside the four packages, and
it stays plain TypeScript.

That is the entire transport layer. No `useEffect`, no `queryClient`,
no manual `invalidateQueries`. The fact `connected` toggling to `false`
re-keys the subscription to `null`, which tells the resolver to abort
the in-flight WebSocket. Flip `connected` back to `true` and a fresh
stream opens.

### Why `key: (f) => null` is the unsubscribe primitive

Subscriptions in `@directive-run/query` are constraints under the
hood. The `key` function is the constraint's body: when it returns a
value, the constraint is active and the resolver maintains the
subscription; when it returns `null`, the constraint goes inactive and
the resolver tears down. There is no separate "unsubscribe" API
because there is no separate state to unsubscribe from – the constraint
*is* the subscription's existence.

The implication for the kitchen display: feature-flagging the live
stream off is one fact write. Toggling between two kitchens is two
writes (`kitchenId` then `connected`). Pause-on-tab-hidden is wiring
`document.visibilityState` into `connected`. Every transport rule a
TanStack codebase keeps in `useEffect` cleanup branches lives in the
`key` function instead, plain reactive expressions.

### `ResourceState<Order[]>` is what the UI reads

The subscription's data lives on a derivation named `orders` (same as
the subscription). The derivation's value is a `ResourceState<Order[]>`:

```ts
interface ResourceState<T> {
  data: T | null;
  error: Error | null;
  status: "pending" | "error" | "success";
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  isSuccess: boolean;
  isError: boolean;
  isPreviousData: boolean;
  dataUpdatedAt: number | null;
  failureCount: number;
  failureReason: Error | null;
}
```

When the React component reads `data`, it re-renders on data changes
but not on `failureCount` ticks. When it reads `isFetching`, the
opposite is true. The hook tracks the specifically-read fields and
nothing else.

## Define the staff actions with `defineMutator`

Three actions, one discriminated union. The mutator package gives back
six fragments – facts, events, requirements, eventHandlers, constraints,
resolvers – that we will spread into `createQuerySystem` below.

```ts
import { defineMutator, mutate } from "@directive-run/mutator";

type KitchenMutations = {
  markCooking: { id: string };
  markReady: { id: string };
  cancel: { id: string; reason: string };
};

// Idiomatic Directive: deps close over factory scope. `api` is a
// thin wrapper around fetch – the mutator does not own transport.
function createKitchenMutator(api: KitchenApi) {
  return defineMutator<KitchenMutations, KitchenFacts>({
    markCooking: async ({ payload, facts }) => {
      // Optimistic write happens first – staff sees it instantly.
      facts.orders = setStatus(facts.orders, payload.id, "cooking");
      // Then the server confirms. If this throws, `withOptimistic`
      // below restores the list before the error surfaces.
      await api.patchOrder(payload.id, { status: "cooking" });
    },

    markReady: async ({ payload, facts }) => {
      facts.orders = setStatus(facts.orders, payload.id, "ready");
      await api.patchOrder(payload.id, { status: "ready" });
    },

    cancel: async ({ payload, facts }) => {
      facts.orders = setStatus(facts.orders, payload.id, "cancelled");
      await api.cancelOrder(payload.id, payload.reason);
    },
  });
}
```

`setStatus` is the same kind of pure list update as `upsertOrder` –
return a new array with the matching row's `status` swapped. Pure. No
side effects.

Dispatch site, anywhere in your app:

```ts
sys.events.MUTATE(mutate<KitchenMutations>("markReady", { id: "ord-42" }));
// → handler runs; on success pendingMutation = null
// → on throw  pendingMutation.status = "failed", .error set
```

The `mutate(kind, payload)` constructor builds the right
discriminator-shaped record (`{ kind, payload, status: "pending",
error: null }`). The `kind` field is intentional: Directive's event
dispatcher reserves `type` for routing, so naming the discriminator
`kind` keeps the runtime from misrouting the dispatch.

The mutator runs single-flight by default. If a fresh `MUTATE` arrives
while a handler is still in flight, the new dispatch overwrites the
fact and the constraint re-fires once the in-flight handler completes.
"Last write wins" for same-shape mutations – which is the right default
for a kitchen display, where the latest tap from staff is always the
intended state.

## Wrap the handlers with `withOptimisticHandlers`

Three handlers, three rollback declarations, one wrapper call:

```ts
import { withOptimisticHandlers } from "@directive-run/optimistic";

function createKitchenMutator(api: KitchenApi) {
  const handlers = {
    markCooking: async ({ payload, facts }) => {
      facts.orders = setStatus(facts.orders, payload.id, "cooking");
      await api.patchOrder(payload.id, { status: "cooking" });
    },
    markReady: async ({ payload, facts }) => {
      facts.orders = setStatus(facts.orders, payload.id, "ready");
      await api.patchOrder(payload.id, { status: "ready" });
    },
    cancel: async ({ payload, facts }) => {
      facts.orders = setStatus(facts.orders, payload.id, "cancelled");
      await api.cancelOrder(payload.id, payload.reason);
    },
  };

  // Each handler gets `orders` as the rollback key. The snapshot is
  // taken at handler entry via `structuredClone` and restored ONLY on
  // uncaught throw – success leaves the new value in place.
  const wrapped = withOptimisticHandlers<typeof handlers, KitchenFacts>(
    {
      markCooking: ["orders"],
      markReady: ["orders"],
      cancel: ["orders"],
    },
    handlers,
  );

  return defineMutator<KitchenMutations, KitchenFacts>(wrapped);
}
```

The ordering matters. When a handler throws:

1. `withOptimistic` snaps `orders` back to its pre-handler value.
2. The throw propagates up to the mutator.
3. The mutator captures `err.message` onto `pendingMutation.error`.

By the time the UI re-renders the error, the order list is already
back to truth. The user never sees a row that says "ready" *and* an
error banner that says "the server rejected that change." Both halves
agree.

### Why `structuredClone`, not JSON-roundtrip

The optimistic package uses `structuredClone` for the snapshot and
refuses to fall back to `JSON.parse(JSON.stringify(...))`. The reason:
the JSON path silently drops functions, symbols, and `undefined`
values. A rollback that silently mis-restores is worse than no
rollback – you ship corrupted state with no error trail.

If a fact value is not `structuredClone`-able (a function, a DOM
node, a `BigInt`, a `Set`/`Map`), `withOptimistic` throws
`OptimisticCloneError` with the offending key at handler entry,
before the optimistic write lands. The contract is: convert at the
fact boundary (`Date → number`, `BigInt → string`, `Set → array`).
Loud fail. No silent corruption.

### Layering with `cancellable()`

If a mutation is the kind that should auto-cancel its predecessor
(type-ahead search, debounced filter, throttled tap), wrap the inner
handler with `cancellable()` *before* passing it to
`withOptimisticHandlers`:

```ts
import { cancellable } from "@directive-run/mutator";

const handlers = {
  markReady: cancellable<KitchenFacts, { id: string }>(
    { supersedeOn: "self", timeoutMs: 5_000 },
    async ({ payload, facts, signal }) => {
      facts.orders = setStatus(facts.orders, payload.id, "ready");
      await api.patchOrder(payload.id, { status: "ready" }, { signal });
    },
  ),
  // ... other handlers
};

const wrapped = withOptimisticHandlers<typeof handlers, KitchenFacts>(
  { markReady: ["orders"] },
  handlers,
);
```

The order matters. `cancellable` on the inside means a supersede-abort
also trips rollback, which is usually what you want for a UI button
("user pressed twice; cancel the first, restore from before the
first"). Wrap the other way around to keep optimistic writes from
debounced dispatches.

## Wire it together

The mutator returns six fragments; `createQuerySystem` accepts each as
a pass-through. Spread them in:

```ts
const mut = createKitchenMutator(api);

const sys = createQuerySystem({
  facts: {
    kitchenId: "kitchen-12",
    connected: true,
    orders: [] as Order[],
    ...mut.facts,                                     // adds pendingMutation
  },

  subscriptions: { orders: { /* as above */ } },

  // The mutator's fragments do all of:
  //   - event handler that sets pendingMutation
  //   - constraint that fires while it's non-null
  //   - resolver that dispatches to the right handler.
  events: { ...mut.eventHandlers },
  constraints: { ...mut.constraints },
  resolvers: { ...mut.resolvers },
});
```

That is the full system. Transport, mutation, rollback – three packages,
forty lines.

## A constraint cleans up stale orders

Constraints close the loop. If an order has been sitting `queued` or
`cooking` for thirty minutes, it should auto-cancel – kitchen forgot,
customer left. Declare the rule once; the resolver dispatches the
existing `cancel` mutation for each stale order.

```ts
const THIRTY_MIN = 30 * 60 * 1000;

const sys = createQuerySystem({
  // ... facts, subscriptions, events, mutator constraints/resolvers ...

  constraints: {
    ...mut.constraints,
    cleanupStale: {
      when: (f) =>
        f.orders.some(
          (o) =>
            (o.status === "queued" || o.status === "cooking") &&
            Date.now() - o.placedAt > THIRTY_MIN,
        ),
      require: { type: "CLEANUP_STALE" },
    },
  },

  resolvers: {
    ...mut.resolvers,
    cleanupStale: {
      requirement: "CLEANUP_STALE",
      resolve: async (_req, ctx) => {
        const stale = ctx.facts.orders.filter(
          (o) =>
            (o.status === "queued" || o.status === "cooking") &&
            Date.now() - o.placedAt > THIRTY_MIN,
        );

        // Re-use the cancel mutation. It is already optimistic, already
        // server-confirmed, already rolled back on failure.
        for (const o of stale) {
          ctx.facts.pendingMutation = mutate<KitchenMutations>("cancel", {
            id: o.id,
            reason: "stale",
          });
        }
      },
    },
  },
});
```

The schema also needs `CLEANUP_STALE` declared as a requirement type;
`createQuerySystem` handles that via the spread. The point of this
section is the shape of the rule – `when` reads a fact, the resolver
re-uses the existing mutation. No new optimistic code, no new rollback
path, no new error handling. The constraint reuses what is already
there.

### What "constraint" means here, in one paragraph

A constraint is a `when` predicate plus a `require` shape. When `when`
returns `true`, the engine emits a requirement that matches `require`;
the resolver registered for that requirement runs. The whole thing is
reactive: the predicate is auto-tracked against the facts it reads, so
`when: (f) => f.orders.some(o => ...)` re-evaluates whenever `orders`
changes. There is no `setInterval`, no scheduled task, no separate
reconcile loop to remember to register. The cleanup runs as a
consequence of the data describing the cleanup condition.

### When the constraint stops firing

The resolver writes a fresh `mutate(...)` value to `pendingMutation`
for each stale order. The mutator's handler runs `cancel`, which
flips the order's status to `cancelled`. On the next reconcile pass,
the `when` predicate re-evaluates – now no order matches
`status === "queued" || status === "cooking"`, so the constraint goes
inactive and the resolver does not fire. The system settles.

If the API rejects a `cancel` call, `withOptimistic` rolls back the
status (the order stays `cooking`), `pendingMutation.error` lights up,
and the constraint fires again on the next stale-check tick. The
rollback path you wrote for the user-facing button is the same path
the auto-cleanup uses. Pure. No side effects.

## React UI in 20 lines

`useDerived` reads the subscription's `ResourceState`; `useFact` reads
plain facts; `sys.events.MUTATE(...)` dispatches. That is the whole
binding.

```tsx
import { useDerived, useFact } from "@directive-run/react";
import { mutate } from "@directive-run/mutator";

function KitchenDisplay({ sys }: { sys: typeof appSystem }) {
  // ResourceState<Order[]> – data, error, isPending, isFetching, ...
  const orders = useDerived(sys, "orders");
  const kitchenId = useFact(sys, "kitchenId");

  if (orders.isPending && orders.data === null) {
    return <p>Connecting to {kitchenId}…</p>;
  }

  return (
    <ul className="orders">
      {(orders.data ?? []).map((o) => (
        <li key={o.id} data-status={o.status}>
          <span>{o.item}</span>
          <button
            onClick={() =>
              sys.events.MUTATE(
                mutate<KitchenMutations>("markReady", { id: o.id }),
              )
            }
            disabled={o.status === "ready" || o.status === "cancelled"}
          >
            mark ready
          </button>
        </li>
      ))}
    </ul>
  );
}
```

The component re-renders only when the specifically-read fields change.
A new order arriving touches `orders.data`; a connection flap touches
`orders.isFetching`. The component reads both, so it re-renders for
both – but pressing "mark ready" optimistically rewrites `orders` and
the row updates inside the same React frame the click ran in.

### Why `useDerived(sys, "orders")` is the right hook

`useDerived` subscribes to a derivation – `orders` here is the
`ResourceState<Order[]>` derivation that the subscription contributes.
The auto-tracked dependency graph means: read `data` and `isPending`,
get re-renders for `data` and `isPending` changes only. Skipping
`failureCount` skips the re-renders for that field.

`useFact(sys, "kitchenId")` is the same primitive aimed at a plain
fact instead of a derivation. It is the right hook for any value that
is not a query result – user input, UI flags, derived selectors that
do not need the `ResourceState` envelope.

The two hooks together are the entire React surface for this app. No
`useEffect`, no `useCallback`, no `useMemo`. The component is a pure
function of the facts it reads.

## Failure rehearsal: kill the WebSocket, watch the rollback

Production rarely shows you the rollback path. Force it locally:

```ts
// dev-only helper – kill the socket and reject the next mutation.
export function simulateNetworkFailure(sys: typeof appSystem): void {
  // Drop the stream. The subscription detaches; ResourceState.isError = true.
  sys.facts.connected = false;

  // Swap in a failing API for the next mutation. The optimistic write
  // happens, the server rejects, the rollback runs.
  api.patchOrder = async () => {
    throw new Error("kitchen offline");
  };
}
```

What the staff sees, in order:

1. Tap "mark ready" on `ord-42`. The row updates instantly to `ready`.
2. The `patchOrder` call rejects.
3. `withOptimistic` restores the previous `orders` array – `ord-42`
   snaps back to `cooking`.
4. `pendingMutation.error` is now `"kitchen offline"`. A banner
   somewhere reads that string.

The intermediate state – "row shows ready, banner shows error" – never
renders. The rollback completes inside the same reconcile tick the
error is captured in. The UI is always consistent.

### What dies first when you remove the optimistic wrapper

Take out `withOptimisticHandlers` and re-run the same scenario. The
sequence becomes:

1. Tap "mark ready" on `ord-42`. The row updates instantly to `ready`.
2. The `patchOrder` call rejects.
3. The mutator captures the error onto `pendingMutation.error`.
4. The error banner appears.
5. The order list still says `ready`.

The UI has just lied to the user. A banner saying "the server rejected
that change" sits next to a row saying "ready." The next staff member
who looks at this screen will believe the server is up to date when it
is not.

The four-package composition does not prevent this category of bug by
being defensive at the call site. It prevents it by making the
rollback *the same code path* as the success – snapshot at entry,
restore on throw, propagate, capture. Eight lines of wrapper around
three handlers.

## Catch the failure in a test with `recordTimeline`

The same failure scenario, wrapped in a vitest assertion. When the
test fails, the reporter prints the entire causal chain.

```ts
// vitest.setup.ts – one-time setup
import "@directive-run/timeline/matchers";

// orders.test.ts
import { afterEach, expect, it } from "vitest";
import {
  recordTimeline,
  clearAllTimelines,
} from "@directive-run/timeline";
import { mutate } from "@directive-run/mutator";

afterEach(() => clearAllTimelines());

it("rolls back when the server rejects markReady", async () => {
  const sys = createTestSystem({ api: failingApi });
  const t = recordTimeline(sys, { id: "rollback-markReady" });

  sys.start();

  // Seed an order so there is something to mark ready.
  sys.subscriptions.orders.setData([
    { id: "ord-42", item: "Margherita", status: "cooking", placedAt: 0 },
  ]);

  sys.events.MUTATE(mutate<KitchenMutations>("markReady", { id: "ord-42" }));
  await flushAsync();

  // The matchers read the recorded ObservationEvent stream.
  expect(t).toMutate("markReady");
  expect(t).toFireConstraint("pendingMutation");

  // After rollback the row is back to "cooking" – this is the assertion
  // we actually care about.
  const restored = sys.facts.orders.find((o) => o.id === "ord-42");
  expect(restored?.status).toBe("cooking");

  sys.destroy();
});
```

When the rollback regresses – say someone accidentally removes
`"orders"` from the rollback keys – the assertion fails and the
reporter prints:

```
Timeline 'rollback-markReady' – 9 frames over 14ms
  [+0.1ms]   system.start
  [+0.2ms]   fact.change orders: [] → [{1 item}]
  [+0.3ms]   fact.change pendingMutation: null → {kind:"markReady",status:"pending",...}
  [+0.3ms]   constraint.evaluate pendingMutation active=true
  [+0.4ms]   requirement.created PROCESS_MUTATION
  [+0.4ms]   resolver.start mutationResolver (PROCESS_MUTATION)
  [+0.5ms]   fact.change orders: [{1 item}] → [{1 item}]   ← optimistic write
  [+8.2ms]   resolver.error mutationResolver: kitchen offline
  [+8.3ms]   fact.change pendingMutation: {...} → {...,status:"failed",error:"kitchen offline"}
```

The failure is not a riddle. The optimistic write landed at +0.5ms.
The resolver errored at +8.2ms. The next `fact.change orders` frame
that would have shown the rollback is missing – which is exactly the
bug. The assertion at the bottom of the test (`restored?.status).toBe("cooking")`)
told you `orders` was wrong; the timeline tells you *why*.

### Diff a good run against a bad run

The matchers cover assertion-style use. For "two runs that look almost
the same but the second one shipped a regression," `diffTimelines`
prints the structural delta:

```ts
import {
  diffTimelines,
  serializeTimeline,
  deserializeTimeline,
} from "@directive-run/timeline";

const golden = recordTimeline(goodSys, { id: "happy-path" });
runHappyPath(goodSys);
const bad = recordTimeline(badSys, { id: "regression" });
runHappyPath(badSys);

const diff = diffTimelines(
  deserializeTimeline(JSON.parse(JSON.stringify(serializeTimeline(golden)))),
  deserializeTimeline(JSON.parse(JSON.stringify(serializeTimeline(bad)))),
);

if (!diff.identical) {
  for (const c of diff.constraintFires) {
    console.log(`constraint '${c.id}': ${c.aCount} → ${c.bCount}`);
  }
  for (const r of diff.resolverRuns) {
    console.log(
      `resolver '${r.resolver}': errors ${r.aErrors} → ${r.bErrors}`,
    );
  }
}
// → "constraint 'cleanupStale': 0 → 3"
// → "resolver 'mutationResolver': errors 0 → 3"
```

Three extra `cleanupStale` fires and three new resolver errors – the
regression introduced a clock skew that made every order look stale
inside the first reconcile tick. Without the diff, this surfaces as
"the test sometimes hangs." With the diff, it surfaces as exactly
which constraint changed firing count between commits.

### Bisect for the moment a regression entered

When a long-running prod scenario flips from passing to failing at
some unknown frame, `bisectTimeline` is git-bisect for frames. It
takes the serialized timeline, a factory that builds a fresh started
system, and an oracle that answers pass/fail, then returns the index
of the first frame whose inclusion flips the verdict.

```ts
import { bisectTimeline, deserializeTimeline } from "@directive-run/timeline";

const bad = deserializeTimeline(JSON.parse(prodCrashJson));

const result = await bisectTimeline(
  bad,
  () => {
    const sys = createTestSystem({ api: prodLikeApi });
    sys.start();
    return sys;
  },
  (sys) => {
    const orders = (sys as { facts: KitchenFacts }).facts.orders;
    // Oracle: no order should sit in "cooking" longer than the cleanup window.
    return orders.every(
      (o) => o.status !== "cooking" || Date.now() - o.placedAt <= THIRTY_MIN,
    );
  },
);

switch (result.kind) {
  case "found":
    console.log(`regression entered at frame #${result.firstFailingFrameIndex}`);
    break;
  case "no-failure":
    console.log("the oracle never fails – check the bad JSON");
    break;
  case "fails-on-empty":
    console.log("the bug is in init, not any specific frame");
    break;
  case "non-deterministic":
    console.log("the timeline is not deterministic – fix that first");
    break;
}
```

The determinism gate replays the full timeline twice before searching
and refuses to bisect if the two runs disagree. Without that gate,
each midpoint flips an arbitrary direction and the result lies
confidently. With it, "non-deterministic" is a returned outcome you
can branch on, not a silent miscompare.

## What you got

Eighty lines, four packages, one module:

- Orders streaming over a WebSocket with an `onComplete` terminal
  signal that the subscription respects.
- Three discriminated mutations declared once, dispatched anywhere.
- Optimistic UI on every mutation, with `structuredClone` rollback
  that runs before the error surfaces.
- A declarative constraint that auto-cancels stale orders by re-using
  the existing mutation – no new code path.
- A React component that reads facts via hooks and re-renders on the
  specific fields it touched.
- A test that explains itself when it fails – the causal chain prints
  inline, no `--inspect-brk`, no `console.log` salting.

For comparison, the same feature on a Redux + TanStack + Zustand +
hand-rolled rollback stack is four roughly equal-sized layers. Each
layer owns one of the boilerplate concerns – fetching, mutation,
client state, rollback – and they keep in sync by convention. The
four-package composition here owns the same concerns but the
substrate is a single fact store. Drift between layers is structurally
impossible: there is only one layer.

## See also

- [`@directive-run/query` README](https://github.com/directive-run/directive/tree/main/packages/query) – package source
- [`@directive-run/query` concept doc](./query.md) – causal cache invalidation, `explainQuery`, `createQuerySystem`
- [`@directive-run/mutator` README](https://github.com/directive-run/directive/tree/main/packages/mutator) – package source
- [`@directive-run/mutator` concept doc](./mutator.md) – `defineMutator`, `cancellable`, `recordReplayable`
- [`@directive-run/optimistic` README](https://github.com/directive-run/directive/tree/main/packages/optimistic) – package source
- [`@directive-run/optimistic` concept doc](./optimistic.md) – `withOptimistic`, `withOptimisticHandlers`, the loud-fail clone contract
- [`@directive-run/timeline` README](https://github.com/directive-run/directive/tree/main/packages/timeline) – package source
- [`@directive-run/timeline` concept doc](./timeline.md) – `recordTimeline`, matchers, `replayTimeline`, `bisectTimeline`, `diffTimelines`
