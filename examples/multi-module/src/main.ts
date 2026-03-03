/**
 * Multi-Module Example - Main Entry Point
 *
 * Demonstrates the NEW namespaced module access:
 * - `system.facts.auth.token` instead of `system.facts.auth_token`
 * - `system.derive.data.userCount` instead of `system.derive.data_userCount`
 * - `system.events.auth.login({ token })` instead of `dispatch({ type: "auth_login", token })`
 *
 * Cross-module constraints work automatically:
 * - Data fetches when auth succeeds
 * - No asCombined() helper needed
 */

import { getFacts, system } from "./system";

// DOM Elements
const authStatusEl = document.getElementById("auth-status")!;
const loginBtn = document.getElementById("login-btn") as HTMLButtonElement;
const logoutBtn = document.getElementById("logout-btn") as HTMLButtonElement;
const dataStatusEl = document.getElementById("data-status")!;
const userListEl = document.getElementById("user-list")!;
const uiNotificationEl = document.getElementById("ui-notification")!;
const stateDisplayEl = document.getElementById("state-display")!;

// Start the system
system.start();

// Update UI function
function updateUI() {
  const facts = getFacts();

  // Auth status - namespaced access: facts.auth.isValidating, facts.auth.isAuthenticated
  const authStatus = facts.auth.isValidating
    ? "validating"
    : facts.auth.isAuthenticated
      ? "authenticated"
      : "unauthenticated";

  authStatusEl.innerHTML = `
    <span class="status ${authStatus}">${authStatus}</span>
    ${facts.auth.user ? `<span style="margin-left: 0.5rem">Welcome, ${facts.auth.user.name}!</span>` : ""}
  `;

  // Button states
  loginBtn.disabled = facts.auth.isAuthenticated || facts.auth.isValidating;
  logoutBtn.disabled = !facts.auth.isAuthenticated;

  // Data status - namespaced access: facts.data.isLoading, facts.data.error
  const dataStatus = facts.data.isLoading
    ? "loading"
    : facts.data.error
      ? "error"
      : facts.data.lastFetched
        ? "success"
        : "idle";

  dataStatusEl.innerHTML = `
    <span class="status ${dataStatus === "success" ? "authenticated" : dataStatus === "error" ? "unauthenticated" : "loading"}">
      ${dataStatus}
    </span>
    ${facts.data.users.length > 0 ? `<span style="margin-left: 0.5rem">${facts.data.users.length} users loaded</span>` : ""}
    ${facts.data.error ? `<div class="error">${facts.data.error}</div>` : ""}
  `;

  // User list
  if (facts.data.users.length > 0) {
    userListEl.innerHTML = `
      <ul class="user-list">
        ${facts.data.users.map((u) => `<li><strong>${u.name}</strong> - ${u.department}</li>`).join("")}
      </ul>
    `;
  } else if (!facts.auth.isAuthenticated) {
    userListEl.innerHTML = `<p style="color: #666">Login to see users</p>`;
  } else if (facts.data.isLoading) {
    userListEl.innerHTML = `<p style="color: #666">Loading...</p>`;
  } else {
    userListEl.innerHTML = `<p style="color: #666">No users</p>`;
  }

  // UI notifications - namespaced access: facts.ui.notifications
  const notifications = facts.ui.notifications;
  if (notifications.length > 0) {
    uiNotificationEl.innerHTML = notifications
      .map(
        (n) => `
        <div class="status ${n.type === "success" ? "authenticated" : n.type === "error" ? "unauthenticated" : "loading"}" style="margin-bottom: 0.5rem; display: block">
          ${n.message}
        </div>
      `,
      )
      .join("");
  } else {
    uiNotificationEl.innerHTML = `<p style="color: #666">No notifications</p>`;
  }

  // State display - show the namespaced structure
  const displayState = {
    auth: {
      token: facts.auth.token,
      user: facts.auth.user,
      isAuthenticated: facts.auth.isAuthenticated,
      isValidating: facts.auth.isValidating,
    },
    data: {
      users: facts.data.users,
      isLoading: facts.data.isLoading,
      error: facts.data.error,
      lastFetched: facts.data.lastFetched,
    },
    ui: {
      notifications: facts.ui.notifications,
      lastNotificationId: facts.ui.lastNotificationId,
    },
  };
  stateDisplayEl.textContent = JSON.stringify(displayState, null, 2);
}

// Subscribe to derivation changes using namespaced keys
// Note: The internal keys are still prefixed (auth_status), so we use those for subscribe
system.subscribe(
  [
    "auth_status",
    "auth_displayName",
    "data_status",
    "data_userCount",
    "ui_hasNotifications",
  ],
  () => {
    updateUI();
  },
);

// Also update on fact changes via polling (simple approach for this demo)
setInterval(updateUI, 100);

// Event handlers using namespaced events accessor
loginBtn.addEventListener("click", () => {
  // NEW: Use namespaced events accessor
  // system.events.auth.login({ token }) instead of dispatch({ type: "auth_login", token })
  system.events.auth.login({ token: "valid-token" });

  // Add a notification using namespaced events
  system.events.ui.addNotification({ type: "info", message: "Logging in..." });
});

logoutBtn.addEventListener("click", () => {
  // Dispatch logout using namespaced events
  system.events.auth.logout();

  // Clear data using namespaced events
  system.events.data.clear();

  // Add logout notification
  system.events.ui.addNotification({ type: "info", message: "Logged out" });
});

// Initial render
updateUI();

// Log to console for debugging
console.log("Multi-Module Example Started (Namespaced Mode)");
console.log("Try clicking Login to see the cross-module constraint in action:");
console.log("1. Auth module validates token via facts.auth.*");
console.log(
  "2. Data module automatically fetches users when facts.auth.isAuthenticated",
);
console.log("3. UI module effects react to facts.data.* changes");
