import { test, expect } from "@playwright/test";

/**
 * DevTools Console API E2E Tests
 *
 * Tests `window.__DIRECTIVE__` on the shopping-cart example,
 * which uses `devtoolsPlugin({ panel: true })`.
 */
test.describe("DevTools Console API", () => {
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

  test("window.__DIRECTIVE__ is defined", async ({ page }) => {
    const exists = await page.evaluate(() => {
      return typeof window.__DIRECTIVE__ === "object" && window.__DIRECTIVE__ !== null;
    });
    expect(exists).toBe(true);
  });

  test("getSystems() returns registered system names", async ({ page }) => {
    const systems = await page.evaluate(() => {
      return window.__DIRECTIVE__?.getSystems() ?? [];
    });
    expect(Array.isArray(systems)).toBe(true);
    expect(systems.length).toBeGreaterThan(0);
  });

  test("getSystem() returns a system instance", async ({ page }) => {
    const hasSystem = await page.evaluate(() => {
      const sys = window.__DIRECTIVE__?.getSystem();
      return sys !== null && sys !== undefined;
    });
    expect(hasSystem).toBe(true);
  });

  test("inspect() returns facts and constraint data", async ({ page }) => {
    const inspection = await page.evaluate(() => {
      const result = window.__DIRECTIVE__?.inspect();
      if (!result) return null;
      return {
        hasUnmet: Array.isArray(result.unmet),
        hasInflight: Array.isArray(result.inflight),
      };
    });
    expect(inspection).not.toBeNull();
    expect(inspection!.hasUnmet).toBe(true);
    expect(inspection!.hasInflight).toBe(true);
  });

  test("getEvents() returns an array", async ({ page }) => {
    const events = await page.evaluate(() => {
      return window.__DIRECTIVE__?.getEvents() ?? null;
    });
    expect(Array.isArray(events)).toBe(true);
  });

  test("exportSession() returns valid JSON string", async ({ page }) => {
    const json = await page.evaluate(() => {
      return window.__DIRECTIVE__?.exportSession() ?? null;
    });
    expect(json).not.toBeNull();
    expect(typeof json).toBe("string");

    const parsed = JSON.parse(json!);
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.events)).toBe(true);
  });

  test("importSession() accepts exported data", async ({ page }) => {
    const result = await page.evaluate(() => {
      const exported = window.__DIRECTIVE__?.exportSession();
      if (!exported) return false;
      return window.__DIRECTIVE__?.importSession(exported) ?? false;
    });
    expect(result).toBe(true);
  });

  test("clearEvents() empties the event buffer", async ({ page }) => {
    const result = await page.evaluate(() => {
      window.__DIRECTIVE__?.clearEvents();
      const events = window.__DIRECTIVE__?.getEvents();
      return events?.length ?? -1;
    });
    expect(result).toBe(0);
  });

  test("explain() returns null for non-existent requirement", async ({ page }) => {
    const result = await page.evaluate(() => {
      const val = window.__DIRECTIVE__?.explain("non-existent-id");

      return val === null ? "NULL" : val === undefined ? "UNDEFINED" : String(val);
    });
    expect(result).toBe("NULL");
  });
});
