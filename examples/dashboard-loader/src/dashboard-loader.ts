/**
 * Dashboard Loader — Directive Module
 *
 * Demonstrates loading & error states with concurrent resource fetching,
 * configurable delays/failure rates, retry with exponential backoff,
 * and combined status derivations.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import {
  type Permissions,
  type Preferences,
  type Profile,
  fetchMockPermissions,
  fetchMockPreferences,
  fetchMockProfile,
} from "./mock-api.js";

// ============================================================================
// Types
// ============================================================================

export type ResourceStatus = "idle" | "loading" | "success" | "error";

export interface ResourceState<T> {
  data: T | null;
  status: ResourceStatus;
  error: string | null;
  attempts: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface EventLogEntry {
  timestamp: number;
  event: string;
  resource: string;
  detail: string;
}

function makeIdleResource<T>(): ResourceState<T> {
  return {
    data: null,
    status: "idle",
    error: null,
    attempts: 0,
    startedAt: null,
    completedAt: null,
  };
}

// ============================================================================
// Schema
// ============================================================================

export const dashboardLoaderSchema = {
  facts: {
    userId: t.string(),
    profile: t.object<ResourceState<Profile>>(),
    preferences: t.object<ResourceState<Preferences>>(),
    permissions: t.object<ResourceState<Permissions>>(),
    profileDelay: t.number(),
    preferencesDelay: t.number(),
    permissionsDelay: t.number(),
    profileFailRate: t.number(),
    preferencesFailRate: t.number(),
    permissionsFailRate: t.number(),
    loadRequested: t.boolean(),
    eventLog: t.array<EventLogEntry>(),
  },
  derivations: {
    loadedCount: t.number(),
    totalResources: t.number(),
    allLoaded: t.boolean(),
    anyError: t.boolean(),
    anyLoading: t.boolean(),
    combinedStatus: t.string(),
    canStart: t.boolean(),
  },
  events: {
    setUserId: { value: t.string() },
    start: {},
    retryResource: { resource: t.string() },
    reloadAll: {},
    setDelay: { resource: t.string(), value: t.number() },
    setFailRate: { resource: t.string(), value: t.number() },
  },
  requirements: {
    FETCH_PROFILE: { userId: t.string() },
    FETCH_PREFERENCES: { userId: t.string() },
    FETCH_PERMISSIONS: { userId: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Helpers
// ============================================================================

function addLogEntry(
  facts: any,
  event: string,
  resource: string,
  detail: string,
): void {
  const log = [...facts.eventLog];
  log.push({ timestamp: Date.now(), event, resource, detail });
  facts.eventLog = log;
}

// ============================================================================
// Module
// ============================================================================

export const dashboardLoaderModule = createModule("dashboard-loader", {
  schema: dashboardLoaderSchema,

  init: (facts) => {
    facts.userId = "";
    facts.profile = makeIdleResource<Profile>();
    facts.preferences = makeIdleResource<Preferences>();
    facts.permissions = makeIdleResource<Permissions>();
    facts.profileDelay = 1000;
    facts.preferencesDelay = 1500;
    facts.permissionsDelay = 2000;
    facts.profileFailRate = 0;
    facts.preferencesFailRate = 0;
    facts.permissionsFailRate = 0;
    facts.loadRequested = false;
    facts.eventLog = [];
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    loadedCount: (facts) => {
      const resources = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ] as ResourceState<unknown>[];

      return resources.filter((r) => r.status === "success").length;
    },

    totalResources: () => 3,

    allLoaded: (facts) => {
      const resources = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ] as ResourceState<unknown>[];

      return resources.every((r) => r.status === "success");
    },

    anyError: (facts) => {
      const resources = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ] as ResourceState<unknown>[];

      return resources.some((r) => r.status === "error");
    },

    anyLoading: (facts) => {
      const resources = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ] as ResourceState<unknown>[];

      return resources.some((r) => r.status === "loading");
    },

    combinedStatus: (facts, derive) => {
      const loaded = derive.loadedCount;
      const anyErr = derive.anyError;
      const anyLoad = derive.anyLoading;
      const allIdle = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ].every((r: any) => r.status === "idle");

      if (allIdle) {
        return "Not started";
      }

      const errCount = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ].filter((r: any) => r.status === "error").length;

      if (anyLoad) {
        return `Loading ${loaded} of 3...`;
      }

      if (anyErr && loaded > 0) {
        return `${errCount} failed, ${loaded} loaded`;
      }

      if (anyErr) {
        return `${errCount} failed`;
      }

      return "All loaded";
    },

    canStart: (facts) => {
      const id = facts.userId.trim();
      const allIdle = [
        facts.profile,
        facts.preferences,
        facts.permissions,
      ].every((r: any) => r.status === "idle");

      return id.length > 0 && allIdle;
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    setUserId: (facts, { value }) => {
      facts.userId = value;
    },

    start: (facts) => {
      const id = facts.userId.trim();
      if (id.length === 0) {
        return;
      }

      // Reset all resources to idle so constraints re-fire
      facts.profile = makeIdleResource<Profile>();
      facts.preferences = makeIdleResource<Preferences>();
      facts.permissions = makeIdleResource<Permissions>();
      facts.loadRequested = true;
      facts.eventLog = [];
    },

    retryResource: (facts, { resource }) => {
      const res = (facts as any)[resource] as ResourceState<unknown>;
      if (!res || res.status !== "error") {
        return;
      }

      (facts as any)[resource] = {
        ...res,
        status: "idle",
        error: null,
      };
    },

    reloadAll: (facts) => {
      facts.profile = makeIdleResource<Profile>();
      facts.preferences = makeIdleResource<Preferences>();
      facts.permissions = makeIdleResource<Permissions>();
      facts.eventLog = [];
    },

    setDelay: (facts, { resource, value }) => {
      const key = `${resource}Delay` as keyof typeof facts;
      if (key in facts) {
        (facts as any)[key] = value;
      }
    },

    setFailRate: (facts, { resource, value }) => {
      const key = `${resource}FailRate` as keyof typeof facts;
      if (key in facts) {
        (facts as any)[key] = value;
      }
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    needsProfile: {
      priority: 100,
      when: (facts) => {
        const id = facts.userId.trim();
        const profile = facts.profile;

        return facts.loadRequested && id !== "" && profile.status === "idle";
      },
      require: (facts) => ({
        type: "FETCH_PROFILE",
        userId: facts.userId.trim(),
      }),
    },

    needsPreferences: {
      priority: 90,
      when: (facts) => {
        const id = facts.userId.trim();
        const prefs = facts.preferences;

        return facts.loadRequested && id !== "" && prefs.status === "idle";
      },
      require: (facts) => ({
        type: "FETCH_PREFERENCES",
        userId: facts.userId.trim(),
      }),
    },

    needsPermissions: {
      priority: 80,
      when: (facts) => {
        const id = facts.userId.trim();
        const perms = facts.permissions;

        return facts.loadRequested && id !== "" && perms.status === "idle";
      },
      require: (facts) => ({
        type: "FETCH_PERMISSIONS",
        userId: facts.userId.trim(),
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    fetchProfile: {
      requirement: "FETCH_PROFILE",
      retry: { attempts: 3, backoff: "exponential" },
      timeout: 10000,
      resolve: async (req, context) => {
        const prev = context.facts.profile;
        context.facts.profile = {
          ...prev,
          status: "loading",
          attempts: prev.attempts + 1,
          startedAt: prev.startedAt ?? Date.now(),
        };
        addLogEntry(
          context.facts,
          "loading",
          "profile",
          `Attempt ${prev.attempts + 1}`,
        );

        try {
          const data = await fetchMockProfile(
            req.userId,
            context.facts.profileDelay,
            context.facts.profileFailRate,
          );
          context.facts.profile = {
            data,
            status: "success",
            error: null,
            attempts: context.facts.profile.attempts,
            startedAt: context.facts.profile.startedAt,
            completedAt: Date.now(),
          };
          addLogEntry(context.facts, "success", "profile", data.name);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.profile = {
            ...context.facts.profile,
            status: "error",
            error: msg,
            completedAt: Date.now(),
          };
          addLogEntry(context.facts, "error", "profile", msg);
          throw err;
        }
      },
    },

    fetchPreferences: {
      requirement: "FETCH_PREFERENCES",
      retry: { attempts: 2, backoff: "exponential" },
      resolve: async (req, context) => {
        const prev = context.facts.preferences;
        context.facts.preferences = {
          ...prev,
          status: "loading",
          attempts: prev.attempts + 1,
          startedAt: prev.startedAt ?? Date.now(),
        };
        addLogEntry(
          context.facts,
          "loading",
          "preferences",
          `Attempt ${prev.attempts + 1}`,
        );

        try {
          const data = await fetchMockPreferences(
            req.userId,
            context.facts.preferencesDelay,
            context.facts.preferencesFailRate,
          );
          context.facts.preferences = {
            data,
            status: "success",
            error: null,
            attempts: context.facts.preferences.attempts,
            startedAt: context.facts.preferences.startedAt,
            completedAt: Date.now(),
          };
          addLogEntry(
            context.facts,
            "success",
            "preferences",
            `${data.theme} / ${data.locale}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.preferences = {
            ...context.facts.preferences,
            status: "error",
            error: msg,
            completedAt: Date.now(),
          };
          addLogEntry(context.facts, "error", "preferences", msg);
          throw err;
        }
      },
    },

    fetchPermissions: {
      requirement: "FETCH_PERMISSIONS",
      retry: { attempts: 3, backoff: "exponential" },
      timeout: 15000,
      resolve: async (req, context) => {
        const prev = context.facts.permissions;
        context.facts.permissions = {
          ...prev,
          status: "loading",
          attempts: prev.attempts + 1,
          startedAt: prev.startedAt ?? Date.now(),
        };
        addLogEntry(
          context.facts,
          "loading",
          "permissions",
          `Attempt ${prev.attempts + 1}`,
        );

        try {
          const data = await fetchMockPermissions(
            req.userId,
            context.facts.permissionsDelay,
            context.facts.permissionsFailRate,
          );
          context.facts.permissions = {
            data,
            status: "success",
            error: null,
            attempts: context.facts.permissions.attempts,
            startedAt: context.facts.permissions.startedAt,
            completedAt: Date.now(),
          };
          addLogEntry(
            context.facts,
            "success",
            "permissions",
            `${data.role} (${data.features.join(", ")})`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.permissions = {
            ...context.facts.permissions,
            status: "error",
            error: msg,
            completedAt: Date.now(),
          };
          addLogEntry(context.facts, "error", "permissions", msg);
          throw err;
        }
      },
    },
  },
});
