/**
 * Role-Based Permissions — Directive Modules
 *
 * Three modules demonstrate cross-module constraint resolution:
 * - auth: manages login state (role, userName, token)
 * - permissions: loads permissions based on auth role, derives capability flags
 * - content: manages articles with permission-gated actions
 *
 * The system uses `crossModuleDeps` so constraints in one module
 * can react to derivations/facts from another module.
 */

import { createModule, createSystem, t, type ModuleSchema } from "@directive-run/core";
import {
  fetchPermissions as apiFetchPermissions,
  fetchArticles as apiFetchArticles,
  publishArticle as apiPublishArticle,
  deleteArticle as apiDeleteArticle,
  type Article,
} from "./mock-api.js";

// ============================================================================
// Preset Users
// ============================================================================

const presetUsers: Record<string, { userName: string; role: string; token: string }> = {
  alice: { userName: "Alice", role: "admin", token: "tok-alice-admin" },
  bob: { userName: "Bob", role: "editor", token: "tok-bob-editor" },
  carol: { userName: "Carol", role: "viewer", token: "tok-carol-viewer" },
};

// ============================================================================
// Auth Module
// ============================================================================

export const authSchema = {
  facts: {
    role: t.string(),
    userName: t.string(),
    token: t.string(),
  },
  derivations: {
    isAuthenticated: t.boolean(),
  },
  events: {
    login: { userId: t.string() },
    logout: {},
  },
  requirements: {},
} satisfies ModuleSchema;

export const authModule = createModule("auth", {
  schema: authSchema,

  init: (facts) => {
    facts.role = "";
    facts.userName = "";
    facts.token = "";
  },

  derive: {
    isAuthenticated: (facts) => facts.token !== "",
  },

  events: {
    login: (facts, { userId }) => {
      const preset = presetUsers[userId];
      if (!preset) {
        return;
      }

      facts.token = preset.token;
      facts.userName = preset.userName;
      facts.role = preset.role;
    },

    logout: (facts) => {
      facts.token = "";
      facts.userName = "";
      facts.role = "";
    },
  },
});

// ============================================================================
// Permissions Module
// ============================================================================

export const permissionsSchema = {
  facts: {
    permissions: t.object<string[]>(),
    loaded: t.boolean(),
  },
  derivations: {
    canEdit: t.boolean(),
    canPublish: t.boolean(),
    canDelete: t.boolean(),
    canManageUsers: t.boolean(),
    canViewAnalytics: t.boolean(),
    isAdmin: t.boolean(),
    permissionCount: t.number(),
  },
  events: {
    reset: {},
  },
  requirements: {
    FETCH_PERMISSIONS: { role: t.string() },
  },
} satisfies ModuleSchema;

export const permissionsModule = createModule("permissions", {
  schema: permissionsSchema,

  crossModuleDeps: { auth: authSchema },

  init: (facts) => {
    facts.permissions = [];
    facts.loaded = false;
  },

  derive: {
    canEdit: (facts) => (facts.self.permissions as string[]).includes("content.edit"),
    canPublish: (facts) => (facts.self.permissions as string[]).includes("content.publish"),
    canDelete: (facts) => (facts.self.permissions as string[]).includes("content.delete"),
    canManageUsers: (facts) => (facts.self.permissions as string[]).includes("users.manage"),
    canViewAnalytics: (facts) => (facts.self.permissions as string[]).includes("analytics.view"),
    isAdmin: (_facts, derive) => derive.canManageUsers as boolean,
    permissionCount: (facts) => (facts.self.permissions as string[]).length,
  },

  events: {
    reset: (facts) => {
      facts.permissions = [];
      facts.loaded = false;
    },
  },

  constraints: {
    loadPermissions: {
      when: (facts) => {
        return (
          facts.auth.isAuthenticated === true &&
          !(facts.self.loaded as boolean)
        );
      },
      require: (facts) => ({
        type: "FETCH_PERMISSIONS",
        role: facts.auth.role as string,
      }),
    },
  },

  resolvers: {
    fetchPermissions: {
      requirement: "FETCH_PERMISSIONS",
      timeout: 5000,
      resolve: async (req, context) => {
        const perms = await apiFetchPermissions(req.role);
        context.facts.permissions = perms;
        context.facts.loaded = true;
      },
    },
  },
});

