import { test, expect } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("Goal Heist example", () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/goal-heist");
    try {
      await page.waitForSelector("directive-goal-heist", { state: "attached", timeout: 30_000 });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-goal-heist", { state: "attached", timeout: 30_000 });
    }
    await page.waitForSelector("[data-goal-heist-ready]", { timeout: 15_000 });
  });

  test("page loads with initial idle state", async ({ page }) => {
    await expect(tid(page, "heist-title")).toHaveText("The Directive Job");
    await expect(tid(page, "heist-satisfaction-label")).toHaveText("0%");
    await expect(tid(page, "heist-stat-step")).toHaveText("0");
    await expect(tid(page, "heist-stat-tokens")).toHaveText("0");
  });

  test("strategy selector updates badge", async ({ page }) => {
    const select = tid(page, "heist-strategy-select");
    await select.selectOption("highestImpact");
    await page.waitForTimeout(200);
    await expect(tid(page, "heist-strategy-badge")).toHaveText("highestImpact");
  });

  test("run heist completes successfully in mock mode", async ({ page }) => {
    await tid(page, "heist-run-btn").click();

    // Wait for completion — mock agents should finish within 30s
    await expect(tid(page, "heist-satisfaction-label")).toHaveText("100%", { timeout: 30_000 });
  });

  test("reset clears all state", async ({ page }) => {
    // Run first
    await tid(page, "heist-run-btn").click();
    await expect(tid(page, "heist-satisfaction-label")).toHaveText("100%", { timeout: 30_000 });

    // Reset
    await tid(page, "heist-reset-btn").click();
    await page.waitForTimeout(500);

    await expect(tid(page, "heist-satisfaction-label")).toHaveText("0%");
    await expect(tid(page, "heist-stat-step")).toHaveText("0");
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
