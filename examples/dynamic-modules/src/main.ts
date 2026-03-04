/**
 * Dynamic Modules — DOM Rendering & System Wiring
 *
 * Creates the Directive system with only the dashboard module,
 * then dynamically registers counter/weather/dice modules on demand.
 * Uses subscribeModule for per-namespace reactivity.
 */

import { createSystem } from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import {
  type EventLogEntry,
  dashboardModule,
  moduleRegistry,
} from "./modules.js";

// ============================================================================
// System
// ============================================================================

let system = createSystem({
  modules: { dashboard: dashboardModule },
  debug: { runHistory: true },
  plugins: [devtoolsPlugin({ name: "dynamic-modules" })],
});
system.start();

// ============================================================================
// Subscription Management
// ============================================================================

const unsubs: (() => void)[] = [];

function setupSubscriptions(): void {
  for (const u of unsubs) {
    u();
  }
  unsubs.length = 0;

  unsubs.push(system.subscribeModule("dashboard", render));

  const loaded = system.facts.dashboard.loadedModules as string[];
  for (const ns of loaded) {
    unsubs.push(system.subscribeModule(ns, render));
  }
}

// ============================================================================
// DOM References
// ============================================================================

const statusBadge = document.getElementById("dm-status-badge")!;
const statusText = document.getElementById("dm-status-text")!;
const widgetsArea = document.getElementById("dm-widgets-area")!;
const timelineEl = document.getElementById("dm-timeline")!;

const loadCounterBtn = document.getElementById(
  "dm-load-counter",
) as HTMLButtonElement;
const loadWeatherBtn = document.getElementById(
  "dm-load-weather",
) as HTMLButtonElement;
const loadDiceBtn = document.getElementById(
  "dm-load-dice",
) as HTMLButtonElement;
const resetBtn = document.getElementById("dm-reset-btn") as HTMLButtonElement;

// ============================================================================
// Dice Faces
// ============================================================================

const DICE_FACES = ["\u2680", "\u2681", "\u2682", "\u2683", "\u2684", "\u2685"];

// ============================================================================
// Render
// ============================================================================

function render(): void {
  const dashFacts = system.facts.dashboard;
  const loaded = dashFacts.loadedModules as string[];
  const loadedCount = system.derive.dashboard.loadedCount as number;
  const eventLog = dashFacts.eventLog as EventLogEntry[];

  // --- Status badge ---
  statusText.textContent = `${loadedCount} / 3 loaded`;
  if (loadedCount > 0) {
    statusBadge.className = "dm-status-badge active";
  } else {
    statusBadge.className = "dm-status-badge";
  }

  // --- Widgets area ---
  if (loaded.length === 0) {
    widgetsArea.innerHTML =
      '<div class="dm-widgets-empty">Load a module to get started</div>';
  } else {
    widgetsArea.innerHTML = "";
    for (const ns of loaded) {
      if (ns === "counter") {
        renderCounterWidget();
      } else if (ns === "weather") {
        renderWeatherWidget();
      } else if (ns === "dice") {
        renderDiceWidget();
      }
    }
  }

  // --- Timeline ---
  renderTimeline(eventLog);
}

function renderCounterWidget(): void {
  const facts = (system.facts as any).counter;
  const derive = (system.derive as any).counter;
  const count = facts.count as number;
  const step = facts.step as number;
  const isNearMax = derive.isNearMax as boolean;

  const card = document.createElement("div");
  card.className = "dm-widget-card counter";
  card.setAttribute("data-testid", "dm-widget-counter");

  card.innerHTML = `
    <div class="dm-widget-header">Counter</div>
    <div class="dm-widget-body">
      <div class="dm-counter-display" data-testid="dm-counter-value">${count}</div>
      ${isNearMax ? '<div class="dm-counter-near-max">Near max (100)</div>' : ""}
      <div class="dm-counter-controls">
        <button class="dm-btn dm-btn-sm" data-testid="dm-counter-decrement">&minus;</button>
        <button class="dm-btn dm-btn-sm" data-testid="dm-counter-increment">+</button>
      </div>
      <div class="dm-step-row">
        <span>Step</span>
        <input type="range" min="1" max="10" value="${step}" data-testid="dm-counter-step" />
        <span class="dm-step-val">${step}</span>
      </div>
    </div>
  `;

  widgetsArea.appendChild(card);

  // Wire up controls after appending
  card
    .querySelector('[data-testid="dm-counter-increment"]')!
    .addEventListener("click", () => {
      system.events.counter.increment();
    });
  card
    .querySelector('[data-testid="dm-counter-decrement"]')!
    .addEventListener("click", () => {
      system.events.counter.decrement();
    });
  card
    .querySelector('[data-testid="dm-counter-step"]')!
    .addEventListener("input", (e) => {
      const value = Number((e.target as HTMLInputElement).value);
      system.events.counter.setStep({ value });
    });
}

