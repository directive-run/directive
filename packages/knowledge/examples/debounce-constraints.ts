// Example: debounce-constraints
// Source: examples/debounce-constraints/src/main.ts
// Extracted for AI rules — DOM wiring stripped

/**
 * Debounce Constraints — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the search input, debounce progress bar, results list,
 * stats, config sliders, and event timeline.
 * A 100ms timer drives reactive debounce countdown.
 */

import { createSystem } from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import { el } from "@directive-run/el";
import {
  debounceSearchModule,
  debounceSearchSchema,
} from "./debounce-search.js";

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: debounceSearchModule,
  trace: true,
  plugins: [devtoolsPlugin({ name: "debounce-constraints" })],
});
system.start();

const allKeys = [
  ...Object.keys(debounceSearchSchema.facts),
  ...Object.keys(debounceSearchSchema.derivations),
];

// ============================================================================
// DOM References
// ============================================================================

// Status bar

// Search form
  "dc-search-input",

// Progress bar

// Query display

// Results

// Stats

// Config sliders
  "dc-debounce-delay",
  "dc-api-delay",
  "dc-min-chars",

// Timeline

// ============================================================================
// Render
// ============================================================================


// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(allKeys, render);

// Timer — tick every 100ms for smooth debounce progress bar
const tickInterval = setInterval(() => {
  system.events.tick();
}, 100);

// ============================================================================
// Controls
// ============================================================================

// Search input — fire on every keystroke

// Clear

// Sliders


// ============================================================================
// Initial Render
// ============================================================================

render();

// Signal to tests that the module script has fully initialized
