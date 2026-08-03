# @sizls/ai-harness

A set of personas take turns on one growing transcript. Each turn reads everything said before it and adds a short contribution, and the chain keeps going until the money runs out or you interrupt it; then a synthesizer reads the whole transcript and writes the closing document – a review report, a risk register, a brief.

It is for problems where several angles on the same material beat one long answer: a diff four reviewers argue over, a proposal you want attacked before you build it, a codebase nobody left notes about. The chain is built as a Directive module rather than as a loop, which is worth reading about if you are deciding between this and writing the loop yourself – see [How it's built](#how-its-built).

## Install

Node 18 or newer.

```bash
npm install -g @sizls/ai-harness
```

> **Not published yet.** The line above is the one that will work once this
> package is on npm; today it is private, and the way in is a checkout of the
> monorepo — `pnpm install`, then `pnpm --filter @sizls/ai-harness build`, and
> `node packages/ai-harness/dist/cli.js` wherever `harness` appears below.

## One command

Offline first, so it runs with no API key:

```bash
harness --preset pre-mortem --dry-run \
  --input "Ship a bot that auto-merges dependency PRs when CI is green."
```

```
┌   harness
│
▲  Costs below are fictional: every model bills at one nominal rate and the canned
   answers ignore each preset's tokens-per-turn, so they compare neither between
   presets nor to a live run. Use --list-presets for what a real run is expected to cost.
  engineer · security · product · user
  budget $0.10 → …/runs/run-1785778464874-xpxvn7.md

1. engineer $0.0018

(dry run — engineer)

No provider was called. This paragraph stands in for a persona's turn so the run
exercises the same transcript, the same ledger, and the same termination path a
live one does. …

… (four more turns)

synthesis after 5 turns — stopped on max-iterations

(dry run — closing document by risk-register)

No provider was called. A live run puts the synthesizer's document here, written
from the whole transcript above.

  5 turns · $0.0154 of $0.10 (dry-run pricing) · stopped on max-iterations
  …/runs/run-1785778464874-xpxvn7.md

│
└  done (dry run)
```

The same command live. Drop `--dry-run` and export `ANTHROPIC_API_KEY`:

```bash
export ANTHROPIC_API_KEY=sk-ant-…
harness --preset pre-mortem \
  --input "Ship a bot that auto-merges dependency PRs when CI is green."
```

```
┌   harness
  engineer · security · product · user
  budget $0.10 → …/runs/run-1785778494430-zaqo6b.md

1. engineer $0.0087

## Failure: Cascading Breakage from Transitive Dependency Conflict

**What broke:** The bot auto-merged a minor version bump of `lodash` … CI passed
because our test suite only exercised direct usage patterns. Three hours later,
the payment processing workflow started failing …

2. security $0.0103

## Failure: Supply Chain Compromise via Dependency Confusion

**What broke:** The bot auto-merged a malicious package. An attacker published
`@ourcompany/auth-utils` version 2.1.5 to the public npm registry …

3. product $0.0119

… 4. user $0.0135 …

synthesis after 4 turns — stopped on budget

… the risk register …

  4 turns · $0.0843 of $0.10 · stopped on budget
  …/runs/run-1785778494430-zaqo6b.md

│
└  done
```

Both runs wrote two files: the transcript and a JSONL sidecar. See [Interrupting, and what's on disk](#interrupting-and-whats-on-disk).

## What it costs

The dollar figure on a preset is a **ceiling, not an expected cost**. It is the number the chain refuses to cross. One of the eight shipped presets never approaches it – `code-review` runs out of turns first, at about $0.23 of its $0.30 cap – and the other seven spend theirs.

The chain stops adding turns while it can still pay for the closing document. That document is the expensive call: the synthesizer is capped at several thousand output tokens against a turn's few hundred, and it reads the entire transcript on the way in. In the live run above, four turns came to $0.0444 and the closing document came to $0.0399 on its own – roughly three times the last turn.

Cost per turn grows through a run, because every turn re-reads everything before it. The four turns above billed $0.0087, $0.0103, $0.0119, $0.0135 – about a sixth of a cent more each time, on a transcript growing by one turn. So a budget does not buy a fixed number of turns, and a preset that gets eight turns on a one-line input gets fewer on a long diff.

A budget too small to pay for its own synthesis is refused when you build the harness, not discovered four calls in:

```
[ai-harness] budgetUsd of $0.0010 cannot pay for this preset's closing document,
which prices at $0.0375 (2500 output tokens at $15/M). The chain would spend the
budget on turns and then have nothing left to summarise them with. Raise the
budget above $0.0375, or lower `synthesizer.maxTokens`.
```

The reserve is arithmetic, not a guess – the synthesizer's cap and the transcript's length are both known before the call – but it can still come up short on a budget spent down to the last cent. When it does, the chain declines the synthesis rather than spending past its number, and says so: the run is `"complete"`, `synthesis` is `""`, and `synthesisSkipped` is true on the result and on a `budget:synthesis-skipped` event. That is the budget working, not breaking.

There is a second way to finish with no closing document and nothing having failed, and it is the quieter one: a budget that covers the synthesis but not a first turn *alongside* the synthesis that turn would leave owing. The chain is refused at construction only when the budget cannot pay for the closing document at all, so a figure between the two is accepted and produces a run of zero turns – `iterations: 0`, `stopReason: "budget"`, `synthesisSkipped: false`, because no synthesis ever came due. The command line names it rather than printing an empty run:

```
  no turns — $0.0400 covers the closing document but not a first turn alongside it. Raise the budget.
```

Offline costs are fictional rather than approximate: `--dry-run` bills every model at one nominal rate and answers with a fixed paragraph that ignores `tokensPerTurn`, so the figures compare neither between presets nor to a live run. They exist so the ledger moves, because a chain whose spend never moves never reaches the condition it terminates on.

For real figures, `--list-presets` says which ceiling actually stops each preset and what a run is expected to cost:

```bash
harness --list-presets
```

```
Built-in presets

  code-review  — Code review
    Four reviewers take turns on one diff, then a written report.
    4 personas · 700 tokens a turn · claude-sonnet-4-5-20250929
    stops on: the turn ceiling, at 8 turns — expect about $0.23, well under the $0.30 cap

  pre-mortem  — Pre-mortem
    Four voices assume the proposal already failed and say why, then a ranked
    list of the failure modes worth designing against.
    4 personas · 500 tokens a turn · claude-sonnet-4-5-20250929
    stops on: the budget, after about 4 turns — expect about $0.0883 of the $0.10 cap

  …

The dollar figure is a ceiling, not a price: the chain refuses to start a
turn it cannot pay for alongside the closing document it still owes. The
expected figure assumes an empty input, which puts it low, and every turn
using its full token allowance, which puts it high — so it is a middle
estimate a real run can land either side of. The cap is not an estimate.
```

The expected figure is a replay of the chain's own stopping arithmetic — the same functions the running chain calls, not a second model of it. Its two assumptions pull in **opposite** directions: an empty input puts the figure low, since a long subject makes every prompt longer, while every turn using its full `tokensPerTurn` puts it high, since that is a cap a model need not reach. So it is a middle estimate rather than a bound in either direction. The cap beside it is not an estimate at all.

## The presets

| id | What you get | Stops on | Expect |
|---|---|---|---|
| `code-review` | Four reviewers – correctness, security, design, tests – take turns on one diff, then a report that resolves their disagreements. | turn ceiling, 8 turns | ~$0.23 of $0.30 |
| `pre-mortem` | Four voices assume the proposal already shipped and failed, then a risk register ranked by expected damage. | budget, ~4 turns | ~$0.088 of $0.10 |
| `brainstorm` | Five ways of attacking an open question – approaches, not job titles – then a shortlist. | budget, ~5 turns | ~$0.098 of $0.10 |
| `archaeology` | What the pieces of an unfamiliar codebase are, where its state lives, what breaks when you touch it, what to do first. | budget, ~19 turns | ~$0.20 of $0.20 |
| `decipher` | Work out what obfuscated or minified code **you already have** does – an inherited bundle, unsourced build output, a sample under analysis – closing with how to detect and contain it. Defensive: every persona is told it is explaining an artefact the operator possesses. | budget, ~15 turns | ~$0.14 of $0.15 |
| `crypto-101` | How a cryptographic primitive or protocol works, and a review of your own code's use of it. Defensive and educational: published weaknesses explained the way a textbook does, and the review persona reads code you own. | budget, ~15 turns | ~$0.14 of $0.15 |
| `research` | A long pass over one topic with a skeptic speaking every round, closing with a brief that separates the settled from the contested. Nothing browses – it works from the model's own knowledge and what you paste in. | budget, ~24 turns | ~$0.24 of $0.25 |
| `moonshot` | Candidate directions for a domain expert to evaluate, each paired with how they'd evaluate it. Not conclusions and not evidence: a skeptic runs in every round, and a hypothesis that cannot be given an evaluation path does not make the list. | budget, ~12 turns | ~$0.28 of $0.30 |

Any of them takes a path instead of an id, and several run in order:

```bash
harness --compose code-review,pre-mortem --input-file change.diff --dry-run
```

A composition runs each preset as its own chain with its own transcript, and hands the next one the *finished document* rather than the running conversation. `budgetUsd` is per step, so three presets is three budgets of exposure; `--total-budget` caps the whole thing.

## Writing a preset

A preset is plain JSON. Every knob is in the file, nothing in it is a function, and it can be read off disk, posted to an endpoint, or pasted into a form.

The block below is annotated with `//` comments for reading. **Strip them – a preset file is JSON, and comments will not parse.**

```jsonc
{
  "id": "release-notes",
  "meta": {
    "label": "Release notes",
    "description": "Three voices read a changelog and argue about what users need told.",
    "category": "writing",
    "tags": ["release-notes"]
  },

  "model": "claude-sonnet-4-5-20250929",
  "temperature": 0.6,

  // One contribution, not an essay. This is the cap on a single turn's output,
  // and every later turn re-reads that output as context – so it drives cost
  // superlinearly, not linearly. 400–700 is the conventional range.
  "tokensPerTurn": 500,

  // A ceiling, not a price. The chain stops while what is left still covers
  // the next turn and the closing document that turn will leave it owing. It
  // must clear the synthesizer's cost on its own, or construction refuses.
  "budgetUsd": 0.25,

  // A backstop, rarely the thing that stops a run. It exists for the case the
  // budget cannot catch – a provider that reports no usage. 8–12 is normal.
  "maxIterations": 10,

  "budgetWarningThreshold": 0.8,

  "personas": [
    {
      "name": "what-changed",
      "systemPrompt": "You state plainly what changed, from the material in front of you. No adjectives, no benefits – the change itself. Where the material does not say, say that it does not."
    },
    {
      "name": "who-breaks",
      "systemPrompt": "You find who has to do work because of this. Name the caller, the config, or the assumption that stops holding, and say what they have to change. If nothing breaks, say so once and stop."
    },
    {
      "name": "reader",
      "systemPrompt": "You are the person skimming this at 9am to decide whether to upgrade. Say which lines told you nothing, which sentence you would actually have needed, and where the earlier voices buried it."
    }
  ],

  "promptTemplate": "The changes:\n\n<changes>\n{{input}}\n</changes>\n\nThe discussion so far:\n\n<discussion>\n{{transcript}}\n</discussion>\n\nYour turn as {{persona}} (round {{iteration}}). Add what only you would notice. Roughly {{tokensPerTurn}} tokens.",

  "synthesizer": {
    "name": "notes",
    "systemPrompt": "You write the release notes the discussion argued its way to. You lead with what makes someone act, and you cut anything the reader persona called noise.",
    "promptTemplate": "The changes:\n\n<changes>\n{{input}}\n</changes>\n\nThe discussion, after {{iterations}} rounds:\n\n<discussion>\n{{transcript}}\n</discussion>\n\nWrite the release notes. Lead with anything that breaks a caller, then what is new, then the rest.",

    // Five to thirty times a turn, and the entire reserve – the chain holds
    // this much back from every turn decision. 2000–4000 is the usual range.
    "maxTokens": 3000
  }
}
```

Run it:

```bash
harness --preset ./my-preset.json --dry-run --input "Bumped the minimum Node version to 20."
```

### Placeholders

Rendered with `{{name}}`. A name with no value is left in the prompt exactly as written, so a template mentioning `{{TODO}}` reaches the model saying so rather than silently losing it.

`promptTemplate` – the per-turn prompt:

| Placeholder | Value |
|---|---|
| `{{input}}` | What the operator supplied, fenced |
| `{{persona}}` | The name of the persona whose turn it is |
| `{{iteration}}` | Round number, 1-based |
| `{{previousTurn}}` | The text of the turn immediately before, fenced |
| `{{transcript}}` | Every turn so far, each one fenced |
| `{{tokensPerTurn}}` | The preset's own `tokensPerTurn`, so the prompt can ask for that length |

`synthesizer.promptTemplate` – the closing document's prompt:

| Placeholder | Value |
|---|---|
| `{{input}}` | The same fenced input |
| `{{transcript}}` | The whole finished transcript |
| `{{iterations}}` | How many turns completed |
| `{{spentUsd}}` | Total spend, to four decimal places |
| `{{stopReason}}` | `"budget"`, `"max-iterations"`, `"interrupted"`, or `"error"` |

The two sets are not interchangeable. `{{persona}}` in a synthesizer template stays literal, and so does `{{stopReason}}` in a turn template.

### Names must all differ

Every persona name and the synthesizer's name must be unique within the preset. The name is the agent identifier, so two personas sharing one silently collapse into a single registration – the second one's system prompt is discarded while turn order keeps calling on it. A persona sharing the synthesizer's name is worse: the token cap is chosen by comparing the agent name against the synthesizer's, so that persona would run with the closing document's much larger cap and quietly cost several times what the preset budgeted. Neither raises anything at runtime, which is why the schema refuses both.

### The counter-example that ships

`presets/custom/dream.json` in this package is deliberately unusual – three tokens a turn, where every built-in uses several hundred – because for that preset the fragment *is* the artefact. Copy it for the shape of a preset file, not for its numbers.

### In TypeScript

`definePreset` is identity with the types and the schema attached, so a bad preset fails at import rather than three turns into a run:

```typescript
import { definePreset } from "@sizls/ai-harness";

export default definePreset({
  id: "release-notes",
  model: "claude-sonnet-4-5-20250929",
  personas: [{ name: "what-changed", systemPrompt: "…" }],
  tokensPerTurn: 500,
  budgetUsd: 0.25,
  maxIterations: 10,
  promptTemplate: "{{transcript}}\n\nYour turn, {{persona}}.",
  synthesizer: {
    name: "notes",
    systemPrompt: "…",
    promptTemplate: "{{transcript}}",
    maxTokens: 3000,
  },
});
```

It checks the schema, not the budget floor – the budget-versus-synthesis check needs the model's rates and happens when you build the harness.

## Using it from code

Four entry points, in order of how much you want to hold.

**Offline, with no API key.** The command line's `--dry-run` is not a command-line feature – it is `createMockRunner` supplied as the `runner` option, and the same two lines work from code. A runner sits at the *base* of the chain, under the retry policy and the ledger, so an offline run terminates on the same condition an online one does. That is what makes it worth testing against.

```typescript
import { createMockRunner, preMortemPreset, runHarness } from "@sizls/ai-harness";

const result = await runHarness(preMortemPreset, proposal, {
  runner: createMockRunner({
    // Keyed by agent name. Anything without an entry gets `defaultResponse`.
    responses: {
      engineer: "The dependency graph is the failure surface …",
      security: ["First turn.", "Second turn."], // an array cycles per call
    },
    // Scripted failures, for exercising the retry and error paths.
    failures: [{ agent: "product", call: 1, afterDeltas: 3 }],
  }),
  pricing: { inputPerMillion: 3, outputPerMillion: 15 },
});
```

Supply `pricing` alongside it. A mock reports token usage proportional to the text it produces, and the ledger prices that at whatever rates it was given – so the offline chain's spend moves, and a chain whose spend never moves never reaches the condition it terminates on. Without `pricing` the preset's real model rates are used, which is fine for a single preset and misleading across a composition that names several.

Every option below takes `runner` the same way, `runComposition` included.

**One run, nothing to clean up** – `runHarness`. It builds the harness, runs it, and destroys the system on the way out.

```typescript
import { preMortemPreset, runHarness } from "@sizls/ai-harness";

const result = await runHarness(preMortemPreset, proposal, {
  apiKey: process.env.ANTHROPIC_API_KEY,
});

console.log(result.stopReason, result.spentUsd, result.synthesis);
```

**You need the system, or you need to stop it** – `createHarness`. Same run, but you get `harness.system`, `harness.transcript` (readable mid-run), and `harness.abort()`.

```typescript
import { codeReviewPreset, createHarness } from "@sizls/ai-harness";
import { createFileTranscriptStore } from "@sizls/ai-harness/node";

const harness = createHarness(codeReviewPreset, {
  apiKey: process.env.ANTHROPIC_API_KEY,
  transcripts: createFileTranscriptStore({ dir: "./runs" }),
  onEvent: (event) => {
    if (event.type === "turn:completed") {
      console.log(`${event.persona}: ${event.text}`);
    }
  },
});

process.on("SIGINT", () => harness.abort());

const result = await harness.run(diff);
harness.system.destroy();
```

`options.signal` does the same thing as `abort()` for callers already holding an `AbortSignal`. One harness runs once; build another for another run.

**Several presets in order** – `runComposition`. Each step reads what the previous ones concluded, not their turns.

```typescript
const result = await runComposition([codeReviewPreset, preMortemPreset], diff, {
  apiKey: process.env.ANTHROPIC_API_KEY,
  totalBudgetUsd: 0.5,
});
```

**The chain inside your own system** – `createHarnessChain`. It hands back an ordinary Directive module plus the one call that points its constraints at the system running them.

```typescript
import { createSystem } from "@directive-run/core";
import {
  createHarnessAgents, createHarnessChain, createMemoryTranscriptStore, createRunId,
} from "@sizls/ai-harness";

const runId = createRunId();
const store = createMemoryTranscriptStore();

const chain = createHarnessChain({
  preset,
  runId,
  transcript: store.open({ runId }),
  agents: createHarnessAgents({ preset, apiKey: process.env.ANTHROPIC_API_KEY }),
  emit: (event) => { /* … */ },
});

const system = createSystem({ modules: { chain: chain.module, billing: billingModule } });
chain.bind(system, "chain");     // between createSystem() and start()
system.start();
system.events.chain.start({ input: diff });
```

The chain then shares your plugins, your devtools session, and your reconciliation loop. `bind` needs the namespace in the `modules:` form and refuses it in the `module:` form, loudly, because getting it wrong otherwise means every gating derivation reads `undefined` and the chain sits idle saying nothing.

`harness.system` is exposed on purpose in all of these. It is an ordinary Directive system – `inspect()` it, attach an observer, read `system.derive.stopReason` mid-run, destroy it when you like. Hiding it behind a façade would only re-expose the same things under worse names. Reading facts off it is fine; writing them is not, because every fact has a resolver or an event that owns it.

**The library writes nothing to disk unless you tell it where.** The default transcript store keeps the run in memory and reports paths as `memory://run-….md`, which surprises people who expect files. The filesystem is a separate entry point – `@sizls/ai-harness/node` – rather than a named export from the package root, because a static re-export is not conditional: importing `runHarness` would have imported `node:fs` with it. Nothing on the package's main entry loads a node builtin, so it runs on a worker, an edge runtime, or a bundle for the browser. The CLI supplies the file store for you; a server surface supplies its own, and the chain never learns there was no disk.

Everything a surface can see comes through `onEvent` as a `HarnessEvent` – turn started, delta, restarted, completed, cost updated, budget warning, synthesis started, chunk, phase change, chain complete, plus four `composition:*` events. The CLI has no private channel; it reads the same union and renders it.

## How it's built

This is the section that matters if you are weighing this package against writing the loop yourself.

The obvious implementation is a `while`: run a turn, add up the cost, check the budget, pick the next persona, go again, and drop out to a synthesis step at the bottom. That works. It has one property that makes it a bad foundation – every question the chain answers is answered inside the loop body, so nothing outside can see the answer or change it. "Are we out of budget" is a `break`. "Did the operator interrupt" is a flag read at the top. Adding a stop condition means editing the loop.

Here the same chain is five layers, and there is no loop anywhere.

**Facts are where the chain is.** `iteration`, `spentUsd`, `lastTurnUsd`, `previousTurnUsd`, `transcriptChars`, `interrupted`, `synthesized`, `failure`, `budgetHalted`. Nothing but a resolver or an event handler writes them, and no fact encodes a decision – `interrupted` says an operator asked to stop, not what should happen next.

**Derivations are what the facts mean.** `remainingUsd`, `projectedTurnUsd` (the last turn plus the growth between the last two), `synthesisReserveUsd` (the synthesizer's `maxTokens` at the output rate, plus the measured transcript at the input rate), `canAffordTurn`, `iterationsExhausted`, `chainStopped`, `stopReason`, `nextPersona`, `turnPending`, `synthesisPending`, `phase`. Every question the loop body used to answer inline is one of these, computed in exactly one place and readable from outside.

**Constraints ask only whether something is pending.** There are two. `runTurn` fires while `turnPending`; `synthesize` fires while `synthesisPending`. Neither one mentions budgets, interrupts, or turn order – each reads a derivation and emits a requirement.

**Resolvers make the calls.** Call the agent, write what came back to facts. They do not decide whether they should have run. The turn requirement is keyed `turn-<iteration>`, so the several re-emissions that happen as facts settle collapse into one requirement and the turn runs once.

**Effects write things down.** Mirroring the transcript to whatever store the run was opened on, and emitting the event stream.

### One path, end to end

Someone presses Ctrl-C. That calls `abort()`, which dispatches an `interrupt` event, whose entire handler is `facts.interrupted = true`.

`chainStopped` reads `interrupted` among its clauses, so it recomputes and goes true. `turnPending` is `running && !chainStopped`, so it goes false, and the `runTurn` constraint stops holding – it emits nothing, and no further turn is ever authorized. `synthesisPending` is `running && chainStopped && iteration > 0 && !synthesized && …`, so it goes true, the `synthesize` constraint fires once, and its resolver writes the closing document and sets `synthesized` – which falsifies `synthesisPending` too. No constraint has anything left to require, no requirement is unmet, and the system settles. The chain ends by running out of things that must be true.

The turn that was in flight when the key was pressed finishes normally and writes its facts. No branch anywhere handles "interrupted mid-turn", because there is no loop to be in the middle of – there is a resolver already running and a constraint that will not ask for another one.

A budget stop is the identical cascade entered through a different door. The turn resolver writes `spentUsd`, `lastTurnUsd`, and `transcriptChars`; those invalidate `projectedTurnUsd` and `synthesisReserveUsd`, which invalidate `canAffordTurn`, which invalidates `chainStopped`, and everything downstream happens exactly as above.

### What that buys

Adding a new reason to stop is one clause in one derivation, and no constraint changes. There are five already – the hard ledger floor, a failed turn, an interrupt, an unaffordable next turn, and the iteration ceiling – and they are clauses of one boolean rather than five `break` sites scattered through a loop body.

The reported stop reason is a pure function of state. `stopReason` is one expression with a documented precedence over those five, so the chain cannot report `"error"` for a run that simply hit its ceiling, and there is no sixth site where someone forgot to set the variable on the way out. The same is true of `phase`: nothing assigns it, so no code path can put the chain in a phase its facts do not justify.

It also makes the cost estimate honest. `--list-presets` replays `projectedTurnUsd`, `synthesisReserveUsd`, and `canAffordTurn` offline against the same preset – a replay of the chain's own arithmetic, not a second model of it. That is only possible because the arithmetic is derivations rather than loop-body code.

### What it does not buy

Directive's time-travel will not replay a run. The transcript and the cost ledger both live outside the fact store – the transcript is an in-memory document that an effect mirrors, and spend is copied in from the runner's ledger – so rewinding facts rewinds neither. What you actually get from the system is `inspect()`, the devtools trace, and every derivation readable from outside while the run is going. And the chain still calls a provider, so nothing about this makes a run reproducible.

## Vocabulary

- **Turn** – one persona's contribution, capped at `tokensPerTurn`. It is added to the transcript whole, never token by token, so a retried call cannot leave half an abandoned turn in front of the next persona.
- **Persona** – one voice, defined by a name and a system prompt. Turn order is round-robin and wraps, so four personas over six turns means two of them speak twice.
- **Synthesizer** – the voice that reads the finished transcript once and writes the closing document. Larger token cap, and the reason the budget holds money back.
- **Preset** – the JSON file holding all of the above plus the ceilings.
- **Chain** – one preset's run: turns, then a synthesis, then done.
- **Composition** – several presets run in sequence, each handed the previous ones' closing documents.

"Harness" here is the older sense – the scaffolding that drives a model through a task – not the test-harness sense. Nothing in this package runs your tests.

## Interrupting, and what's on disk

The first Ctrl-C asks. The turn in flight finishes, the chain synthesizes what it has, and the transcript is whole:

```
▲  Interrupt — finishing the turn in flight, then synthesizing. Press Ctrl-C again to exit now.
```

The second exits immediately with code 130, because an operator pressing it twice has stopped asking politely. From code, `harness.abort()` and `options.signal` do what the first Ctrl-C does. Neither is forwarded to the provider request – tearing up a response mid-stream is the one thing the chain is built not to do.

Interrupting a composition ends the composition, not just the running step.

The CLI writes to `--out-dir`, default `./runs`. A run produces two files:

- `<runId>.md` – the transcript. A heading with the run ID, the input, then `## 1. persona` per turn, then `---` and `# Synthesis`. This is the artefact, so it holds exactly what the model produced, escape sequences and all; those are stripped on the way to your terminal instead, where they would otherwise clear the screen or write your clipboard.
- `<runId>.jsonl` – the structured sidecar, one line per turn: `turn`, `persona`, `text`, `costUsd`, `at`. Turns only – the closing document is in the markdown. `turn` counts from one and matches the markdown's `## N. persona` heading exactly, so joining the two files on it attributes each turn to the persona that took it. (The event stream's `iteration` is the zero-based index of the same turn; the two artefacts use `turn` so one word does not mean two numbers.)

A composition adds a third: `<runId>.md` holding every step's synthesis in order, alongside each step's own `<runId>-<n>-<presetId>.md` and `.jsonl` pair.

Reusing a run ID is refused rather than half-honoured, because the markdown is rewritten whole and the sidecar is appended to, so the two would end up describing different runs with nothing saying which. If you use the library's file store without naming a directory, it writes to `.ai-harness/` under the working directory.

## Untrusted input

Every turn is read by every later persona and by the synthesizer, so text the model produces becomes text later agents read. Turns and quoted material are fenced in tags carrying a random per-run marker, with the marker stripped from the body, so a turn cannot forge the structure that separates turns or pass its own text off as the harness's – and every voice is told, in a notice appended to its system prompt, that everything outside that prompt is quoted material rather than instruction.

That makes the structure unforgeable, not the content harmless. A persona can still be argued off-task, misled, or talked into a tangent by an earlier turn, because a shared transcript is the entire mechanic of the package. Treat the input to a chain the way you'd treat input to any model whose output you intend to act on, and don't wire a chain's output to anything with authority.

## License

MIT OR Apache-2.0
