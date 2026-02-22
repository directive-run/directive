/**
 * Mock API Functions
 *
 * Simulates async API calls with configurable delay and failure rates.
 * Each function accepts a failRate (0-100) to simulate transient failures.
 */

// ============================================================================
// Types
// ============================================================================

export interface SessionResult {
  valid: boolean;
  userId: string;
}

export interface PermissionsResult {
  role: "admin" | "editor" | "viewer";
  permissions: string[];
}

export interface DashboardWidget {
  id: string;
  type: string;
  title: string;
  value: string;
}

export interface DashboardResult {
  widgets: DashboardWidget[];
}

// ============================================================================
// Helpers
// ============================================================================

function shouldFail(failRate: number): boolean {
  return Math.random() * 100 < failRate;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// API Functions
// ============================================================================

export async function validateSession(
  token: string,
  failRate: number,
): Promise<SessionResult> {
  await delay(600);

  if (shouldFail(failRate)) {
    throw new Error("Session validation failed (network error)");
  }

  return {
    valid: token.length > 0,
    userId: `user-${token.slice(0, 6)}`,
  };
}

export async function fetchPermissions(
  failRate: number,
): Promise<PermissionsResult> {
  await delay(400);

  if (shouldFail(failRate)) {
    throw new Error("Permissions fetch failed (timeout)");
  }

  const roles = ["admin", "editor", "viewer"] as const;
  const role = roles[Math.floor(Math.random() * roles.length)]!;

  const permissionsByRole: Record<string, string[]> = {
    admin: ["read", "write", "delete", "manage-users", "view-analytics"],
    editor: ["read", "write", "view-analytics"],
    viewer: ["read"],
  };

  return {
    role,
    permissions: permissionsByRole[role] ?? ["read"],
  };
}

export async function fetchDashboard(
  role: string,
  failRate: number,
): Promise<DashboardResult> {
  await delay(500);

  if (shouldFail(failRate)) {
    throw new Error("Dashboard fetch failed (server error)");
  }

  const baseWidgets: DashboardWidget[] = [
    { id: "w1", type: "stat", title: "Active Users", value: "1,247" },
    { id: "w2", type: "chart", title: "Revenue", value: "$84.2K" },
  ];

  if (role === "admin" || role === "editor") {
    baseWidgets.push(
      { id: "w3", type: "table", title: "Recent Orders", value: "38 pending" },
      { id: "w4", type: "stat", title: "Conversion Rate", value: "3.2%" },
    );
  }

  if (role === "admin") {
    baseWidgets.push(
      { id: "w5", type: "chart", title: "Server Load", value: "42% avg" },
      { id: "w6", type: "stat", title: "Error Rate", value: "0.03%" },
    );
  }

  return { widgets: baseWidgets };
}
