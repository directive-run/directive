import { expect, test } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("Feature Flags example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    // Clear persisted state before each test
    await page.goto("/docs/examples/feature-flags");
    await page.evaluate(() =>
      localStorage.removeItem("directive-feature-flags-example"),
    );
    await page.reload();
    try {
      await page.waitForSelector("directive-feature-flags", {
        state: "attached",
        timeout: 30_000,
      });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-feature-flags", {
        state: "attached",
        timeout: 30_000,
      });
    }
    await page.waitForSelector("[data-feature-flags-ready]", {
      timeout: 15_000,
    });
  });

  test("page loads with default flags", async ({ page }) => {
    // All 8 flags should be enabled by default
    await expect(tid(page, "ff-enabled-count")).toContainText("8/8", {
      timeout: 5_000,
    });

    // Preview panel should be visible
    await expect(tid(page, "ff-preview")).toBeVisible();
  });

  test("toggle flag updates preview", async ({ page }) => {
    await expect(tid(page, "ff-enabled-count")).toContainText("8/8", {
      timeout: 5_000,
    });

    // Uncheck the chat flag
    const chatToggle = tid(page, "ff-flag-chat").locator(
      "input[type='checkbox']",
    );
    await chatToggle.uncheck();

    // Enabled count should decrease
    await expect(tid(page, "ff-enabled-count")).toContainText("7/8", {
      timeout: 5_000,
    });
  });

  test("maintenance mode disables gated features", async ({ page }) => {
    await expect(tid(page, "ff-enabled-count")).toContainText("8/8", {
      timeout: 5_000,
    });

    // Enable maintenance mode
    const maintenanceToggle = tid(page, "ff-maintenance").locator(
      "input[type='checkbox']",
    );
    await maintenanceToggle.check();

    // Preview should show "Disabled (maintenance)" for gated features
    await expect(tid(page, "ff-preview")).toContainText(
      "Disabled (maintenance)",
      { timeout: 5_000 },
    );
  });

  test("onboarding toast auto-enables brand switcher", async ({ page }) => {
    await expect(tid(page, "ff-enabled-count")).toContainText("8/8", {
      timeout: 5_000,
    });

    // First disable onboarding toast so we can freely disable brand switcher
    const toastToggle = tid(page, "ff-flag-onboarding-toast").locator(
      "input[type='checkbox']",
    );
    await toastToggle.uncheck();
    await expect(tid(page, "ff-enabled-count")).toContainText("7/8", {
      timeout: 5_000,
    });

    // Now disable brand switcher (no constraint fires because toast is off)
    const brandToggle = tid(page, "ff-flag-brand-switcher").locator(
      "input[type='checkbox']",
    );
    await brandToggle.uncheck();
    await expect(tid(page, "ff-enabled-count")).toContainText("6/8", {
      timeout: 5_000,
    });

    // Re-enable onboarding toast — constraint should auto-enable brand switcher
    await toastToggle.check();

    // Constraint fires: both onboarding toast AND brand switcher should be on
    await expect(tid(page, "ff-enabled-count")).toContainText("8/8", {
      timeout: 5_000,
    });
  });

  test("enabled count updates correctly", async ({ page }) => {
    await expect(tid(page, "ff-enabled-count")).toContainText("8/8", {
      timeout: 5_000,
    });

    // Disable theme selector (not gated by maintenance, no constraint dependency)
    const themeToggle = tid(page, "ff-flag-theme-selector").locator(
      "input[type='checkbox']",
    );
    await themeToggle.uncheck();

    await expect(tid(page, "ff-enabled-count")).toContainText("7/8", {
      timeout: 5_000,
    });

    // Re-enable
    await themeToggle.check();

    await expect(tid(page, "ff-enabled-count")).toContainText("8/8", {
      timeout: 5_000,
    });
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
