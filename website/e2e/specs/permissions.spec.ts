import { expect, test } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("Permissions example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/permissions");
    try {
      await page.waitForSelector("directive-permissions", {
        state: "attached",
        timeout: 30_000,
      });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-permissions", {
        state: "attached",
        timeout: 30_000,
      });
    }
    await page.waitForSelector("[data-permissions-ready]", { timeout: 15_000 });
  });

  test("page loads without authentication", async ({ page }) => {
    // All permission badges should be denied
    await expect(tid(page, "pm-perm-edit")).toHaveClass(/denied/);
    await expect(tid(page, "pm-perm-publish")).toHaveClass(/denied/);
    await expect(tid(page, "pm-perm-delete")).toHaveClass(/denied/);
    await expect(tid(page, "pm-perm-manage-users")).toHaveClass(/denied/);
    await expect(tid(page, "pm-perm-analytics")).toHaveClass(/denied/);

    // Article list shows sign-in message
    await expect(tid(page, "pm-article-list")).toContainText(
      "Sign in to view articles",
    );

    // Admin panel not visible
    await expect(tid(page, "pm-admin-panel")).not.toHaveClass(/visible/);

    // Logout button disabled
    await expect(tid(page, "pm-logout")).toBeDisabled();
  });

  test("login as admin shows all permissions", async ({ page }) => {
    await tid(page, "pm-user-admin").click();

    // Wait for permissions to load (500ms mock API)
    await expect(tid(page, "pm-perm-edit")).toHaveClass(/granted/, {
      timeout: 5_000,
    });

    // All 7 badges granted
    await expect(tid(page, "pm-perm-edit")).toHaveClass(/granted/);
    await expect(tid(page, "pm-perm-publish")).toHaveClass(/granted/);
    await expect(tid(page, "pm-perm-delete")).toHaveClass(/granted/);
    await expect(tid(page, "pm-perm-manage-users")).toHaveClass(/granted/);
    await expect(tid(page, "pm-perm-analytics")).toHaveClass(/granted/);
    await expect(tid(page, "pm-perm-invite")).toHaveClass(/granted/);
    await expect(tid(page, "pm-perm-settings")).toHaveClass(/granted/);

    // Admin panel visible
    await expect(tid(page, "pm-admin-panel")).toHaveClass(/visible/);
    await expect(tid(page, "pm-admin-panel")).toContainText("Admin Panel");
  });

  test("login as editor shows limited permissions", async ({ page }) => {
    await tid(page, "pm-user-editor").click();

    // Wait for permissions to load
    await expect(tid(page, "pm-perm-edit")).toHaveClass(/granted/, {
      timeout: 5_000,
    });

    // Editor gets: edit, publish, analytics
    await expect(tid(page, "pm-perm-edit")).toHaveClass(/granted/);
    await expect(tid(page, "pm-perm-publish")).toHaveClass(/granted/);
    await expect(tid(page, "pm-perm-analytics")).toHaveClass(/granted/);

    // Editor does NOT get: delete, manage users, invite, settings
    await expect(tid(page, "pm-perm-delete")).toHaveClass(/denied/);
    await expect(tid(page, "pm-perm-manage-users")).toHaveClass(/denied/);
    await expect(tid(page, "pm-perm-invite")).toHaveClass(/denied/);
    await expect(tid(page, "pm-perm-settings")).toHaveClass(/denied/);

    // No admin panel
    await expect(tid(page, "pm-admin-panel")).not.toHaveClass(/visible/);
  });

  test("login as viewer shows minimal permissions", async ({ page }) => {
    await tid(page, "pm-user-viewer").click();

    // Wait for permissions to load
    await expect(tid(page, "pm-perm-analytics")).toHaveClass(/granted/, {
      timeout: 5_000,
    });

    // Viewer gets only analytics
    await expect(tid(page, "pm-perm-analytics")).toHaveClass(/granted/);

    // Everything else denied
    await expect(tid(page, "pm-perm-edit")).toHaveClass(/denied/);
    await expect(tid(page, "pm-perm-publish")).toHaveClass(/denied/);
    await expect(tid(page, "pm-perm-delete")).toHaveClass(/denied/);
    await expect(tid(page, "pm-perm-manage-users")).toHaveClass(/denied/);
  });

  test("articles load after login", async ({ page }) => {
    await tid(page, "pm-user-admin").click();

    // Wait for articles to load (400ms mock API)
    const articles = tid(page, "pm-article-list").locator(".pm-article-card");
    await expect(articles).toHaveCount(5, { timeout: 5_000 });

    // Check article content
    await expect(tid(page, "pm-article-list")).toContainText(
      "Getting Started with Directive",
    );
    await expect(tid(page, "pm-article-list")).toContainText(
      "Constraint-Driven Architecture",
    );
  });

  test("admin can publish draft article", async ({ page }) => {
    await tid(page, "pm-user-admin").click();

    // Wait for articles + permissions to load
    const articles = tid(page, "pm-article-list").locator(".pm-article-card");
    await expect(articles).toHaveCount(5, { timeout: 5_000 });
    await expect(tid(page, "pm-perm-publish")).toHaveClass(/granted/, {
      timeout: 5_000,
    });

    // Find a draft article's publish button
    const publishBtn = tid(page, "pm-article-list")
      .locator('[data-action="publish"]')
      .first();
    await publishBtn.click();

    // Action status shows publishing then done
    await expect(tid(page, "pm-action-status")).toContainText("Done", {
      timeout: 5_000,
    });
  });

  test("logout clears state", async ({ page }) => {
    // Login as admin
    await tid(page, "pm-user-admin").click();
    await expect(tid(page, "pm-perm-edit")).toHaveClass(/granted/, {
      timeout: 5_000,
    });

    // Logout
    await tid(page, "pm-logout").click();
    await page.waitForTimeout(300);

    // Back to unauthenticated state
    await expect(tid(page, "pm-article-list")).toContainText(
      "Sign in to view articles",
    );
    await expect(tid(page, "pm-perm-edit")).toHaveClass(/denied/);
    await expect(tid(page, "pm-admin-panel")).not.toHaveClass(/visible/);
    await expect(tid(page, "pm-logout")).toBeDisabled();
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
