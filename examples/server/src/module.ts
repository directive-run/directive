/**
 * User Profile Module
 *
 * A SaaS user profile and feature-gating module. Demonstrates a real
 * server-side pattern: load user data when a userId is set, compute
 * an effective plan and feature access from the loaded profile.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";

// ============================================================================
// Types
// ============================================================================

export interface UserProfile {
  [key: string]: unknown;
  id: string;
  email: string;
  name: string;
  plan: "free" | "pro" | "enterprise";
  features: string[];
  createdAt: string;
}

// ============================================================================
// Schema
// ============================================================================

const schema = {
  facts: {
    userId: t.string(),
    profile: t.nullable(t.object<UserProfile>()),
    status: t.string<"idle" | "loading" | "ready" | "error">(),
    error: t.string(),
  },
  derivations: {
    effectivePlan: t.string(),
    canUseFeature: t.object<Record<string, boolean>>(),
    isReady: t.boolean(),
  },
  events: {
    loadUser: { userId: t.string() },
  },
  requirements: {
    FETCH_PROFILE: { userId: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Simulated Database
// ============================================================================

const USERS: Record<string, UserProfile> = {
  "user-1": {
    id: "user-1",
    email: "alice@example.com",
    name: "Alice",
    plan: "pro",
    features: ["analytics", "api-access", "export"],
    createdAt: "2025-01-15T00:00:00Z",
  },
  "user-2": {
    id: "user-2",
    email: "bob@example.com",
    name: "Bob",
    plan: "free",
    features: ["analytics"],
    createdAt: "2025-06-01T00:00:00Z",
  },
  "user-3": {
    id: "user-3",
    email: "charlie@corp.io",
    name: "Charlie",
    plan: "enterprise",
    features: ["analytics", "api-access", "export", "sso", "audit-log"],
    createdAt: "2024-11-20T00:00:00Z",
  },
};

// ============================================================================
// Module
// ============================================================================

export const userProfile = createModule("user-profile", {
  schema,

  init: (facts) => {
    facts.userId = "";
    facts.profile = null;
    facts.status = "idle";
    facts.error = "";
  },

  events: {
    loadUser: (facts, { userId }) => {
      facts.userId = userId;
      facts.status = "loading";
      facts.error = "";
    },
  },

  derive: {
    effectivePlan: (facts) => {
      if (!facts.profile) {
        return "none";
      }

      return facts.profile.plan;
    },

    canUseFeature: (facts): Record<string, boolean> => {
      if (!facts.profile) {
        return {};
      }
      const features = facts.profile.features;

      return {
        analytics: features.includes("analytics"),
        "api-access": features.includes("api-access"),
        export: features.includes("export"),
        sso: features.includes("sso"),
        "audit-log": features.includes("audit-log"),
      };
    },

    isReady: (facts) => facts.status === "ready" && facts.profile !== null,
  },

  constraints: {
    fetchProfile: {
      when: (facts) => facts.status === "loading" && facts.userId !== "",
      require: (facts) => ({
        type: "FETCH_PROFILE",
        userId: facts.userId,
      }),
    },
  },

  resolvers: {
    fetchProfile: {
      requirement: "FETCH_PROFILE",
      resolve: async (req, context) => {
        // Simulate async database lookup
        await new Promise((resolve) => setTimeout(resolve, 50));

        const user = USERS[req.userId];
        if (user) {
          context.facts.profile = user;
          context.facts.status = "ready";
        } else {
          context.facts.profile = null;
          context.facts.status = "error";
          context.facts.error = `User ${req.userId} not found`;
        }
      },
    },
  },
});
