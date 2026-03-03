/**
 * Dynamic Modules — Directive Module Definitions
 *
 * Dashboard module (always loaded) + 3 dynamic modules (Counter, Weather, Dice).
 * Demonstrates runtime module registration, namespaced fact access,
 * constraints, resolvers, and derivations across independent modules.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import { mockFetchWeather } from "./mock-weather.js";

// ============================================================================
// Types
// ============================================================================

export interface EventLogEntry {
  timestamp: number;
  event: string;
  detail: string;
}

// ============================================================================
// Helpers
// ============================================================================

function addLogEntry(facts: any, event: string, detail: string): void {
  const log = [...(facts.eventLog as EventLogEntry[])];
  log.push({ timestamp: Date.now(), event, detail });
  if (log.length > 50) {
    log.splice(0, log.length - 50);
  }
  facts.eventLog = log;
}

// ============================================================================
// Dashboard Module (core, always loaded)
// ============================================================================

export const dashboardSchema = {
  facts: {
    loadedModules: t.object<string[]>(),
    eventLog: t.object<EventLogEntry[]>(),
  },
  derivations: {
    loadedCount: t.number(),
  },
  events: {
    moduleLoaded: { name: t.string() },
  },
  requirements: {},
} satisfies ModuleSchema;

export const dashboardModule = createModule("dashboard", {
  schema: dashboardSchema,

  init: (facts) => {
    facts.loadedModules = [];
    facts.eventLog = [];
  },

  derive: {
    loadedCount: (facts) => (facts.loadedModules as string[]).length,
  },

  events: {
    moduleLoaded: (facts, { name }) => {
      facts.loadedModules = [...(facts.loadedModules as string[]), name];
      addLogEntry(facts, "loaded", `Loaded "${name}" module`);
    },
  },
});

// ============================================================================
// Counter Module (dynamic)
// ============================================================================

export const counterSchema = {
  facts: {
    count: t.number(),
    step: t.number(),
  },
  derivations: {
    isNearMax: t.boolean(),
  },
  events: {
    increment: {},
    decrement: {},
    setStep: { value: t.number() },
  },
  requirements: {
    COUNTER_RESET: {},
  },
} satisfies ModuleSchema;

export const counterModule = createModule("counter", {
  schema: counterSchema,

  init: (facts) => {
    facts.count = 0;
    facts.step = 1;
  },

  derive: {
    isNearMax: (facts) => (facts.count as number) >= 90,
  },

  events: {
    increment: (facts) => {
      facts.count = (facts.count as number) + (facts.step as number);
    },
    decrement: (facts) => {
      facts.count = Math.max(
        0,
        (facts.count as number) - (facts.step as number),
      );
    },
    setStep: (facts, { value }) => {
      facts.step = value;
    },
  },

  constraints: {
    overflow: {
      priority: 100,
      when: (facts) => (facts.count as number) >= 100,
      require: () => ({ type: "COUNTER_RESET" }),
    },
  },

  resolvers: {
    counterReset: {
      requirement: "COUNTER_RESET",
      resolve: async (_req, context) => {
        context.facts.count = 0;
      },
    },
  },
});

// ============================================================================
// Weather Module (dynamic)
// ============================================================================

export const weatherSchema = {
  facts: {
    city: t.string(),
    temperature: t.number(),
    condition: t.string(),
    humidity: t.number(),
    isLoading: t.boolean(),
    lastFetchedCity: t.string(),
  },
  derivations: {
    summary: t.string(),
    hasFetched: t.boolean(),
  },
  events: {
    setCity: { value: t.string() },
    refresh: {},
  },
  requirements: {
    FETCH_WEATHER: {
      city: t.string(),
    },
  },
} satisfies ModuleSchema;

export const weatherModule = createModule("weather", {
  schema: weatherSchema,

  init: (facts) => {
    facts.city = "";
    facts.temperature = 0;
    facts.condition = "";
    facts.humidity = 0;
    facts.isLoading = false;
    facts.lastFetchedCity = "";
  },

  derive: {
    summary: (facts) => {
      if ((facts.city as string) === "") {
        return "";
      }

      return `${facts.temperature}\u00B0F, ${facts.condition}`;
    },
    hasFetched: (facts) => (facts.lastFetchedCity as string) !== "",
  },

  events: {
    setCity: (facts, { value }) => {
      facts.city = value;
    },
    refresh: (facts) => {
      facts.lastFetchedCity = "";
    },
  },

  constraints: {
    needsFetch: {
      priority: 100,
      when: (facts) =>
        (facts.city as string).length >= 2 &&
        facts.city !== facts.lastFetchedCity &&
        !(facts.isLoading as boolean),
      require: (facts) => ({
        type: "FETCH_WEATHER",
        city: facts.city as string,
      }),
    },
  },

  resolvers: {
    fetchWeather: {
      requirement: "FETCH_WEATHER",
      key: (req) => `weather-${req.city}`,
      timeout: 10000,
      resolve: async (req, context) => {
        context.facts.isLoading = true;

        const data = await mockFetchWeather(req.city, 800);

        // Stale check: only apply if city still matches
        if ((context.facts.city as string) === req.city) {
          context.facts.temperature = data.temperature;
          context.facts.condition = data.condition;
          context.facts.humidity = data.humidity;
          context.facts.lastFetchedCity = req.city;
        }

        context.facts.isLoading = false;
      },
    },
  },
});

// ============================================================================
// Dice Module (dynamic)
// ============================================================================

export const diceSchema = {
  facts: {
    die1: t.number(),
    die2: t.number(),
    rollCount: t.number(),
  },
  derivations: {
    total: t.number(),
    isDoubles: t.boolean(),
  },
  events: {
    roll: {},
  },
  requirements: {},
} satisfies ModuleSchema;

export const diceModule = createModule("dice", {
  schema: diceSchema,

  init: (facts) => {
    facts.die1 = 1;
    facts.die2 = 1;
    facts.rollCount = 0;
  },

  derive: {
    total: (facts) => (facts.die1 as number) + (facts.die2 as number),
    isDoubles: (facts) => facts.die1 === facts.die2,
  },

  events: {
    roll: (facts) => {
      facts.die1 = Math.floor(Math.random() * 6) + 1;
      facts.die2 = Math.floor(Math.random() * 6) + 1;
      facts.rollCount = (facts.rollCount as number) + 1;
    },
  },
});

// ============================================================================
// Module Registry
// ============================================================================

export const moduleRegistry: Record<string, { module: any; label: string }> = {
  counter: { module: counterModule, label: "Counter" },
  weather: { module: weatherModule, label: "Weather" },
  dice: { module: diceModule, label: "Dice" },
};
