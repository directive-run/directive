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

import { el } from "@directive-run/el";
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

  const welcomeSpan = facts.auth.user
    ? (() => { const s = el("span", `Welcome, ${facts.auth.user.name}!`); s.style.marginLeft = "0.5rem"; return s; })()
    : null;
  authStatusEl.replaceChildren(
    el("span", { className: `status ${authStatus}` }, authStatus),
    ...(welcomeSpan ? [welcomeSpan] : []),
  );

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

  const statusClass = dataStatus === "success" ? "authenticated" : dataStatus === "error" ? "unauthenticated" : "loading";
  const usersSpan = facts.data.users.length > 0
    ? (() => { const s = el("span", `${facts.data.users.length} users loaded`); s.style.marginLeft = "0.5rem"; return s; })()
    : null;
  dataStatusEl.replaceChildren(
    el("span", { className: `status ${statusClass}` }, dataStatus),
    ...(usersSpan ? [usersSpan] : []),
    ...(facts.data.error ? [el("div", { className: "error" }, facts.data.error)] : []),
  );

  // User list
  if (facts.data.users.length > 0) {
    userListEl.replaceChildren(
      el("ul", { className: "user-list" },
        facts.data.users.map((u) =>
          el("li", el("strong", u.name), ` - ${u.department}`),
        ),
      ),
    );
  } else if (!facts.auth.isAuthenticated) {
    const p = el("p", "Login to see users");
    p.style.color = "#666";
    userListEl.replaceChildren(p);
  } else if (facts.data.isLoading) {
    const p = el("p", "Loading...");
    p.style.color = "#666";
    userListEl.replaceChildren(p);
  } else {
    const p = el("p", "No users");
    p.style.color = "#666";
    userListEl.replaceChildren(p);
  }

  // UI notifications - namespaced access: facts.ui.notifications
  const notifications = facts.ui.notifications;
  if (notifications.length > 0) {
    uiNotificationEl.replaceChildren(
      ...notifications.map((n) => {
        const notifClass = n.type === "success" ? "authenticated" : n.type === "error" ? "unauthenticated" : "loading";
        const notifEl = el("div", { className: `status ${notifClass}` }, n.message);
        notifEl.style.marginBottom = "0.5rem";
        notifEl.style.display = "block";

        return notifEl;
      }),
    );
  } else {
    const p = el("p", "No notifications");
    p.style.color = "#666";
    uiNotificationEl.replaceChildren(p);
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
