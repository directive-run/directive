/**
 * Dynamic Modules — DOM Rendering & System Wiring
 *
 * Creates the Directive system with only the dashboard module,
 * then dynamically registers counter/weather/dice modules on demand.
 * Uses subscribeModule for per-namespace reactivity.
 */

import { el } from "@directive-run/el";
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
  trace: true,
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

  const loaded = system.facts.dashboard.loadedModules;
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
  const loaded = dashFacts.loadedModules;
  const loadedCount = system.derive.dashboard.loadedCount;
  const eventLog = dashFacts.eventLog;

  // --- Status badge ---
  statusText.textContent = `${loadedCount} / 3 loaded`;
  if (loadedCount > 0) {
    statusBadge.className = "dm-status-badge active";
  } else {
    statusBadge.className = "dm-status-badge";
  }

  // --- Widgets area ---
  if (loaded.length === 0) {
    widgetsArea.replaceChildren(
      el("div", { className: "dm-widgets-empty" }, "Load a module to get started"),
    );
  } else {
    widgetsArea.replaceChildren();
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
  const count = facts.count;
  const step = facts.step;
  const isNearMax = derive.isNearMax;

  const decrementBtn = el("button", { className: "dm-btn dm-btn-sm" }, "\u2212");
  decrementBtn.dataset.testid = "dm-counter-decrement";

  const incrementBtn = el("button", { className: "dm-btn dm-btn-sm" }, "+");
  incrementBtn.dataset.testid = "dm-counter-increment";

  const stepInput = el("input", {
    type: "range",
    min: "1",
    max: "10",
    value: String(step),
  }) as HTMLInputElement;
  stepInput.dataset.testid = "dm-counter-step";

  const counterDisplay = el("div", { className: "dm-counter-display" }, String(count));
  counterDisplay.dataset.testid = "dm-counter-value";

  const card = el("div", { className: "dm-widget-card counter" },
    el("div", { className: "dm-widget-header" }, "Counter"),
    el("div", { className: "dm-widget-body" },
      counterDisplay,
      isNearMax ? el("div", { className: "dm-counter-near-max" }, "Near max (100)") : null,
      el("div", { className: "dm-counter-controls" }, decrementBtn, incrementBtn),
      el("div", { className: "dm-step-row" },
        el("span", "Step"),
        stepInput,
        el("span", { className: "dm-step-val" }, String(step)),
      ),
    ),
  );
  card.dataset.testid = "dm-widget-counter";

  widgetsArea.appendChild(card);

  // Wire up controls after appending
  incrementBtn.addEventListener("click", () => {
    system.events.counter.increment();
  });
  decrementBtn.addEventListener("click", () => {
    system.events.counter.decrement();
  });
  stepInput.addEventListener("input", (e) => {
    const value = Number((e.target as HTMLInputElement).value);
    system.events.counter.setStep({ value });
  });
}

