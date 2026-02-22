/**
 * Debounce Constraints — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the search input, debounce progress bar, results list,
 * stats, state inspector, config sliders, and event timeline.
 * A 100ms timer drives reactive debounce countdown.
 */

import { createSystem } from "@directive-run/core";
import {
  debounceSearchModule,
  debounceSearchSchema,
  type SearchResult,
  type EventLogEntry,
} from "./debounce-search.js";

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  module: debounceSearchModule,
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
const statusIndicator = document.getElementById("dc-status-indicator")!;
const statusText = document.getElementById("dc-status-text")!;

// Search form
const searchInput = document.getElementById("dc-search-input") as HTMLInputElement;
const clearBtn = document.getElementById("dc-clear-btn") as HTMLButtonElement;

// Progress bar
const progressWrap = document.getElementById("dc-progress-wrap")!;
const progressBar = document.getElementById("dc-progress-bar")!;

// Query display
const rawQueryEl = document.getElementById("dc-raw-query")!;
const debouncedQueryEl = document.getElementById("dc-debounced-query")!;

// Results
const resultsList = document.getElementById("dc-results-list")!;
const resultsFooter = document.getElementById("dc-results-footer")!;

// Stats
const statKeystrokes = document.getElementById("dc-stat-keystrokes")!;
const statApiCalls = document.getElementById("dc-stat-api-calls")!;
const statSaved = document.getElementById("dc-stat-saved")!;

// Inspector
const derivDebouncing = document.getElementById("dc-deriv-debouncing")!;
const derivProgress = document.getElementById("dc-deriv-progress")!;
const derivSearching = document.getElementById("dc-deriv-searching")!;
const derivResultCount = document.getElementById("dc-deriv-result-count")!;

// Config sliders
const debounceDelaySlider = document.getElementById("dc-debounce-delay") as HTMLInputElement;
const debounceVal = document.getElementById("dc-debounce-val")!;
const apiDelaySlider = document.getElementById("dc-api-delay") as HTMLInputElement;
const apiDelayVal = document.getElementById("dc-api-delay-val")!;
const minCharsSlider = document.getElementById("dc-min-chars") as HTMLInputElement;
const minCharsVal = document.getElementById("dc-min-chars-val")!;

// Timeline
const timelineEl = document.getElementById("dc-timeline")!;

// ============================================================================
// Render
// ============================================================================

function renderBoolDeriv(el: HTMLElement, value: boolean, pulseClass?: string): void {
  const indicator = value
    ? `<span class="dc-deriv-indicator ${pulseClass || "true"}"></span>`
    : '<span class="dc-deriv-indicator false"></span>';
  el.innerHTML = `${indicator} ${value}`;
}

