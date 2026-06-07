---
"@directive-run/ai": minor
---

`attachSourcesToOtel` — pipe core source.* observation events into the
same OTel tracer the AI plugin uses

The R5 observability reviewer found `@directive-run/ai/otel.ts`
subscribes only to the AI `DebugTimeline` event stream, so the four
`ObservationEvent.source.*` variants (`source.attach`,
`source.publish`, `source.detach`, `source.error`) shipped by the
source primitive never reached the OTel exporter. SREs running with
`createOtelPlugin` saw agent spans but could not answer "which source
is publishing?" or "did source `mcp` error attach?" from their
tracing backend.

`attachSourcesToOtel(system, { tracer, serviceName })` closes the gap
as a focused helper (not a second OTel plugin) so a single
`OtelTracer` carries both AI and core source spans. Wire it once at
`createSystem` time:

```ts
import { trace } from "@opentelemetry/api";
import { createOtelPlugin, attachSourcesToOtel } from "@directive-run/ai";

const tracer = trace.getTracer("directive-app");
const otel = createOtelPlugin({ serviceName: "my-app", tracer });

const system = createSystem({ module });
otel.attach(orchestrator.timeline);
const unsub = attachSourcesToOtel(system, { tracer, serviceName: "my-app" });
```

Spans emitted:

- `directive.source.attached` — long-lived span per (sourceId,
  moduleId). Opened at attach; closed at detach with status `OK`.
- `publish` span events on the active span (NOT new spans per
  publish — cardinality budget). At 10 sources × 100 publishes/sec
  the exporter sees 1000 events/sec on 10 long-lived spans, well
  within typical OTel collector budgets.
- `directive.source.error` — short-duration error-status span with
  `directive.phase`, `error.message` (truncated by the manager at the
  R7 boundary).

Optional `publishSampleRate` (default 1.0) sub-samples publish events
for very high-throughput sources.

Tests: 4 regression tests covering attach → detach span lifecycle,
publish-as-event-on-active-span, error span shape, and unsubscribe
behavior.

The complementary `@directive-run/ai/devtools-server.ts` integration
(extend `DevToolsServerMessage` with source.* variants) is deferred to
its own PR — documented in `docs/IDEAS.md`.
