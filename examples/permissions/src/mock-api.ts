/**
 * Mock API — Role-Based Permissions Example
 *
 * Simulates backend calls for permissions and article management.
 * All data is deterministic; no real network calls.
 */

// ============================================================================
// Types
// ============================================================================

export interface Article {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  author: string;
}

// ============================================================================
// Helpers
// ============================================================================

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// API Functions
// ============================================================================

const permissionsByRole: Record<string, string[]> = {
  admin: [
    "content.edit",
    "content.publish",
    "content.delete",
    "users.manage",
    "users.invite",
    "analytics.view",
    "settings.manage",
  ],
  editor: ["content.edit", "content.publish", "analytics.view"],
  viewer: ["analytics.view"],
};

export async function fetchPermissions(role: string): Promise<string[]> {
  await wait(500);

  return permissionsByRole[role] ?? [];
}

export async function fetchArticles(): Promise<Article[]> {
  await wait(400);

  return [
    {
      id: "a1",
      title: "Getting Started with Directive",
      status: "published",
      author: "Alice",
    },
    {
      id: "a2",
      title: "Constraint-Driven Architecture",
      status: "draft",
      author: "Bob",
    },
    {
      id: "a3",
      title: "Reactive State Management",
      status: "published",
      author: "Alice",
    },
    {
      id: "a4",
      title: "Cross-Module Dependencies",
      status: "draft",
      author: "Carol",
    },
    {
      id: "a5",
      title: "Advanced Resolver Patterns",
      status: "archived",
      author: "Bob",
    },
  ];
}

export async function publishArticle(
  id: string,
): Promise<{ success: boolean }> {
  await wait(300);

  return { success: true };
}

export async function deleteArticle(id: string): Promise<{ success: boolean }> {
  await wait(300);

  return { success: true };
}
