import { test, expect } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

/**
 * Helper: set a value on an input element via page.evaluate to bypass
 * Playwright's typing delay.
 */
async function setInput(page: import("@playwright/test").Page, testid: string, value: string) {
  await page.evaluate(({ tid: t, val }) => {
    const input = document.querySelector(`[data-testid="${t}"]`) as HTMLInputElement;
    input.value = val;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, { tid: testid, val: value });
}

async function setSlider(page: import("@playwright/test").Page, testid: string, value: string) {
  await page.evaluate(({ tid: t, val }) => {
    const input = document.querySelector(`[data-testid="${t}"]`) as HTMLInputElement;
    input.value = val;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, { tid: testid, val: value });
}

test.describe("Dynamic Modules example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/dynamic-modules");
    try {
      await page.waitForSelector("directive-dynamic-modules", { state: "attached", timeout: 30_000 });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-dynamic-modules", { state: "attached", timeout: 30_000 });
    }
    await page.waitForSelector("[data-dynamic-modules-ready]", { timeout: 15_000 });
  });

  test("page loads with empty dashboard", async ({ page }) => {
    await expect(tid(page, "dm-widgets-area")).toContainText("Load a module to get started");
    await expect(tid(page, "dm-status-badge")).toContainText("0 / 3");

    // All load buttons enabled
    await expect(tid(page, "dm-load-counter")).toBeEnabled();
    await expect(tid(page, "dm-load-weather")).toBeEnabled();
    await expect(tid(page, "dm-load-dice")).toBeEnabled();
  });

  test("load counter module", async ({ page }) => {
    await tid(page, "dm-load-counter").click();

    await expect(tid(page, "dm-widget-counter")).toBeVisible({ timeout: 3_000 });
    await expect(tid(page, "dm-status-badge")).toContainText("1 / 3");
    await expect(tid(page, "dm-load-counter")).toBeDisabled();
  });

  test("counter increment and decrement work", async ({ page }) => {
    await tid(page, "dm-load-counter").click();
    await expect(tid(page, "dm-widget-counter")).toBeVisible({ timeout: 3_000 });

    await tid(page, "dm-counter-increment").click();
    await expect(tid(page, "dm-counter-value")).toContainText("1", { timeout: 1_000 });

    await tid(page, "dm-counter-increment").click();
    await expect(tid(page, "dm-counter-value")).toContainText("2", { timeout: 1_000 });

    await tid(page, "dm-counter-decrement").click();
    await expect(tid(page, "dm-counter-value")).toContainText("1", { timeout: 1_000 });
  });

  test("counter overflow constraint resets", async ({ page }) => {
    await tid(page, "dm-load-counter").click();
    await expect(tid(page, "dm-widget-counter")).toBeVisible({ timeout: 3_000 });

    // Set step to 10
    await setSlider(page, "dm-counter-step", "10");

    // Click + 10 times to reach 100
    for (let i = 0; i < 10; i++) {
      await tid(page, "dm-counter-increment").click();
    }

    // Constraint should reset count to 0
    await expect(tid(page, "dm-counter-value")).toContainText("0", { timeout: 5_000 });
  });

  test("load weather module", async ({ page }) => {
    await tid(page, "dm-load-weather").click();

    await expect(tid(page, "dm-widget-weather")).toBeVisible({ timeout: 3_000 });
    await expect(tid(page, "dm-status-badge")).toContainText("1 / 3");
  });

  test("weather fetches on city input", async ({ page }) => {
    await tid(page, "dm-load-weather").click();
    await expect(tid(page, "dm-widget-weather")).toBeVisible({ timeout: 3_000 });

    await setInput(page, "dm-weather-city", "NYC");

    // Wait for mock fetch (800ms delay) + rendering
    await expect(tid(page, "dm-weather-summary")).toBeVisible({ timeout: 5_000 });
    const summary = await tid(page, "dm-weather-summary").textContent();
    expect(summary).toContain("°F");
  });

  test("load dice module", async ({ page }) => {
    await tid(page, "dm-load-dice").click();

    await expect(tid(page, "dm-widget-dice")).toBeVisible({ timeout: 3_000 });
    await expect(tid(page, "dm-status-badge")).toContainText("1 / 3");
  });

  test("dice roll updates values", async ({ page }) => {
    await tid(page, "dm-load-dice").click();
    await expect(tid(page, "dm-widget-dice")).toBeVisible({ timeout: 3_000 });

    // Initial total is 2 (1+1)
    await expect(tid(page, "dm-dice-total")).toContainText("Total: 2", { timeout: 1_000 });

    // Roll multiple times to ensure at least one change
    for (let i = 0; i < 5; i++) {
      await tid(page, "dm-dice-roll").click();
    }

    // Roll count should be 5
    const diceWidget = tid(page, "dm-widget-dice");
    await expect(diceWidget).toContainText("Rolls: 5", { timeout: 1_000 });
  });

  test("load button disabled after loading", async ({ page }) => {
    await tid(page, "dm-load-counter").click();
    await tid(page, "dm-load-weather").click();
    await tid(page, "dm-load-dice").click();

    await expect(tid(page, "dm-load-counter")).toBeDisabled();
    await expect(tid(page, "dm-load-weather")).toBeDisabled();
    await expect(tid(page, "dm-load-dice")).toBeDisabled();
    await expect(tid(page, "dm-status-badge")).toContainText("3 / 3");
  });

  test("inspector shows namespaced facts", async ({ page }) => {
    await tid(page, "dm-load-counter").click();
    await expect(tid(page, "dm-widget-counter")).toBeVisible({ timeout: 3_000 });

    await expect(tid(page, "dm-inspector")).toContainText("counter.count", { timeout: 2_000 });
  });

  test("reset demo clears all modules", async ({ page }) => {
    // Load all 3
    await tid(page, "dm-load-counter").click();
    await tid(page, "dm-load-weather").click();
    await tid(page, "dm-load-dice").click();

    await expect(tid(page, "dm-status-badge")).toContainText("3 / 3", { timeout: 3_000 });

    // Reset
    await tid(page, "dm-reset-btn").click();

    // Should be back to empty
    await expect(tid(page, "dm-widgets-area")).toContainText("Load a module to get started", { timeout: 2_000 });
    await expect(tid(page, "dm-status-badge")).toContainText("0 / 3");
    await expect(tid(page, "dm-load-counter")).toBeEnabled();
    await expect(tid(page, "dm-load-weather")).toBeEnabled();
    await expect(tid(page, "dm-load-dice")).toBeEnabled();
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