// ============================================================================
// Content Module
// ============================================================================

export const contentSchema = {
  facts: {
    articles: t.object<Article[]>(),
    loaded: t.boolean(),
    publishRequested: t.string(),
    deleteRequested: t.string(),
    actionStatus: t.string(),
  },
  derivations: {},
  events: {
    requestPublish: { articleId: t.string() },
    requestDelete: { articleId: t.string() },
    clearAction: {},
  },
  requirements: {
    LOAD_CONTENT: {},
    PUBLISH_ARTICLE: { articleId: t.string() },
    DELETE_ARTICLE: { articleId: t.string() },
  },
} satisfies ModuleSchema;

export const contentModule = createModule("content", {
  schema: contentSchema,

  crossModuleDeps: { auth: authSchema, permissions: permissionsSchema },

  init: (facts) => {
    facts.articles = [];
    facts.loaded = false;
    facts.publishRequested = "";
    facts.deleteRequested = "";
    facts.actionStatus = "idle";
  },

  constraints: {
    loadContent: {
      when: (facts) => {
        return (
          facts.auth.isAuthenticated === true &&
          !(facts.self.loaded as boolean)
        );
      },
      require: { type: "LOAD_CONTENT" },
    },

    publishArticle: {
      when: (facts) => {
        return (
          (facts.self.publishRequested as string) !== "" &&
          facts.permissions.canPublish === true
        );
      },
      require: (facts) => ({
        type: "PUBLISH_ARTICLE",
        articleId: facts.self.publishRequested as string,
      }),
    },

    deleteArticle: {
      when: (facts) => {
        return (
          (facts.self.deleteRequested as string) !== "" &&
          facts.permissions.canDelete === true
        );
      },
      require: (facts) => ({
        type: "DELETE_ARTICLE",
        articleId: facts.self.deleteRequested as string,
      }),
    },
  },

  resolvers: {
    loadContent: {
      requirement: "LOAD_CONTENT",
      timeout: 5000,
      resolve: async (_req, context) => {
        const articles = await apiFetchArticles();
        context.facts.articles = articles;
        context.facts.loaded = true;
      },
    },

    publishArticle: {
      requirement: "PUBLISH_ARTICLE",
      timeout: 5000,
      resolve: async (req, context) => {
        context.facts.actionStatus = "publishing";
        await apiPublishArticle(req.articleId);

        const articles = context.facts.articles as Article[];
        context.facts.articles = articles.map((a) => {
          if (a.id === req.articleId) {
            return { ...a, status: "published" as const };
          }

          return a;
        });
        context.facts.publishRequested = "";
        context.facts.actionStatus = "done";
      },
    },

    deleteArticle: {
      requirement: "DELETE_ARTICLE",
      timeout: 5000,
      resolve: async (req, context) => {
        context.facts.actionStatus = "deleting";
        await apiDeleteArticle(req.articleId);

        const articles = context.facts.articles as Article[];
        context.facts.articles = articles.filter((a) => a.id !== req.articleId);
        context.facts.deleteRequested = "";
        context.facts.actionStatus = "done";
      },
    },
  },

  events: {
    requestPublish: (facts, { articleId }) => {
      facts.publishRequested = articleId;
      facts.actionStatus = "idle";
    },

    requestDelete: (facts, { articleId }) => {
      facts.deleteRequested = articleId;
      facts.actionStatus = "idle";
    },

    clearAction: (facts) => {
      facts.publishRequested = "";
      facts.deleteRequested = "";
      facts.actionStatus = "idle";
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  modules: {
    auth: authModule,
    permissions: permissionsModule,
    content: contentModule,
  },
});
