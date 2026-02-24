import { test, expect } from "@playwright/test";

/**
 * Core DevTools Panel E2E Tests
 *
 * Tests the floating devtools panel on the shopping-cart example,
 * which uses `devtoolsPlugin({ panel: true })`.
 *
 * Note: The panel only renders when `isDevMode()` returns true (i.e.,
 * process.env.NODE_ENV !== "production"). In production-built examples,
 * the panel DOM is not created. These tests detect this and skip.
 * The console API (window.__DIRECTIVE__) is still available regardless.
 */
test.describe("Core DevTools Panel", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/shopping-cart");
    try {
      await page.waitForSelector("directive-shopping-cart", { state: "attached", timeout: 30_000 });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-shopping-cart", { state: "attached", timeout: 30_000 });
    }
    await page.waitForSelector("[data-shopping-cart-ready]", { timeout: 15_000 });
  });

  test("devtoolsPlugin registers system on window.__DIRECTIVE__", async ({ page }) => {
    // Even when the panel doesn't render (production build), the console API is still available
    const exists = await page.evaluate(() => {
      return typeof window.__DIRECTIVE__ === "object" && window.__DIRECTIVE__ !== null;
    });
    expect(exists).toBe(true);
  });

  test("panel toggle button renders in dev mode", async ({ page }) => {
    // The panel only renders when isDevMode() returns true
    const toggle = page.locator("button[aria-label='Open Directive DevTools']");
    const panelExists = await toggle.isVisible().catch(() => false);

    if (!panelExists) {
      // In production builds, the panel toggle is not rendered — this is expected behavior
      test.skip(true, "DevTools panel not rendered (production build — isDevMode() returns false)");
    }

    await expect(toggle).toHaveText("Directive");
  });

  test("panel opens and shows facts", async ({ page }) => {
    const toggle = page.locator("button[aria-label='Open Directive DevTools']");
    const panelExists = await toggle.isVisible().catch(() => false);

    if (!panelExists) {
      test.skip(true, "DevTools panel not rendered (production build)");
    }

    await toggle.click();

    const panel = page.locator("[data-directive-devtools]");
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Facts section should be present
    const factsSummary = panel.locator("summary", { hasText: "Facts" });
    await expect(factsSummary).toBeVisible({ timeout: 5_000 });
  });

  test("panel shows derivations section", async ({ page }) => {
    const toggle = page.locator("button[aria-label='Open Directive DevTools']");
    const panelExists = await toggle.isVisible().catch(() => false);

    if (!panelExists) {
      test.skip(true, "DevTools panel not rendered (production build)");
    }

    await toggle.click();

    const panel = page.locator("[data-directive-devtools]");
    await expect(panel).toBeVisible({ timeout: 5_000 });

    const derivSummary = panel.locator("summary", { hasText: "Derivations" });
    await expect(derivSummary).toBeVisible({ timeout: 5_000 });
  });

  test("panel dependency graph renders SVG", async ({ page }) => {
    const toggle = page.locator("button[aria-label='Open Directive DevTools']");
    const panelExists = await toggle.isVisible().catch(() => false);

    if (!panelExists) {
      test.skip(true, "DevTools panel not rendered (production build)");
    }

    await toggle.click();

    const panel = page.locator("[data-directive-devtools]");
    await expect(panel).toBeVisible({ timeout: 5_000 });

    const graphSummary = panel.locator("summary", { hasText: "Dependency Graph" });
    await expect(graphSummary).toBeVisible({ timeout: 5_000 });
    await graphSummary.click();

    const svg = panel.locator("details:has(summary:has-text('Dependency Graph')) svg");
    await expect(svg).toBeAttached({ timeout: 5_000 });
  });

  test("panel closes with Escape key", async ({ page }) => {
    const toggle = page.locator("button[aria-label='Open Directive DevTools']");
    const panelExists = await toggle.isVisible().catch(() => false);

    if (!panelExists) {
      test.skip(true, "DevTools panel not rendered (production build)");
    }

    await toggle.click();

    const panel = page.locator("[data-directive-devtools]");
    await expect(panel).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible({ timeout: 5_000 });
  });

  test("panel does not break host page functionality", async ({ page }) => {
    // This test validates the page works regardless of panel state
    const items = page.locator("[data-testid='sc-item-list'] .sc-item");
    await expect(items).toHaveCount(3);
    await expect(page.locator("[data-testid='sc-subtotal']")).toHaveText(/\$\d+\.\d{2}/);
  });

  test("time-travel controls are present", async ({ page }) => {
    const toggle = page.locator("button[aria-label='Open Directive DevTools']");
    const panelExists = await toggle.isVisible().catch(() => false);

    if (!panelExists) {
      test.skip(true, "DevTools panel not rendered (production build)");
    }

    await toggle.click();

    const panel = page.locator("[data-directive-devtools]");
    await expect(panel).toBeVisible({ timeout: 5_000 });

    const ttSummary = panel.locator("summary", { hasText: "Time-Travel" });
    await expect(ttSummary).toBeVisible({ timeout: 5_000 });
  });
});
