/**
 * The HTTP surface. Not implemented — this file marks where it goes and what it
 * has to be built against.
 *
 * ## The contract
 *
 * - **`POST /runs`** takes `{ preset | presets[], input, overrides? }`, where
 *   `preset` is a built-in ID or an inline preset object. The body is validated
 *   with `validatePreset`, which returns every problem at once rather than the
 *   first — that is what it exists for, and an endpoint that re-checked a
 *   couple of fields itself would be a second opinion about what a valid preset
 *   is. Responds `202` with a run ID.
 * - **`GET /runs/:id/events`** is Server-Sent Events, one SSE event per
 *   `HarnessEvent`, `event:` set to the union's `type` and `data:` to the event
 *   as JSON. No translation layer: the union is already free of formatting
 *   decisions, which is what makes it directly serialisable.
 * - **`GET /runs/:id`** is the terminal snapshot — the fields of
 *   `HarnessRunResult`, and for a composition, `ChainRunResult`.
 * - **`DELETE /runs/:id`** calls `Harness.abort()`. It returns `202`, not
 *   `204`: the chain finishes the burst in flight and still synthesizes, so the
 *   run is not over when the request returns.
 *
 * ## What has to be decided before this is written
 *
 * Three things, none of them about the chain.
 *
 * - **Where the transcripts go.** The core writes to a directory. A server
 *   process wants object storage or a per-run temporary directory it cleans up,
 *   and the transcript's `dir` is the only seam that has to move.
 * - **Who pays.** `budgetUsd` arrives in a request body over HTTP, so it is
 *   attacker-controlled. A deployment needs a ceiling the request cannot raise,
 *   applied before `createHarness`.
 * - **Reconnection.** SSE clients drop. Either events are buffered per run with
 *   `Last-Event-ID` replay, or the endpoint documents that a reconnect resumes
 *   from the present and the client re-reads `GET /runs/:id` for what it
 *   missed.
 *
 * @module
 */

export {};
