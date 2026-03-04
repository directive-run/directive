// Example: error-boundaries
// Source: examples/error-boundaries/src/main.ts
// Extracted for AI rules — DOM wiring stripped

/**
 * Resilient API Dashboard — Error Boundaries, Retry, Circuit Breaker, Performance
 *
 * 3 simulated API services with configurable failure rates. Users inject errors
 * and watch recovery strategies, circuit breaker state transitions, retry-later
 * backoff, and performance metrics.
 */

import {
  type ModuleSchema,
  type RecoveryStrategy,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin, performancePlugin } from "@directive-run/core/plugins";
import {
  type CircuitState,
  createCircuitBreaker,
} from "@directive-run/core/plugins";

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

function addTimeline(
  event: string,
  detail: string,
  type: TimelineEntry["type"],
) {
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
    },
  }),
  orders: createCircuitBreaker({
    name: "orders-api",
    failureThreshold: 3,
    recoveryTimeMs: 5000,
    halfOpenMaxRequests: 2,
    onStateChange: (from, to) => {
    },
  }),
  analytics: createCircuitBreaker({
    name: "analytics-api",
    failureThreshold: 3,
    recoveryTimeMs: 5000,
    halfOpenMaxRequests: 2,
    onStateChange: (from, to) => {
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
        const breaker =
          circuitBreakers[service as keyof typeof circuitBreakers];
        const serviceKey = `${service}Service` as
          | "usersService"
          | "ordersService"
          | "analyticsService";

        try {
          await breaker.execute(async () => {
            // Simulate API call
            await new Promise((resolve) =>
              setTimeout(resolve, 200 + Math.random() * 300),
            );

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
        "recovery",
        `${resolver}: strategy=${currentStrategy}`,
        "recovery",
      );

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
    },
  },
});
system.start();

// Track strategy changes to update error boundary (via re-dispatch)
system.subscribe(["strategy"], () => {
  const newStrategy = system.facts.strategy as RecoveryStrategy;
  if (newStrategy !== currentStrategy) {
    currentStrategy = newStrategy;
  }
});

// ============================================================================
// DOM References
// ============================================================================

// Service cards

// Sliders
  "eb-users-failrate",
  "eb-orders-failrate",
  "eb-analytics-failrate",

// Strategy dropdown
  "eb-strategy",

// Timeline

// ============================================================================
// Render
// ============================================================================

function escapeHtml(text: string): string {

  return div.innerHTML;
}

  service: ServiceState,
): void {
  if (service.lastError) {
  } else {
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

// Strategy selector

// Sliders

// ============================================================================
// Initial Render
// ============================================================================

render();
