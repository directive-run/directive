/**
 * Role-Based Permissions — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders user selector, permission badges, article list,
 * and admin panel.
 */

import { system } from "./permissions.js";
import type { Article } from "./mock-api.js";

// ============================================================================
// Start System
// ============================================================================

system.start();

// ============================================================================
// DOM References
// ============================================================================

const userAdminBtn = document.getElementById("pm-user-admin") as HTMLButtonElement;
const userEditorBtn = document.getElementById("pm-user-editor") as HTMLButtonElement;
const userViewerBtn = document.getElementById("pm-user-viewer") as HTMLButtonElement;
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

function showToast(message: string, type: "denied" | "success" = "denied"): void {
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

function renderPermBadge(el: HTMLElement, granted: boolean): void {
  el.classList.toggle("granted", granted);
  el.classList.toggle("denied", !granted);
}

function render(): void {
  const facts = system.facts;
  const derive = system.derive;

  const isAuthenticated = derive.auth.isAuthenticated as boolean;
  const userName = facts.auth.userName as string;
  const role = facts.auth.role as string;

  const canEdit = derive.permissions.canEdit as boolean;
  const canPublish = derive.permissions.canPublish as boolean;
  const canDelete = derive.permissions.canDelete as boolean;
  const canManageUsers = derive.permissions.canManageUsers as boolean;
  const canViewAnalytics = derive.permissions.canViewAnalytics as boolean;
  const permissions = facts.permissions.permissions as string[];

  const articles = facts.content.articles as Article[];
  const contentLoaded = facts.content.loaded as boolean;
  const actionStatus = facts.content.actionStatus as string;

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
    articleListEl.innerHTML = '<div class="pm-empty">Sign in to view articles</div>';
  } else if (!contentLoaded) {
    articleListEl.innerHTML = '<div class="pm-empty">Loading articles...</div>';
  } else if (articles.length === 0) {
    articleListEl.innerHTML = '<div class="pm-empty">No articles</div>';
  } else {
    articleListEl.innerHTML = articles
      .map((article) => {
        const statusClass = article.status;
        let actions = "";

        if (canEdit) {
          actions += `<button class="pm-article-action edit" data-article-id="${article.id}" data-action="edit">Edit</button>`;
        }

        if (canPublish && article.status === "draft") {
          actions += `<button class="pm-article-action publish" data-article-id="${article.id}" data-action="publish">Publish</button>`;
        }

        if (canDelete) {
          actions += `<button class="pm-article-action delete" data-article-id="${article.id}" data-action="delete">Delete</button>`;
        }

        return `
          <div class="pm-article-card">
            <div class="pm-article-header">
              <span class="pm-article-title">${escapeHtml(article.title)}</span>
              <span class="pm-article-status ${statusClass}">${article.status}</span>
            </div>
            <div class="pm-article-meta">by ${escapeHtml(article.author)}</div>
            <div class="pm-article-actions">${actions || '<span class="pm-no-actions">No actions available</span>'}</div>
          </div>
        `;
      })
      .join("");
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
    adminPanelEl.innerHTML = `
      <div class="pm-panel-header">Admin Panel</div>
      <div class="pm-panel-body">
        <div class="pm-admin-info">
          <div class="pm-admin-icon">&#x1f6e1;</div>
          <div class="pm-admin-label">User Management</div>
          <div class="pm-admin-detail">Logged in as ${escapeHtml(userName)} (${escapeHtml(role)})</div>
          <div class="pm-admin-detail">${permissions.length} permissions granted</div>
        </div>
        <div class="pm-admin-placeholder">
          <div class="pm-admin-row">Users online: 12</div>
          <div class="pm-admin-row">Pending invites: 3</div>
          <div class="pm-admin-row">System health: OK</div>
        </div>
      </div>
    `;
  } else {
    adminPanelEl.classList.remove("visible");
    adminPanelEl.innerHTML = "";
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
  const canPublish = derive.permissions.canPublish as boolean;
  const canDelete = derive.permissions.canDelete as boolean;
  const canEdit = derive.permissions.canEdit as boolean;

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
document.body.setAttribute("data-permissions-ready", "true");
