/**
 * Role-Based Permissions — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders user selector, permission badges, article list,
 * and admin panel.
 */

import { el } from "@directive-run/el";
import { system } from "./permissions.js";

// ============================================================================
// Start System
// ============================================================================

system.start();

// ============================================================================
// DOM References
// ============================================================================

const userAdminBtn = document.getElementById(
  "pm-user-admin",
) as HTMLButtonElement;
const userEditorBtn = document.getElementById(
  "pm-user-editor",
) as HTMLButtonElement;
const userViewerBtn = document.getElementById(
  "pm-user-viewer",
) as HTMLButtonElement;
const logoutBtn = document.getElementById("pm-logout") as HTMLButtonElement;

const permEditEl = document.getElementById("pm-perm-edit")!;
const permPublishEl = document.getElementById("pm-perm-publish")!;
const permDeleteEl = document.getElementById("pm-perm-delete")!;
const permManageUsersEl = document.getElementById("pm-perm-manage-users")!;
const permAnalyticsEl = document.getElementById("pm-perm-analytics")!;
const permInviteEl = document.getElementById("pm-perm-invite")!;
const permSettingsEl = document.getElementById("pm-perm-settings")!;

const articleListEl = document.getElementById("pm-article-list")!;
const adminPanelEl = document.getElementById("pm-admin-panel")!;
const actionStatusEl = document.getElementById("pm-action-status")!;

const toastEl = document.getElementById("pm-toast")!;

// ============================================================================
// Toast
// ============================================================================

let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function showToast(
  message: string,
  type: "denied" | "success" = "denied",
): void {
  toastEl.textContent = message;
  toastEl.className = `pm-toast visible ${type}`;

  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  toastTimeout = setTimeout(() => {
    toastEl.classList.remove("visible");
  }, 2500);
}

// ============================================================================
// Render
// ============================================================================

function renderPermBadge(badgeEl: HTMLElement, granted: boolean): void {
  badgeEl.classList.toggle("granted", granted);
  badgeEl.classList.toggle("denied", !granted);
}

function render(): void {
  const facts = system.facts;
  const derive = system.derive;

  const isAuthenticated = derive.auth.isAuthenticated;
  const userName = facts.auth.userName;
  const role = facts.auth.role;

  const canEdit = derive.permissions.canEdit;
  const canPublish = derive.permissions.canPublish;
  const canDelete = derive.permissions.canDelete;
  const canManageUsers = derive.permissions.canManageUsers;
  const canViewAnalytics = derive.permissions.canViewAnalytics;
  const permissions = facts.permissions.permissions;

  const articles = facts.content.articles;
  const contentLoaded = facts.content.loaded;
  const actionStatus = facts.content.actionStatus;

  // --- User selector bar ---
  userAdminBtn.classList.toggle("active", role === "admin");
  userEditorBtn.classList.toggle("active", role === "editor");
  userViewerBtn.classList.toggle("active", role === "viewer");
  logoutBtn.disabled = !isAuthenticated;

  // --- Permission badges ---
  renderPermBadge(permEditEl, canEdit);
  renderPermBadge(permPublishEl, canPublish);
  renderPermBadge(permDeleteEl, canDelete);
  renderPermBadge(permManageUsersEl, canManageUsers);
  renderPermBadge(permAnalyticsEl, canViewAnalytics);
  renderPermBadge(permInviteEl, permissions.includes("users.invite"));
  renderPermBadge(permSettingsEl, permissions.includes("settings.manage"));

  // --- Article list ---
  if (!isAuthenticated) {
    articleListEl.replaceChildren(
      el("div", { className: "pm-empty" }, "Sign in to view articles"),
    );
  } else if (!contentLoaded) {
    articleListEl.replaceChildren(
      el("div", { className: "pm-empty" }, "Loading articles..."),
    );
  } else if (articles.length === 0) {
    articleListEl.replaceChildren(
      el("div", { className: "pm-empty" }, "No articles"),
    );
  } else {
    articleListEl.replaceChildren(
      ...articles.map((article) => {
        const actionButtons: (HTMLElement | null)[] = [];

        if (canEdit) {
          actionButtons.push(
            el("button", { className: "pm-article-action edit", dataset: { articleId: article.id, action: "edit" } } as any, "Edit"),
          );
        }

        if (canPublish && article.status === "draft") {
          actionButtons.push(
            el("button", { className: "pm-article-action publish", dataset: { articleId: article.id, action: "publish" } } as any, "Publish"),
          );
        }

        if (canDelete) {
          actionButtons.push(
            el("button", { className: "pm-article-action delete", dataset: { articleId: article.id, action: "delete" } } as any, "Delete"),
          );
        }

        const actionsContent = actionButtons.length > 0
          ? actionButtons
          : [el("span", { className: "pm-no-actions" }, "No actions available")];

        return el("div", { className: "pm-article-card" },
          el("div", { className: "pm-article-header" },
            el("span", { className: "pm-article-title" }, article.title),
            el("span", { className: `pm-article-status ${article.status}` }, article.status),
          ),
          el("div", { className: "pm-article-meta" }, `by ${article.author}`),
          el("div", { className: "pm-article-actions" }, ...actionsContent),
        );
      }),
    );
  }

  // --- Action status ---
  if (actionStatus === "publishing") {
    actionStatusEl.textContent = "Publishing...";
    actionStatusEl.className = "pm-action-status active";
  } else if (actionStatus === "deleting") {
    actionStatusEl.textContent = "Deleting...";
    actionStatusEl.className = "pm-action-status active";
  } else if (actionStatus === "done") {
    actionStatusEl.textContent = "Done";
    actionStatusEl.className = "pm-action-status done";
  } else {
    actionStatusEl.textContent = "";
    actionStatusEl.className = "pm-action-status";
  }

  // --- Admin panel ---
  if (canManageUsers) {
    adminPanelEl.classList.add("visible");
    adminPanelEl.replaceChildren(
      el("div", { className: "pm-panel-header" }, "Admin Panel"),
      el("div", { className: "pm-panel-body" },
        el("div", { className: "pm-admin-info" },
          el("div", { className: "pm-admin-icon" }, "\u{1F6E1}"),
          el("div", { className: "pm-admin-label" }, "User Management"),
          el("div", { className: "pm-admin-detail" }, `Logged in as ${userName} (${role})`),
          el("div", { className: "pm-admin-detail" }, `${permissions.length} permissions granted`),
        ),
        el("div", { className: "pm-admin-placeholder" },
          el("div", { className: "pm-admin-row" }, "Users online: 12"),
          el("div", { className: "pm-admin-row" }, "Pending invites: 3"),
          el("div", { className: "pm-admin-row" }, "System health: OK"),
        ),
      ),
    );
  } else {
    adminPanelEl.classList.remove("visible");
    adminPanelEl.replaceChildren();
  }
}