function render(): void {
  const facts = system.facts;
  const derive = system.derive;

  const query = facts.query as string;
  const debouncedQuery = facts.debouncedQuery as string;
  const results = facts.results as SearchResult[];
  const isSearching = facts.isSearching as boolean;
  const keystrokeCount = facts.keystrokeCount as number;
  const apiCallCount = facts.apiCallCount as number;
  const isDebouncing = derive.isDebouncing as boolean;
  const debounceProgress = derive.debounceProgress as number;
  const resultCount = derive.resultCount as number;
  const savedCalls = derive.savedCalls as number;
  const eventLog = facts.eventLog as EventLogEntry[];

  // --- Status indicator ---
  if (isDebouncing) {
    statusIndicator.className = "dc-status-indicator debouncing";
    statusText.textContent = "Debouncing...";
  } else if (isSearching) {
    statusIndicator.className = "dc-status-indicator searching";
    statusText.textContent = "Searching...";
  } else {
    statusIndicator.className = "dc-status-indicator";
    statusText.textContent = "";
  }

  // --- Progress bar ---
  if (debounceProgress > 0) {
    progressWrap.classList.remove("hidden");
    progressBar.style.width = `${debounceProgress * 100}%`;
  } else {
    progressWrap.classList.add("hidden");
    progressBar.style.width = "0%";
  }

  // --- Query display (don't clobber search input) ---
  rawQueryEl.textContent = `"${query}"`;
  debouncedQueryEl.textContent = `"${debouncedQuery}"`;

  // --- Results list ---
  if (query === "" && results.length === 0) {
    resultsList.innerHTML = '<div class="dc-results-empty">Type to search 30 tech items...</div>';
  } else if (results.length === 0 && debouncedQuery.length > 0 && !isSearching && !isDebouncing) {
    resultsList.innerHTML = `<div class="dc-results-empty">No results for "${escapeHtml(debouncedQuery)}"</div>`;
  } else if (results.length === 0 && (isSearching || isDebouncing)) {
    resultsList.innerHTML = '<div class="dc-results-empty">Searching...</div>';
  } else {
    resultsList.innerHTML = "";
    for (const item of results) {
      const el = document.createElement("div");
      el.className = "dc-result-item";

      const badgeClass = item.category.toLowerCase();

      el.innerHTML = `
        <span class="dc-result-title">${escapeHtml(item.title)}</span>
        <span class="dc-result-badge ${badgeClass}">${escapeHtml(item.category)}</span>
      `;

      resultsList.appendChild(el);
    }
  }

  // --- Footer ---
  const savedPct = keystrokeCount > 0 ? Math.round((savedCalls / keystrokeCount) * 100) : 0;
  resultsFooter.textContent = `${resultCount} result${resultCount !== 1 ? "s" : ""} \u00b7 ${keystrokeCount} keystroke${keystrokeCount !== 1 ? "s" : ""} \u00b7 ${apiCallCount} API call${apiCallCount !== 1 ? "s" : ""} (${savedCalls} saved)`;

  // --- Stats ---
  statKeystrokes.textContent = `${keystrokeCount}`;
  statApiCalls.textContent = `${apiCallCount}`;
  statSaved.textContent = `${savedCalls} (${savedPct}%)`;

  // --- Inspector ---
  renderBoolDeriv(derivDebouncing, isDebouncing, isDebouncing ? "debouncing" : undefined);
  derivProgress.textContent = debounceProgress.toFixed(2);
  renderBoolDeriv(derivSearching, isSearching, isSearching ? "searching" : undefined);
  derivResultCount.textContent = `${resultCount}`;

  // --- Slider labels ---
  debounceVal.textContent = `${facts.debounceDelay}ms`;
  apiDelayVal.textContent = `${facts.apiDelay}ms`;
  minCharsVal.textContent = `${facts.minChars}`;

  // --- Timeline ---
  if (eventLog.length === 0) {
    timelineEl.innerHTML = '<div class="dc-timeline-empty">Events will appear here after typing</div>';
  } else {
    timelineEl.innerHTML = "";
    for (let i = eventLog.length - 1; i >= 0; i--) {
      const entry = eventLog[i];
      const el = document.createElement("div");
      el.className = `dc-timeline-entry ${entry.event}`;

      const time = new Date(entry.timestamp);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      el.innerHTML = `
        <span class="dc-timeline-time">${timeStr}</span>
        <span class="dc-timeline-event">${escapeHtml(entry.event)}</span>
        <span class="dc-timeline-detail">${escapeHtml(entry.detail)}</span>
      `;

      timelineEl.appendChild(el);
    }
  }
}

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
searchInput.addEventListener("input", () => {
  system.events.setQuery({ value: searchInput.value });
});

// Clear
clearBtn.addEventListener("click", () => {
  system.events.clearSearch();
  searchInput.value = "";
});

// Sliders
debounceDelaySlider.addEventListener("input", () => {
  system.events.setDebounceDelay({ value: Number(debounceDelaySlider.value) });
});

apiDelaySlider.addEventListener("input", () => {
  system.events.setApiDelay({ value: Number(apiDelaySlider.value) });
});

minCharsSlider.addEventListener("input", () => {
  system.events.setMinChars({ value: Number(minCharsSlider.value) });
});

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

// ============================================================================
// Initial Render
// ============================================================================

render();

// Signal to tests that the module script has fully initialized
document.body.setAttribute("data-debounce-constraints-ready", "true");
