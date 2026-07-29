# The Last Mile: Migrating the Forms Engine Off XState

*Posted 2026-07-28 · ~9 min read · postscript to [Migrating 55 Machines](./migrating-55-machines.md)*

The [55-machine migration](./migrating-55-machines.md) closed in April. `.claude/CLAUDE.md` on the Minglingo repo said "XState → Directive migration complete." A note in `docs/IDEAS.md` on 2026-07-22 pointed out that nine files still imported `xstate`. Three months late, one commit today, the note is retired.

This is the sequel post. Not a rehash of the original migration — that story stands. This is about the last three files, and about the specific shape of the problem when the code you're porting isn't domain state but the reusable primitives domain state composes with.

## What the 55-machine cycle missed

The original migration was 55 machines, 26,000 LOC, six weeks. Every one of them was a domain machine — the game loop, the lobby, the notification stack, the browse page, the host dashboard. Named things in the product. `hostGameMachine` was the largest at 1,814 LOC. When each one shipped, one product surface stopped importing `xstate` and started importing `@directive-run/*`.

The forms engine wasn't a product surface. It was three files that lived under `apps/web/src/features/forms/application/`:

| File | LOC | Purpose |
|---|---|---|
| `input.machine.ts` | 408 | Field-level state — value, dirty, touched, sync + async validation |
| `form.machine.ts` | 434 | Form composition — inputs, cross-field validation, submission |
| `wizard.machine.ts` | 1,130 | Multi-step navigation, per-step forms, cross-step validation |
| `wizard.machine.test.ts` | 2,126 | The parity test suite for all three |

Four consumers depended on them: three business-signup pages (venues, sports, creators) and the venue-schedule form. Nothing else. But the four consumers were load-bearing — they're the surfaces new users hit before they've paid Minglingo a cent — and the engine underneath was tested, stable, and running in production.

None of the 55-machine gate criteria applied cleanly. Wall-clock estimate was uncertain. LOC reduction was expected to be near-flat (these are pure orchestration primitives — the derivation-cache wins that make Directive shine on query state don't help you when the problem is "run these validators in this order and update this bit"). Cassette parity had no meaning on a form engine. And the failure mode wasn't a stalled game — it was a signup page that silently accepted invalid input. The kind of regression you don't see until a customer emails.

So it stayed. Three months.

## Why three months

There's a genre of long-tail migration story that ends with a triumphant final commit and a "we're done" tweet. This isn't that. Here's what actually happened.

The primitives weren't blocking anything. Domain code was on Directive; new features shipped without touching the forms engine; the four consumers kept working. The cost of leaving XState in `package.json` was one line of `dependencies` and a bundle-size delta that tree-shaking mostly ate. In the "which fire is loudest" queue, this was not the loudest fire.

But the primitives were blocking one thing: the claim. `.claude/CLAUDE.md` said the migration was complete. It wasn't. The gap wasn't invisible — it was documented in `docs/IDEAS.md` — it just wasn't a priority until it was. This is what "migration complete" actually looks like in a solo-developer codebase: a bookkeeping catch-up long after the loud work is done.

The trigger was a doc-audit pass that pulled the `IDEAS.md` line to the top of the queue. From flag to ported commit: about a week of clock time. From the "official" migration-complete claim to actual completeness: 88 days.

Worth writing down. Worth not pretending otherwise.

## What shipped

One commit (`80fa8fd5` on `main`). Three new Directive modules, one parity test suite, two consumer hooks retrofitted, and a self-contained legacy archive. Numbers:

| Metric | Before | After |
|---|---|---|
| XState machine LOC (input + form + wizard) | 1,972 | 0 (archived) |
| Directive module LOC (input + form + wizard) | — | 1,765 |
| XState parity tests | 2,126 LOC | 0 (archived, still passing) |
| Directive parity tests | — | 1,631 LOC |
| Forms-surface tests total | 119 | 238 (119 legacy + 119 new, both green) |
| `apps/web` test suite | 2,124 | 2,243 (+119, no regressions) |
| Files importing `xstate` outside archive | 9 | 0 |
| `.configs.ts` / `.types.ts` / `.utils.ts` reused unchanged | — | ~90% |
| Consumer behaviour change | — | None (1:1 substrate swap) |

LOC delta is roughly flat, as expected. Test LOC is lower because the ported suite dropped duplicated XState-flush ceremony, not test coverage — every scenario the retired suite exercised has a translated equivalent.

The interesting number in that table isn't a size. It's the last row: consumer behaviour preserved 1:1. `useSignupWizard` still hands the three signup pages the same shape it always did. `useScheduleGameSystem` still satisfies the same `ScheduleGameFormAdapter` contract. The signup pages and the schedule form weren't touched. Substrate swap, full stop.

## The five hardest translations

Domain machines port to Directive along well-worn paths. Discriminated `status`, `pendingAction` fact, derivations that read the fact tree. The forms engine hit shapes those paths don't cover. Five of them stood out.

### 1. Spawned child actors as facts

XState's `spawn` returns an `ActorRef` — a live handle to a child machine with `send`, `getSnapshot`, `subscribe`. The wizard machine spawned one form child per step and held them in a `Map<stepId, ActorRef>`. Consumers read the map to reach into the current step's form.

Directive doesn't spawn child systems as facts. The natural translation is "store the `FormInstance` (Directive's equivalent handle) as a fact." That fails silently. Directive's fact-proxy wraps every stored object to track reads and writes; `FormInstance` holds a `Set<listener>` internally to fan out subscribe callbacks; and `Set`/`Map` internal slots reject proxied receivers with a `TypeError` at the first `.add()`. The proxy is doing exactly the job it's designed for; the mismatch is that a subscription handle is not fact-shaped in the first place.