// ============================================================================
// Subscribe
// ============================================================================

// Subscribe broadly — the system will dedupe renders
system.subscribe(
  [
    "auth::role",
    "auth::userName",
    "auth::token",
    "auth::isAuthenticated",
    "permissions::permissions",
    "permissions::loaded",
    "permissions::canEdit",
    "permissions::canPublish",
    "permissions::canDelete",
    "permissions::canManageUsers",
    "permissions::canViewAnalytics",
    "permissions::isAdmin",
    "permissions::permissionCount",
    "content::articles",
    "content::loaded",
    "content::actionStatus",
  ],
  render,
);

// ============================================================================
// Event Handlers
// ============================================================================

function loginAs(userId: string): void {
  // Reset permissions and content when switching users
  system.events.permissions.reset();
  system.events.content.clearAction();

  // Reset content loaded state by dispatching logout then login
  system.events.auth.logout();

  // Small delay to let constraints reset, then log in
  setTimeout(() => {
    system.events.auth.login({ userId });
  }, 50);
}

userAdminBtn.addEventListener("click", () => loginAs("alice"));
userEditorBtn.addEventListener("click", () => loginAs("bob"));
userViewerBtn.addEventListener("click", () => loginAs("carol"));

logoutBtn.addEventListener("click", () => {
  system.events.permissions.reset();
  system.events.content.clearAction();
  system.events.auth.logout();
});

// Article actions via event delegation
articleListEl.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const articleId = target.dataset.articleId;
  const action = target.dataset.action;

  if (!articleId || !action) {
    return;
  }

  const derive = system.derive;
  const canPublish = derive.permissions.canPublish;
  const canDelete = derive.permissions.canDelete;
  const canEdit = derive.permissions.canEdit;

  if (action === "edit") {
    if (!canEdit) {
      showToast("Permission Denied: You cannot edit content");

      return;
    }
    showToast("Editing is a UI-only action in this demo", "success");

    return;
  }

  if (action === "publish") {
    if (!canPublish) {
      showToast("Permission Denied: You cannot publish content");

      return;
    }
    system.events.content.requestPublish({ articleId });

    return;
  }

  if (action === "delete") {
    if (!canDelete) {
      showToast("Permission Denied: You cannot delete content");

      return;
    }
    system.events.content.requestDelete({ articleId });

    return;
  }
});

// ============================================================================
// Initial Render
// ============================================================================

render();

// Signal to tests that the module script has fully initialized
document.body.setAttribute("data-permissions-ready", "true");