function renderWeatherWidget(): void {
  const facts = (system.facts as any).weather;
  const derive = (system.derive as any).weather;
  const city = facts.city as string;
  const isLoading = facts.isLoading as boolean;
  const hasFetched = derive.hasFetched as boolean;
  const summary = derive.summary as string;
  const humidity = facts.humidity as number;

  const card = document.createElement("div");
  card.className = "dm-widget-card weather";
  card.setAttribute("data-testid", "dm-widget-weather");

  let weatherBody: string;
  if (isLoading) {
    weatherBody = '<div class="dm-weather-loading">Fetching weather...</div>';
  } else if (!hasFetched) {
    weatherBody = '<div class="dm-weather-empty">Enter a city</div>';
  } else {
    weatherBody = `
      <div class="dm-weather-data">
        <div class="dm-weather-temp" data-testid="dm-weather-summary">${escapeHtml(summary)}</div>
        <div class="dm-weather-humidity">Humidity: ${humidity}%</div>
      </div>
    `;
  }

  // Preserve city input value during re-render
  const existingInput = document.querySelector(
    '[data-testid="dm-weather-city"]',
  ) as HTMLInputElement | null;
  const currentCityValue = existingInput ? existingInput.value : city;

  card.innerHTML = `
    <div class="dm-widget-header">Weather</div>
    <div class="dm-widget-body">
      <div class="dm-weather-input-row">
        <input
          class="dm-input"
          type="text"
          placeholder="Enter city..."
          value="${escapeHtml(currentCityValue)}"
          autocomplete="off"
          data-testid="dm-weather-city"
        />
        <button class="dm-btn dm-btn-sm dm-btn-secondary" data-testid="dm-weather-refresh" ${!hasFetched ? "disabled" : ""}>Refresh</button>
      </div>
      ${weatherBody}
    </div>
  `;

  widgetsArea.appendChild(card);

  // Wire up controls
  const cityInput = card.querySelector(
    '[data-testid="dm-weather-city"]',
  ) as HTMLInputElement;
  cityInput.addEventListener("input", () => {
    system.events.weather.setCity({ value: cityInput.value });
  });
  card
    .querySelector('[data-testid="dm-weather-refresh"]')!
    .addEventListener("click", () => {
      system.events.weather.refresh();
    });

  // Focus management: re-focus if user was typing
  if (existingInput && document.activeElement === existingInput) {
    cityInput.focus();
    cityInput.selectionStart = cityInput.value.length;
    cityInput.selectionEnd = cityInput.value.length;
  }
}

