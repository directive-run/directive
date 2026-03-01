/**
 * Resilient API Dashboard — Error Boundaries, Retry, Circuit Breaker, Performance
 *
 * 3 simulated API services with configurable failure rates. Users inject errors
 * and watch recovery strategies, circuit breaker state transitions, retry-later
 * backoff, and performance metrics.
 */

import {
  createModule,
  createSystem,
  t,
  type ModuleSchema,
  type RecoveryStrategy,
} from "@directive-run/core";
import {performancePlugin, devtoolsPlugin } from "@directive-run/core/plugins";
import { createCircuitBreaker, type CircuitState } from "@directive-run/core/plugins";

// ============================================================================
// Types
// ============================================================================

interface ServiceState {
  name: string;
  status: "idle" | "loading" | "success" | "error";
  lastResult: string;
  errorCount: number;
  successCount: number;
  lastError: string;
}

interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: "info" | "error" | "retry" | "circuit" | "recovery" | "success";
}

// ============================================================================
// Circuit Breakers (one per service)
// ============================================================================

const timeline: TimelineEntry[] = [];

function addTimeline(event: string, detail: string, type: TimelineEntry["type"]) {
  timeline.unshift({ time: Date.now(), event, detail, type });
  if (timeline.length > 50) {
    timeline.length = 50;
  }
}

const circuitBreakers = {
  users: createCircuitBreaker({
    name: "users-api",
    failureThreshold: 3,
    recoveryTimeMs: 5000,
    halfOpenMaxRequests: 2,
    onStateChange: (from, to) => {
      addTimeline("circuit", `users: ${from} → ${to}`, "circuit");
    },
  }),
  orders: createCircuitBreaker({
    name: "orders-api",
    failureThreshold: 3,
    recoveryTimeMs: 5000,
    halfOpenMaxRequests: 2,
    onStateChange: (from, to) => {
      addTimeline("circuit", `orders: ${from} → ${to}`, "circuit");
    },
  }),
  analytics: createCircuitBreaker({
    name: "analytics-api",
    failureThreshold: 3,
    recoveryTimeMs: 5000,
    halfOpenMaxRequests: 2,
    onStateChange: (from, to) => {
      addTimeline("circuit", `analytics: ${from} → ${to}`, "circuit");
    },
  }),
};

// ============================================================================
// Schema
// ============================================================================

