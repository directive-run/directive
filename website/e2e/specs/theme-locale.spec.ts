import { test, expect } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("Theme & Locale example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/theme-locale");
    // Clear persisted prefs before each test
    await page.evaluate(() => localStorage.removeItem("directive-theme-locale-example"));
    await page.reload();
    try {
      await page.waitForSelector("directive-theme-locale", { state: "attached", timeout: 30_000 });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-theme-locale", { state: "attached", timeout: 30_000 });
    }
    await page.waitForSelector("[data-theme-locale-ready]", { timeout: 15_000 });
  });

  test("page loads with default settings", async ({ page }) => {
    // System theme is default
    await expect(tid(page, "tl-theme-system")).toHaveClass(/tl-btn-active/);
    await expect(tid(page, "tl-theme-light")).not.toHaveClass(/tl-btn-active/);
    await expect(tid(page, "tl-theme-dark")).not.toHaveClass(/tl-btn-active/);

    // English locale
    await expect(tid(page, "tl-locale-select")).toHaveValue("en");

    // Preview shows English greeting
    await expect(tid(page, "tl-preview")).toContainText("Hello");

    // Sidebar toggle shows "Hide Sidebar" (open by default)
    await expect(tid(page, "tl-sidebar-toggle")).toContainText("Hide Sidebar");
  });

  test("switch to light theme", async ({ page }) => {
    await tid(page, "tl-theme-light").click();
    await page.waitForTimeout(200);

    // Light button active
    await expect(tid(page, "tl-theme-light")).toHaveClass(/tl-btn-active/);
    await expect(tid(page, "tl-theme-system")).not.toHaveClass(/tl-btn-active/);

    // Effective theme badge shows light
    await expect(tid(page, "tl-effective-theme")).toHaveText("light");
    await expect(tid(page, "tl-effective-theme")).toHaveClass(/tl-badge-light/);
  });

  test("switch to dark theme", async ({ page }) => {
    await tid(page, "tl-theme-dark").click();
    await page.waitForTimeout(200);

    await expect(tid(page, "tl-theme-dark")).toHaveClass(/tl-btn-active/);
    await expect(tid(page, "tl-effective-theme")).toHaveText("dark");
    await expect(tid(page, "tl-effective-theme")).toHaveClass(/tl-badge-dark/);
  });

  test("change locale to Spanish", async ({ page }) => {
    await tid(page, "tl-locale-select").selectOption("es");
    await page.waitForTimeout(200);

    // Preview shows Spanish translations
    await expect(tid(page, "tl-preview")).toContainText("Hola");
  });

  test("change locale to French", async ({ page }) => {
    await tid(page, "tl-locale-select").selectOption("fr");
    await page.waitForTimeout(200);

    await expect(tid(page, "tl-preview")).toContainText("Bonjour");
  });

  test("toggle sidebar on and off", async ({ page }) => {
    // Initially open
    await expect(tid(page, "tl-sidebar-toggle")).toContainText("Hide Sidebar");
    await expect(tid(page, "tl-sidebar-toggle")).toHaveClass(/tl-btn-active/);

    // Toggle off
    await tid(page, "tl-sidebar-toggle").click();
    await page.waitForTimeout(200);
    await expect(tid(page, "tl-sidebar-toggle")).toContainText("Show Sidebar");
    await expect(tid(page, "tl-sidebar-toggle")).not.toHaveClass(/tl-btn-active/);

    // Toggle back on
    await tid(page, "tl-sidebar-toggle").click();
    await page.waitForTimeout(200);
    await expect(tid(page, "tl-sidebar-toggle")).toContainText("Hide Sidebar");
    await expect(tid(page, "tl-sidebar-toggle")).toHaveClass(/tl-btn-active/);
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
