# RFC 0010 – `guardrail.blocked` ObservationEvent

| Field | Value |
|---|---|
| Status | Accepted – shipped 2026-06-10 |
| Landing | `@directive-run/core` 1.20.0 + `@directive-run/ai` 1.19.7 |
| Author | Jason Comes |

## Summary

Add a new `ObservationEvent` variant `"guardrail.blocked"` so guardrail
plugins (today: `createFactPIIGuardrail`; future: input-content
guardrails, rate-limit guardrails) emit a typed, backend-neutral signal
that observability sinks can consume without coordinating with
per-plugin user callbacks.

## Motivation

`createFactPIIGuardrail` calls a per-plugin `onBlocked` callback when
it detects PII, but no `ObservationEvent` reaches `system.observe()`.
The downstream effect:

- `attachSourcesToOtel` has no way to surface guardrail activity as
  span events.
- `@directive-run/timeline` renders a `fact.change` event for the
  follow-up redaction write but never shows WHY the redaction happened.
- Audit-ledger plugins that subscribe to `system.observe()` miss every
  guardrail action and rely on the plugin-specific callback chain.
- Operators running the recommended observability bundle (OTel +
  timeline) think they have PII coverage; the guardrail's activity is
  silent unless they wire `onBlocked` separately.

The `Error`-message detection path compounds this: the `Error`
instance is never redacted (`Error.message` is treated as
detection-only since the walker can't construct a new `Error` with
guaranteed `stack` parity). So even the follow-up `fact.change` doesn't
fire – the only signal is `onBlocked`. Without an observation event,
the path is observability-dead.

## Proposed API

### `ObservationEvent` (additive)

```ts
| {
    type: "guardrail.blocked";
    plugin: string;
    key: string;
    kind: "redact" | "alert" | "detect";
    count: number;
    category?: string;
  }
```

- `plugin` – the guardrail plugin's name (`"fact-pii-guardrail"` for
  the built-in). Enables filtering when multiple guardrails are wired.
- `key` – the fact key the violation was found in.
- `kind` – the action the guardrail took:
  - `"redact"` – the guardrail rewrote the value via a follow-up store
    write. Pair with the subsequent `fact.change` event to see the
    redacted result.
  - `"alert"` – the guardrail observed but did not mutate (configured
    `mode: "alert"`). Raw value remains in the store.
  - `"detect"` – the guardrail observed but could not mutate
    (read-only structured types like `Error`). Semantically equivalent
    to `alert` from the operator's point of view but distinguishes
    "couldn't redact" from "chose not to redact".
- `count` – number of pattern matches in this batch (e.g. 3 email
  matches in one nested-object write).
- `category` – optional coarse classifier the guardrail provides so
  OTel exporters can label spans without parsing payloads. The
  built-in PII guardrail emits the first detected category
  (`"email"` | `"ssn"` | `"credit_card"`).

### `Plugin.onGuardrailBlocked` (additive)

```ts
onGuardrailBlocked?: (
  plugin: string,
  key: string,
  kind: "redact" | "alert" | "detect",
  count: number,
  category?: string,
) => void;
```

Plugins that want to subscribe to guardrail activity (without going
through `system.observe()`) implement this hook. The synthetic
observer plugin that backs `system.observe()` implements it and maps
to the typed event.

### `System.notify.guardrailBlocked` (additive)

```ts
readonly notify: {
  guardrailBlocked(
    plugin: string,
    key: string,
    kind: "redact" | "alert" | "detect",
    count: number,
    category?: string,
  ): void;
};
```

A guardrail plugin's `onInit(system)` captures `system`; whenever it
detects a violation, it calls `system.notify.guardrailBlocked(...)`.
The call fans out to every plugin's `onGuardrailBlocked` hook through
the same broadcast fabric as source/effect events.

Application code should not call this directly – use
`system.observe()` to subscribe. The method is on `System` because
plugins are the publishers and need a way to emit into the same
channel observers consume.

## Scope guard

If wiring the OTel + timeline + audit-ledger consumers exceeds ~400
LOC across the four packages, ship the core event + the `notify`
surface + the `createFactPIIGuardrail` emission, and defer consumer
wiring to follow-up patches. The minimum landing is the API; consumers
can subscribe via `system.observe()` immediately.

## Security considerations

- The `count` and `category` fields are deliberately coarse – no
  payload content, no sample of the matched text. This avoids
  exfiltrating PII into observability backends that may have weaker
  retention controls than the primary fact store.
- The `plugin` field is a guardrail-declared string. Guardrails should
  use a stable, non-secret identifier (their plugin name). Trying to
  smuggle context through this field is a misuse pattern; future
  patches may move it to a typed enum.

## Open questions

- Should we add a corresponding `"guardrail.passed"` event so
  operators can see the per-write base rate? Decision: NO for now –
  high-volume systems would saturate observability backends with
  pass events. Backends that need this can synthesize it from
  `fact.change` minus `guardrail.blocked` of the same key.
- Should the event carry the fact's full key (`module::field`) or a
  shortened form? Decision: matches what the engine uses internally
  (full namespaced key). Consumers strip prefixes if needed.

## Acceptance criteria

- [x] `ObservationEvent` union gains the `guardrail.blocked` variant
- [x] `Plugin.onGuardrailBlocked` hook added
- [x] `PluginManager.emitGuardrailBlocked` broadcast added
- [x] `System.notify.guardrailBlocked` surface added
- [x] Synthetic `system.observe()` plugin emits the typed event
- [x] `createFactPIIGuardrail` calls `notify.guardrailBlocked` on
      every detection
- [x] Tests cover the redact + alert paths

## Follow-ups

- `attachSourcesToOtel` should subscribe to `guardrail.blocked` and
  emit OTel span events. Tracked as a separate patch under the same
  RFC.
- `@directive-run/timeline` renderer should add a "guardrail" row
  type. Tracked separately.
- Audit-ledger plugin example documenting the subscription pattern.