function renderWeatherWidget(): void {
  const facts = (system.facts as any).weather;
  const derive = (system.derive as any).weather;
  const city = facts.city;
  const isLoading = facts.isLoading;
  const hasFetched = derive.hasFetched;
  const summary = derive.summary;
  const humidity = facts.humidity;

  let weatherBody: HTMLElement;
  if (isLoading) {
    weatherBody = el("div", { className: "dm-weather-loading" }, "Fetching weather...");
  } else if (!hasFetched) {
    weatherBody = el("div", { className: "dm-weather-empty" }, "Enter a city");
  } else {
    const summaryEl = el("div", { className: "dm-weather-temp" }, summary);
    summaryEl.dataset.testid = "dm-weather-summary";
    weatherBody = el("div", { className: "dm-weather-data" },
      summaryEl,
      el("div", { className: "dm-weather-humidity" }, `Humidity: ${humidity}%`),
    );
  }

  // Preserve city input value during re-render
  const existingInput = document.querySelector(
    '[data-testid="dm-weather-city"]',
  ) as HTMLInputElement | null;
  const currentCityValue = existingInput ? existingInput.value : city;

  const cityInput = el("input", {
    className: "dm-input",
    type: "text",
    placeholder: "Enter city...",
    value: currentCityValue,
    autocomplete: "off",
  }) as HTMLInputElement;
  cityInput.dataset.testid = "dm-weather-city";

  const refreshBtn = el("button", {
    className: "dm-btn dm-btn-sm dm-btn-secondary",
    disabled: !hasFetched,
  }, "Refresh");
  refreshBtn.dataset.testid = "dm-weather-refresh";

  const card = el("div", { className: "dm-widget-card weather" },
    el("div", { className: "dm-widget-header" }, "Weather"),
    el("div", { className: "dm-widget-body" },
      el("div", { className: "dm-weather-input-row" }, cityInput, refreshBtn),
      weatherBody,
    ),
  );
  card.dataset.testid = "dm-widget-weather";

  widgetsArea.appendChild(card);

  // Wire up controls
  cityInput.addEventListener("input", () => {
    system.events.weather.setCity({ value: cityInput.value });
  });
  refreshBtn.addEventListener("click", () => {
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
  const die1 = facts.die1;
  const die2 = facts.die2;
  const total = derive.total;
  const isDoubles = derive.isDoubles;
  const rollCount = facts.rollCount;

  const die1Span = el("span", DICE_FACES[die1 - 1]);
  die1Span.dataset.testid = "dm-dice-die1";

  const die2Span = el("span", DICE_FACES[die2 - 1]);
  die2Span.dataset.testid = "dm-dice-die2";

  const totalSpan = el("span", `Total: ${total}`);
  totalSpan.dataset.testid = "dm-dice-total";

  const doublesEl = isDoubles
    ? (() => {
        const badge = el("span", { className: "dm-doubles-badge" }, "Doubles!");
        badge.dataset.testid = "dm-dice-doubles";

        return badge;
      })()
    : null;

  const rollBtn = el("button", { className: "dm-btn dm-btn-sm" }, "Roll");
  rollBtn.dataset.testid = "dm-dice-roll";

  const card = el("div", { className: "dm-widget-card dice" },
    el("div", { className: "dm-widget-header" }, "Dice"),
    el("div", { className: "dm-widget-body" },
      el("div", { className: "dm-dice-faces" }, die1Span, die2Span),
      el("div", { className: "dm-dice-info" }, totalSpan, doublesEl),
      el("div", { className: "dm-dice-roll-count" }, `Rolls: ${rollCount}`),
      rollBtn,
    ),
  );
  card.dataset.testid = "dm-widget-dice";

  widgetsArea.appendChild(card);

  rollBtn.addEventListener("click", () => {
    system.events.dice.roll();
  });
}

function renderTimeline(eventLog: EventLogEntry[]): void {
  if (eventLog.length === 0) {
    timelineEl.replaceChildren(
      el("div", { className: "dm-timeline-empty" }, "Events will appear here"),
    );

    return;
  }

  const entries: HTMLDivElement[] = [];
  for (let i = eventLog.length - 1; i >= 0; i--) {
    const entry = eventLog[i];

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

    const time = new Date(entry.timestamp);
    const timeStr = time.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    entries.push(
      el("div", { className: `dm-timeline-entry ${entryClass}` },
        el("span", { className: "dm-timeline-time" }, timeStr),
        el("span", { className: "dm-timeline-event" }, entry.event),
        el("span", { className: "dm-timeline-detail" }, entry.detail),
      ),
    );
  }
  timelineEl.replaceChildren(...entries);
}

// ============================================================================
// Module Loading
// ============================================================================

function loadModule(name: string): void {
  const entry = moduleRegistry[name];
  if (!entry) {
    return;
  }

  const loaded = system.facts.dashboard.loadedModules;
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
  const loaded = system.facts.dashboard.loadedModules;

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
    trace: true,
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
// Initial Render
// ============================================================================

render();

document.body.setAttribute("data-dynamic-modules-ready", "true");