const schema = {
  facts: {
    usersService: t.object<ServiceState>(),
    ordersService: t.object<ServiceState>(),
    analyticsService: t.object<ServiceState>(),
    strategy: t.string<RecoveryStrategy>(),
    usersFailRate: t.number(),
    ordersFailRate: t.number(),
    analyticsFailRate: t.number(),
    retryQueueCount: t.number(),
    totalErrors: t.number(),
    totalRecoveries: t.number(),
  },
  derivations: {
    usersCircuitState: t.string<CircuitState>(),
    ordersCircuitState: t.string<CircuitState>(),
    analyticsCircuitState: t.string<CircuitState>(),
    errorRate: t.number(),
    allServicesHealthy: t.boolean(),
  },
  events: {
    fetchUsers: {},
    fetchOrders: {},
    fetchAnalytics: {},
    fetchAll: {},
    setStrategy: { value: t.string<RecoveryStrategy>() },
    setUsersFailRate: { value: t.number() },
    setOrdersFailRate: { value: t.number() },
    setAnalyticsFailRate: { value: t.number() },
    resetAll: {},
  },
  requirements: {
    FETCH_SERVICE: { service: t.string(), failRate: t.number() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

const dashboardModule = createModule("dashboard", {
  schema,

  init: (facts) => {
    const defaultService: ServiceState = {
      name: "",
      status: "idle",
      lastResult: "",
      errorCount: 0,
      successCount: 0,
      lastError: "",
    };
    facts.usersService = { ...defaultService, name: "Users API" };
    facts.ordersService = { ...defaultService, name: "Orders API" };
    facts.analyticsService = { ...defaultService, name: "Analytics API" };
    facts.strategy = "retry-later";
    facts.usersFailRate = 0;
    facts.ordersFailRate = 0;
    facts.analyticsFailRate = 0;
    facts.retryQueueCount = 0;
    facts.totalErrors = 0;
    facts.totalRecoveries = 0;
  },

  derive: {
    usersCircuitState: () => circuitBreakers.users.getState(),
    ordersCircuitState: () => circuitBreakers.orders.getState(),
    analyticsCircuitState: () => circuitBreakers.analytics.getState(),
    errorRate: (facts) => {
      const total =
        facts.usersService.errorCount +
        facts.usersService.successCount +
        facts.ordersService.errorCount +
        facts.ordersService.successCount +
        facts.analyticsService.errorCount +
        facts.analyticsService.successCount;

      if (total === 0) {
        return 0;
      }

      const errors =
        facts.usersService.errorCount +
        facts.ordersService.errorCount +
        facts.analyticsService.errorCount;

      return Math.round((errors / total) * 100);
    },
    allServicesHealthy: (facts) =>
      facts.usersService.status !== "error" &&
      facts.ordersService.status !== "error" &&
      facts.analyticsService.status !== "error",
  },

  events: {
    fetchUsers: (facts) => {
      facts.usersService = { ...facts.usersService, status: "loading" };
    },
    fetchOrders: (facts) => {
      facts.ordersService = { ...facts.ordersService, status: "loading" };
    },
    fetchAnalytics: (facts) => {
      facts.analyticsService = { ...facts.analyticsService, status: "loading" };
    },
    fetchAll: (facts) => {
      facts.usersService = { ...facts.usersService, status: "loading" };
      facts.ordersService = { ...facts.ordersService, status: "loading" };
      facts.analyticsService = { ...facts.analyticsService, status: "loading" };
    },
    setStrategy: (facts, { value }) => {
      facts.strategy = value;
    },
    setUsersFailRate: (facts, { value }) => {
      facts.usersFailRate = value;
    },
    setOrdersFailRate: (facts, { value }) => {
      facts.ordersFailRate = value;
    },
    setAnalyticsFailRate: (facts, { value }) => {
      facts.analyticsFailRate = value;
    },
    resetAll: (facts) => {
      const defaultService: ServiceState = {
        name: "",
        status: "idle",
        lastResult: "",
        errorCount: 0,
        successCount: 0,
        lastError: "",
      };
      facts.usersService = { ...defaultService, name: "Users API" };
      facts.ordersService = { ...defaultService, name: "Orders API" };
      facts.analyticsService = { ...defaultService, name: "Analytics API" };
      facts.retryQueueCount = 0;
      facts.totalErrors = 0;
      facts.totalRecoveries = 0;
      circuitBreakers.users.reset();
      circuitBreakers.orders.reset();
      circuitBreakers.analytics.reset();
      timeline.length = 0;
    },
  },

  constraints: {
    usersNeedsLoad: {
      priority: 50,
      when: (facts) => facts.usersService.status === "loading",
      require: (facts) => ({
        type: "FETCH_SERVICE",
        service: "users",
        failRate: facts.usersFailRate,
      }),
    },
    ordersNeedsLoad: {
      priority: 50,
      when: (facts) => facts.ordersService.status === "loading",
      require: (facts) => ({
        type: "FETCH_SERVICE",
        service: "orders",
        failRate: facts.ordersFailRate,
      }),
    },
    analyticsNeedsLoad: {
      priority: 50,
      when: (facts) => facts.analyticsService.status === "loading",
      require: (facts) => ({
        type: "FETCH_SERVICE",
        service: "analytics",
        failRate: facts.analyticsFailRate,
      }),
    },
  },

  resolvers: {
    fetchService: {
      requirement: "FETCH_SERVICE",
      retry: { attempts: 2, backoff: "exponential", initialDelay: 200 },
      resolve: async (req, context) => {
        const { service, failRate } = req;
        const breaker = circuitBreakers[service as keyof typeof circuitBreakers];
        const serviceKey = `${service}Service` as "usersService" | "ordersService" | "analyticsService";

        try {
          await breaker.execute(async () => {
            // Simulate API call
            await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300));

            if (Math.random() * 100 < failRate) {
              throw new Error(`${service} API: simulated failure`);
            }
          });

          // Success
          const current = context.facts[serviceKey] as ServiceState;
          context.facts[serviceKey] = {
            ...current,
            status: "success",
            lastResult: `Loaded at ${new Date().toLocaleTimeString()}`,
            successCount: current.successCount + 1,
          };
          addTimeline("success", `${service} fetched`, "success");
        } catch (error) {
          const current = context.facts[serviceKey] as ServiceState;
          const msg = error instanceof Error ? error.message : String(error);
          context.facts[serviceKey] = {
            ...current,
            status: "error",
            lastError: msg,
            errorCount: current.errorCount + 1,
          };
          context.facts.totalErrors = context.facts.totalErrors + 1;
          addTimeline("error", `${service}: ${msg.slice(0, 60)}`, "error");

          // Re-throw so the error boundary handles recovery
          throw error;
        }
      },
    },
  },
});

// ============================================================================
// Performance Plugin
// ============================================================================

const perf = performancePlugin({
  onSlowResolver: (id, ms) => {
    addTimeline("perf", `slow resolver: ${id} (${Math.round(ms)}ms)`, "info");
  },
});

// ============================================================================
// System
// ============================================================================

let currentStrategy: RecoveryStrategy = "retry-later";

const system = createSystem({
  module: dashboardModule,
  plugins: [perf, devtoolsPlugin({ name: "error-boundaries" })],
  errorBoundary: {
    onResolverError: (_error, resolver) => {
      addTimeline("recovery", `${resolver}: strategy=${currentStrategy}`, "recovery");

      return currentStrategy;
    },
    onConstraintError: "skip",
    onEffectError: "skip",
    retryLater: {
      delayMs: 1000,
      maxRetries: 3,
      backoffMultiplier: 2,
    },
    onError: (error) => {
      addTimeline("error", `boundary: ${error.message.slice(0, 60)}`, "error");
    },
  },
});
system.start();

// Track strategy changes to update error boundary (via re-dispatch)
system.subscribe(["strategy"], () => {
  const newStrategy = system.facts.strategy as RecoveryStrategy;
  if (newStrategy !== currentStrategy) {
    currentStrategy = newStrategy;
    addTimeline("recovery", `strategy → ${newStrategy}`, "recovery");
  }
});

// ============================================================================
// DOM References
// ============================================================================

// Service cards
const usersStatusEl = document.getElementById("eb-users-status")!;
const usersResultEl = document.getElementById("eb-users-result")!;
const usersErrorEl = document.getElementById("eb-users-error")!;
const ordersStatusEl = document.getElementById("eb-orders-status")!;
const ordersResultEl = document.getElementById("eb-orders-result")!;
const ordersErrorEl = document.getElementById("eb-orders-error")!;
const analyticsStatusEl = document.getElementById("eb-analytics-status")!;
const analyticsResultEl = document.getElementById("eb-analytics-result")!;
const analyticsErrorEl = document.getElementById("eb-analytics-error")!;

// Sliders
const usersFailSlider = document.getElementById("eb-users-failrate") as HTMLInputElement;
const usersFailVal = document.getElementById("eb-users-fail-val")!;
const ordersFailSlider = document.getElementById("eb-orders-failrate") as HTMLInputElement;
const ordersFailVal = document.getElementById("eb-orders-fail-val")!;
const analyticsFailSlider = document.getElementById("eb-analytics-failrate") as HTMLInputElement;
const analyticsFailVal = document.getElementById("eb-analytics-fail-val")!;

// Strategy dropdown
const strategySelect = document.getElementById("eb-strategy") as HTMLSelectElement;

// Timeline
const timelineEl = document.getElementById("eb-timeline")!;

// ============================================================================
// Render
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

function renderServiceCard(
  statusEl: HTMLElement,
  resultEl: HTMLElement,
  errorEl: HTMLElement,
  service: ServiceState,
): void {
  statusEl.textContent = service.status;
  statusEl.className = `eb-service-status ${service.status}`;
  resultEl.textContent = service.lastResult || "\u2014";
  if (service.lastError) {
    errorEl.textContent = service.lastError.slice(0, 50);
    errorEl.style.display = "block";
  } else {
    errorEl.style.display = "none";
  }
}

function render(): void {
  const facts = system.facts;

  // Service cards
  renderServiceCard(usersStatusEl, usersResultEl, usersErrorEl, facts.usersService as ServiceState);
  renderServiceCard(ordersStatusEl, ordersResultEl, ordersErrorEl, facts.ordersService as ServiceState);
  renderServiceCard(analyticsStatusEl, analyticsResultEl, analyticsErrorEl, facts.analyticsService as ServiceState);

  // Slider labels
  usersFailVal.textContent = `${facts.usersFailRate}%`;
  ordersFailVal.textContent = `${facts.ordersFailRate}%`;
  analyticsFailVal.textContent = `${facts.analyticsFailRate}%`;

  // Timeline
  if (timeline.length === 0) {
    timelineEl.innerHTML = '<div class="eb-timeline-empty">Events appear after interactions</div>';
  } else {
    timelineEl.innerHTML = "";
    for (const entry of timeline) {
      const el = document.createElement("div");
      el.className = `eb-timeline-entry ${entry.type}`;

      const time = new Date(entry.time);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      el.innerHTML = `
        <span class="eb-timeline-time">${timeStr}</span>
        <span class="eb-timeline-event">${escapeHtml(entry.event)}</span>
        <span class="eb-timeline-detail">${escapeHtml(entry.detail)}</span>
      `;

      timelineEl.appendChild(el);
    }
  }
}

// ============================================================================
// Subscribe
// ============================================================================

const allKeys = [
  ...Object.keys(schema.facts),
  ...Object.keys(schema.derivations),
];
system.subscribe(allKeys, render);

// Periodic refresh for circuit breaker state transitions + retry queue
setInterval(() => {
  render();
}, 1000);

// ============================================================================
// Controls
// ============================================================================

// Fetch buttons
document.getElementById("eb-fetch-users")!.addEventListener("click", () => {
  system.events.fetchUsers();
});
document.getElementById("eb-fetch-orders")!.addEventListener("click", () => {
  system.events.fetchOrders();
});
document.getElementById("eb-fetch-analytics")!.addEventListener("click", () => {
  system.events.fetchAnalytics();
});
document.getElementById("eb-fetch-all")!.addEventListener("click", () => {
  system.events.fetchAll();
});
document.getElementById("eb-reset")!.addEventListener("click", () => {
  perf.reset();
  system.events.resetAll();
});

// Strategy selector
strategySelect.addEventListener("change", () => {
  system.events.setStrategy({ value: strategySelect.value as RecoveryStrategy });
});

// Sliders
usersFailSlider.addEventListener("input", () => {
  system.events.setUsersFailRate({ value: Number(usersFailSlider.value) });
});
ordersFailSlider.addEventListener("input", () => {
  system.events.setOrdersFailRate({ value: Number(ordersFailSlider.value) });
});
analyticsFailSlider.addEventListener("input", () => {
  system.events.setAnalyticsFailRate({ value: Number(analyticsFailSlider.value) });
});

// ============================================================================
// Initial Render
// ============================================================================

render();
document.body.setAttribute("data-error-boundaries-ready", "true");