function renderDiceWidget(): void {
  const facts = (system.facts as any).dice;
  const derive = (system.derive as any).dice;
  const die1 = facts.die1 as number;
  const die2 = facts.die2 as number;
  const total = derive.total as number;
  const isDoubles = derive.isDoubles as boolean;
  const rollCount = facts.rollCount as number;

  const card = document.createElement("div");
  card.className = "dm-widget-card dice";
  card.setAttribute("data-testid", "dm-widget-dice");

  card.innerHTML = `
    <div class="dm-widget-header">Dice</div>
    <div class="dm-widget-body">
      <div class="dm-dice-faces">
        <span data-testid="dm-dice-die1">${DICE_FACES[die1 - 1]}</span>
        <span data-testid="dm-dice-die2">${DICE_FACES[die2 - 1]}</span>
      </div>
      <div class="dm-dice-info">
        <span data-testid="dm-dice-total">Total: ${total}</span>
        ${isDoubles ? '<span class="dm-doubles-badge" data-testid="dm-dice-doubles">Doubles!</span>' : ""}
      </div>
      <div class="dm-dice-roll-count">Rolls: ${rollCount}</div>
      <button class="dm-btn dm-btn-sm" data-testid="dm-dice-roll">Roll</button>
    </div>
  `;

  widgetsArea.appendChild(card);

  card
    .querySelector('[data-testid="dm-dice-roll"]')!
    .addEventListener("click", () => {
      system.events.dice.roll();
    });
}

function renderTimeline(eventLog: EventLogEntry[]): void {
  if (eventLog.length === 0) {
    timelineEl.innerHTML =
      '<div class="dm-timeline-empty">Events will appear here</div>';

    return;
  }

  timelineEl.innerHTML = "";
  for (let i = eventLog.length - 1; i >= 0; i--) {
    const entry = eventLog[i];
    const el = document.createElement("div");

    // Determine timeline entry class for color coding
    let entryClass = "loaded";
    if (entry.event === "loaded") {
      entryClass = "loaded";
    } else if (
      entry.detail.includes("counter") ||
      entry.event.includes("counter")
    ) {
      entryClass = "counter";
    } else if (
      entry.detail.includes("weather") ||
      entry.event.includes("weather")
    ) {
      entryClass = "weather";
    } else if (entry.detail.includes("dice") || entry.event.includes("dice")) {
      entryClass = "dice";
    }

    el.className = `dm-timeline-entry ${entryClass}`;

    const time = new Date(entry.timestamp);
    const timeStr = time.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    el.innerHTML = `
      <span class="dm-timeline-time">${timeStr}</span>
      <span class="dm-timeline-event">${escapeHtml(entry.event)}</span>
      <span class="dm-timeline-detail">${escapeHtml(entry.detail)}</span>
    `;

    timelineEl.appendChild(el);
  }
}

// ============================================================================
// Module Loading
// ============================================================================

function loadModule(name: string): void {
  const entry = moduleRegistry[name];
  if (!entry) {
    return;
  }

  const loaded = system.facts.dashboard.loadedModules as string[];
  if (loaded.includes(name)) {
    return;
  }

  system.registerModule(name, entry.module);
  system.events.dashboard.moduleLoaded({ name });

  setupSubscriptions();
  renderModuleManager();
  render();
}

function renderModuleManager(): void {
  const loaded = system.facts.dashboard.loadedModules as string[];

  loadCounterBtn.disabled = loaded.includes("counter");
  loadCounterBtn.textContent = loaded.includes("counter") ? "Loaded" : "Load";

  loadWeatherBtn.disabled = loaded.includes("weather");
  loadWeatherBtn.textContent = loaded.includes("weather") ? "Loaded" : "Load";

  loadDiceBtn.disabled = loaded.includes("dice");
  loadDiceBtn.textContent = loaded.includes("dice") ? "Loaded" : "Load";
}

// ============================================================================
// Reset
// ============================================================================

function resetDemo(): void {
  for (const u of unsubs) {
    u();
  }
  unsubs.length = 0;

  system = createSystem({
    modules: { dashboard: dashboardModule },
    debug: { runHistory: true },
    plugins: [devtoolsPlugin({ name: "dynamic-modules" })],
  });
  system.start();

  setupSubscriptions();
  renderModuleManager();
  render();
}

// ============================================================================
// Controls
// ============================================================================

loadCounterBtn.addEventListener("click", () => loadModule("counter"));
loadWeatherBtn.addEventListener("click", () => loadModule("weather"));
loadDiceBtn.addEventListener("click", () => loadModule("dice"));
resetBtn.addEventListener("click", () => resetDemo());

// ============================================================================
// Subscribe
// ============================================================================

setupSubscriptions();

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

document.body.setAttribute("data-dynamic-modules-ready", "true");
