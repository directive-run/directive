/**
 * The MCP surface. Not implemented — this file marks where it goes and what it
 * has to be built against.
 *
 * ## The contract
 *
 * An MCP server exposes the same three things every other surface does, and
 * gets all of them from the SDK and the event stream — never from the system's
 * facts, and never from a channel the CLI does not also have.
 *
 * - **Tools.** `harness_run(preset, input, overrides?)` and
 *   `harness_chain(presets[], input, overrides?)` wrap `runHarness` and
 *   `runChain`. `harness_presets()` lists `PRESET_LIST` from each preset's
 *   `meta`, exactly as `--list-presets` does.
 * - **Progress.** MCP progress notifications map from `HarnessEvent`:
 *   `burst:started` and `burst:completed` carry the fraction
 *   `iteration / maxIterations`, `cost:updated` and `budget:warning` carry
 *   spend, and `composition:step:started` names the step of a chain. The token
 *   events (`burst:delta`, `synthesis:chunk`) have no progress meaning and are
 *   dropped rather than throttled.
 * - **Result.** The tool returns the synthesis text plus the transcript paths
 *   from `chain:complete` — the same fields `HarnessRunResult` carries, because
 *   they are the same run.
 *
 * ## What has to be true before this is written
 *
 * Cancellation. MCP's cancellation notification has to reach `Harness.abort()`
 * — which flips the interrupt fact so the burst in flight finishes and the
 * chain still synthesizes. A cancellation that tore up the request would leave
 * a transcript holding half a burst, which is the one outcome the core is built
 * to prevent, so this surface must not implement cancellation as a request
 * abort.
 *
 * Nothing here reaches into the system. If this surface turns out to need a
 * field the event union does not carry, the union gets the field.
 *
 * @module
 */

export {};