The fix is a section unto itself, below.

### 2. Sync read-after-write for adapter contracts

The venue-schedule surface has a `ScheduleGameFormAdapter` interface. Its `SUBMIT` handler calls `formRef.submit()` then immediately calls `formRef.isValid()` on the next line — synchronously. The XState form machine happened to satisfy this because its `SUBMIT` transition set `context.errors` before returning from `send()`.

Directive doesn't guarantee sync validation. The straightforward port ran validators through the module's normal async pipeline, which meant `isValid()` returned `true` right up until the microtask queue drained and the errors landed. Every submission looked valid for one tick, which is exactly long enough to fire the "game scheduled" toast before the errors appeared.

The port reproduces XState's exact lifecycle inside `InputInstance.runValidation`: sync validators run first, set `status` before returning, then async validators fan out in parallel. The adapter contract keeps its sync read. This is one of those places where the abstraction isn't "how validation works" — it's "what the caller synchronously observes after `submit()` returns" — and the port has to honour the latter, not the former.

### 3. `clearOnSubmit` semantics divergence

The XState form machine had a `clearOnSubmit` option that reset field values after successful submission. Under XState, `SUBMIT` reached `submitted` via an async `fromPromise` actor — even when no `onSubmit` was configured — and the wizard's `isValid()` read from the parent landed BEFORE `clearOnSubmit` fired because both were racing on `onDone`. Nobody designed it that way. It's just where the microtasks fell.

The port runs `runSubmission` synchronously. Clearing field values before the parent's sync read would erase cross-step aggregation — the wizard reaches back into completed steps to collect their values before advancing. The port branches on `onSubmit`: when it's configured, clear normally after the async handler resolves. When it's absent (the wizard-driven case), skip clearing and stay in `idle`. The cross-step-validation test locks this in.

This is the failure mode you can't grep for. The XState behaviour was accidental — a byproduct of `fromPromise`'s microtask timing — and the port had to reproduce the accident.

### 4. `always` guards → derivation + inline transitions

XState `always` transitions fire whenever a guard becomes true, without an explicit event. The wizard used them for auto-advance when all step validators passed. Directive doesn't have a first-class `always` equivalent — the closest primitive is a derivation that recomputes on fact change, but a derivation returns a value, it doesn't fire an event.

The port collapses each `always` into an explicit event-handler branch that calls a helper (`validatingStep(f)`, `validatingAll(f)`) which runs the transition inline and sets the terminal status. Observable behaviour is preserved. The declarative shape — "when this is true, do that, no matter how you got here" — is lost. In its place, every code path that could have triggered the `always` now explicitly calls the helper. More lines, more explicit, less magic.

Trade-off worth naming. The XState `always` was one of the shapes where XState was strictly more expressive than the Directive port. It didn't cost enough to be worth blocking on, but it's not free either.

### 5. `state.matches('active')` → derivation + status string

XState's `state.matches('submitting')` reaches into a hierarchical state chart and returns a boolean. The parity test suite used it constantly — 200+ assertions. Directive doesn't have hierarchical state; every state is a fact.

Each `matches()` call translates to a boolean derivation (`sys.derive.isSubmitting`) plus a `status` fact carrying the string. To keep the 1,631 LOC of ported assertions readable, the test file routes everything through a `bootWizard()` facade that emits an XState-shaped snapshot with `.value = facts.status`. Same assertion syntax, different runtime underneath. This is a test-only ergonomic — production code reads `sys.derive.isSubmitting` and `sys.facts.status` directly — but without it, the port would have been 200+ line-by-line rewrites of assertions that all say the same thing.

## The sidecar registry pattern

This is the piece worth extracting from the migration and keeping.

Directive's fact-proxy is what makes reactivity work. Every fact read is tracked so derivations know their inputs; every fact write triggers re-evaluation of the constraints that depend on it. The proxy is transparent for JSON-shaped values: strings, numbers, plain objects, arrays. It breaks for two categories of value.

The first — `Date`, `Set`, `Map`, `File` — was documented in the [55-machine post](./migrating-55-machines.md). Assign a `Date.now()` number, not a `Date`. Convert at the boundary.

The second is subscription handles. Any object that holds a `Set<listener>` internally and mutates it via `.add()` / `.delete()` fails when a proxy is in front of the receiver, because `Set` internal slots reject proxied `this`. This isn't a fixable Directive bug; it's a language-level restriction (`Set.prototype.add.call(proxy, item)` throws a `TypeError` — [spec](https://tc39.es/ecma262/#sec-set.prototype.add)). Any object that manages subscriptions or holds a native handle (WebRTC `RTCPeerConnection`, `MediaRecorder`, `WebSocket`, `AudioContext`, `IntersectionObserver`) will hit this the moment it's stored as a fact.

The port's answer: don't store them as facts. Store an ID as a fact, and keep the handle in a module-scoped sidecar.

```ts
// wizardModule.ts

// Module-scoped registry. WeakMap keyed on Module so the sidecar is
// garbage-collected with the module; inner Map keyed on stepId.
const formRegistry = new WeakMap<Module, Map<string, FormInstance>>();

function registerForm(mod: Module, stepId: string, instance: FormInstance) {
  let map = formRegistry.get(mod);
  if (!map) {
    map = new Map();
    formRegistry.set(mod, map);
  }
  map.set(stepId, instance);
}

function getForm(mod: Module, stepId: string): FormInstance | undefined {
  return formRegistry.get(mod)?.get(stepId);
}

// Facts hold the ID, not the instance.
const wizardModule = createModule("wizard", {
  schema: {
    currentStepId: t.string(),
    steps: t.record({
      formRef: t.string(),          // <-- string ID, not a FormInstance
      status: t.string<StepStatus>(),
    }),
  },
  // ...
});

// Consumer resolves ID → instance at mount time.
export function useWizardStep(stepId: string) {
  const system = useContext(WizardSystemContext);
  const stepFacts = useFact(system, `steps.${stepId}`);
  const instance = getForm(system.module, stepFacts.formRef);
  // instance is a plain FormInstance — no proxy in the way.
  return { ...stepFacts, form: instance };
}
```

Three properties fall out:

1. **The proxy never touches the handle.** `Set<listener>` mutations happen against the real `FormInstance`, not a proxied receiver.
2. **The fact tree stays serializable.** IDs are strings. `system.snapshot()` still round-trips through JSON.
3. **Lifecycle tracks the module.** `WeakMap` keying on `Module` means the sidecar is collected when the module is torn down; no manual cleanup.

The cost is one indirection at read time (`formRegistry.get(mod).get(stepId)` before you have the handle) and the discipline of not putting the instance into a fact by accident. TypeScript catches the second one — the `formRef` field is typed `string`, not `FormInstance`, so `formRef: myInstance` is a compile error.

Nothing in `@directive-run/core` needs to change to support this. The pattern is a convention, not an API. It's called out here because the codebase had never needed to store non-serializable runtime resources alongside facts before — WebRTC peers, MediaRecorders, WebSocket handles all lived in ephemeral hook state — and any Directive module that eventually needs to hold one of those has to solve the same problem the wizard just solved. The sidecar registry is the answer that fell out of the port. Worth naming so the next person doesn't rediscover it.

## Why the XState code is still in the repo

The four retired machines + their transitive dependencies (`.configs`, `.types`, `.utils`) live at `apps/web/src/features/forms/application/_legacy_xstate/`. `xstate` and `@xstate/react` stay in `apps/web/package.json` `dependencies`. The archive keeps compiling. Its 119 tests keep running alongside the 119 new Directive tests. Both suites green in CI.

This is deliberate. Three reasons:

1. **The archive is a valid npm-workspace-package-in-waiting.** Nothing in `_legacy_xstate/` couples to Minglingo domain code. It could be lifted to a sibling Sizls project that wants an XState-based forms engine tomorrow, with no coupling to break.
2. **It's a migration-comparison artifact.** The `.configs` files are identical across both engines (~90% of the pre-port code survived unchanged). Diffing `wizard.machine.ts` against `wizardModule.ts` is a live reference for anyone doing a similar port.
3. **Rollback insurance.** If a behavioural regression surfaces that the XState machines happened to handle correctly (see: `clearOnSubmit` semantics), the archive is the reference implementation. Cheaper than reconstructing it from git history.

Runtime cost is zero. Nothing in the current `apps/web` build imports from `_legacy_xstate/`; tree-shaking drops the whole folder from every downstream bundle. Bundle-size delta: none. Test-suite time delta: the archive tests are cheap. `package-lock.json` retains the XState dep tree, which is why the lockfile diff in the commit is the largest single hunk.

Delete-on-a-timer would have been the tidier answer. Keep-and-let-tree-shake is the honest answer. The code is battle-tested; the archive is documented; the cost of keeping it is nothing measurable. Delete when someone needs the space, not before.

## What "migration complete" actually means

The 55-machine post ended with the runtime running on production-validated patterns. That was true in April. What that post didn't say — because it didn't yet know — is that "migration complete" has a long tail.

The domain code was on Directive. The new-feature velocity was on Directive. The claim was on Directive. But the reusable primitives that domain code composed with — the input, form, and wizard machines — were still on XState. Not because anyone missed them. Because they weren't blocking anything and there was always a louder fire.

Three months is a long time for "the migration is complete" and "the migration is complete" to not mean the same thing. Worth writing down the mechanism, because it's not a Minglingo-specific phenomenon.

The mechanism is: **domain migrations are visible; primitive migrations aren't.** When you port a game loop, a product surface changes runtime. Somebody notices. When you port a form engine, four signup pages keep behaving identically and nobody notices. The gate that closes a domain migration — "the surface works, ship it" — has no equivalent for a primitive. The primitive keeps working on either substrate. The migration is complete when someone decides to stop.

The bookkeeping catch-up that closes this gap doesn't come from a sprint plan. It comes from a documentation audit that trips over a stale claim. `docs/IDEAS.md` line 2907 was that trip. From flag to closed: about a week. From the original "complete" claim to actual completeness: 88 days.

The lesson isn't "audit your migration claims more aggressively." The lesson is: the shape of a primitive migration doesn't fit the shape of a domain migration. Neither the estimates nor the gates transfer. If you have both to do, the domain work will ship first because it's louder, and the primitive work will be there when you're ready to catch up.

## What this teaches about porting primitives

Three things, in order of how much they'd change your plan:

**Test parity is the only safety net you get.** A domain machine has product behaviour you can observe; a primitive has adapter contracts that call it in the middle of an event handler. The parity test suite is the specification. 2,126 LOC of tests became 1,631 LOC of tests, one-for-one on scenarios. Every accidental behaviour the retired suite locked in — including `clearOnSubmit`'s microtask race — became a translation constraint. Skip the parity port, and you'll ship a substrate swap that's 95% correct in a way that's very hard to distinguish from 100%.

**The runtime you're porting to may not have a primitive for what you're porting from.** The forms engine hit three: `always` guards have no direct Directive equivalent (collapsed to explicit event-handler branches), spawn-as-fact isn't the pattern (sidecar registry), and hierarchical `state.matches()` doesn't exist (derivation + status string). None of these were showstoppers — every one had a workable answer — but each one added lines the original didn't have. LOC delta near-flat is the right expectation for a primitives port. Directive earns its keep on query state; primitives are where you pay the verbosity tax without the derivation-cache dividend.

**Ninety percent of the code around the machine will survive unchanged.** Every `*.configs.ts`, `input.types.ts`, and most of `wizard.types.ts` came through the port intact. Only `formRef?: ActorRefFrom<AnyActorLogic>` in `StepState` and one xstate import path had to move. That's the number that made this a one-commit change instead of a one-week rewrite. If your primitives are structured so most of the code is config and types with a thin machine core, the port surface is the thin core. Structure primitives that way if you can.

## What's next

Nothing, on the forms engine. It's on Directive, the tests are green, the consumers are unchanged. The sidecar registry pattern will show up next in whichever Minglingo module needs to hold a WebRTC peer connection or a MediaRecorder alongside its facts — likely the video-broadcast module in the next quarter. When it does, this post is the reference.

The 55-machine migration was six weeks of loud domain work. The forms/wizard migration was three months of quiet, and then a week of catch-up. Both count. The runtime is on Directive.

## Try it

- [`@directive-run/core`](https://www.npmjs.com/package/@directive-run/core) — the runtime
- [`@directive-run/react`](https://www.npmjs.com/package/@directive-run/react) — `useFact`, `useDerivation`, `useSyncExternalStore` interop
- [Migrating 55 machines](./migrating-55-machines.md) — the domain-side story this post is the sequel to
- [Migration cheat-sheet from XState](../migrating-from-xstate.md) — patterns catalog, updated with the five translations above

If you're porting a reusable primitive off XState — a form engine, a validation library, a router, anything that other domain code composes with — the shape of the work is different from a domain migration. Expect flat LOC, expect a parity test suite to carry more weight than usual, and expect the sidecar registry pattern the first time you need to store a subscription handle. Worth knowing before you start.

— *Jason, on behalf of the Sizls team*
