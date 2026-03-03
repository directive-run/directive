import { expect, test } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

/**
 * Helper: set a value on an input element via page.evaluate to bypass
 * Playwright's typing delay (which would be too slow for sliders/inputs).
 */
async function setInput(
  page: import("@playwright/test").Page,
  testid: string,
  value: string,
) {
  await page.evaluate(
    ({ tid: t, val }) => {
      const input = document.querySelector(
        `[data-testid="${t}"]`,
      ) as HTMLInputElement;
      input.value = val;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { tid: testid, val: value },
  );
}

async function setSlider(
  page: import("@playwright/test").Page,
  testid: string,
  value: string,
) {
  await page.evaluate(
    ({ tid: t, val }) => {
      const input = document.querySelector(
        `[data-testid="${t}"]`,
      ) as HTMLInputElement;
      input.value = val;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { tid: testid, val: value },
  );
}

test.describe("Dashboard Loader example", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/dashboard-loader");
    await page.waitForSelector("directive-dashboard-loader", {
      state: "attached",
      timeout: 30_000,
    });
    await page.waitForSelector("[data-dashboard-loader-ready]", {
      timeout: 15_000,
    });
  });

  test("page loads and UI renders", async ({ page }) => {
    await expect(tid(page, "dashboard-loader-user-input")).toBeVisible();
    await expect(tid(page, "dashboard-loader-start-btn")).toBeVisible();
    await expect(tid(page, "dashboard-loader-profile-card")).toBeVisible();
    await expect(tid(page, "dashboard-loader-prefs-card")).toBeVisible();
    await expect(tid(page, "dashboard-loader-perms-card")).toBeVisible();
  });

  test("start button disabled when input empty", async ({ page }) => {
    await setInput(page, "dashboard-loader-user-input", "");
    // Wait for render to process the empty value
    await page.waitForTimeout(100);
    await expect(tid(page, "dashboard-loader-start-btn")).toBeDisabled();
  });

  test("loads all 3 resources on start", async ({ page }) => {
    // Set fast delays for all resources
    await setSlider(page, "dashboard-loader-profile-delay", "500");
    await setSlider(page, "dashboard-loader-prefs-delay", "500");
    await setSlider(page, "dashboard-loader-perms-delay", "500");

    await setInput(page, "dashboard-loader-user-input", "testuser");
    await tid(page, "dashboard-loader-start-btn").click();

    // Wait for all 3 to succeed
    await expect(tid(page, "dashboard-loader-profile-status")).toHaveText(
      "success",
      { timeout: 10_000 },
    );
    await expect(tid(page, "dashboard-loader-prefs-status")).toHaveText(
      "success",
      { timeout: 10_000 },
    );
    await expect(tid(page, "dashboard-loader-perms-status")).toHaveText(
      "success",
      { timeout: 10_000 },
    );
  });

  test("shows loading state during fetch", async ({ page }) => {
    // Set high delay so we can catch loading state
    await setSlider(page, "dashboard-loader-profile-delay", "3000");
    await setSlider(page, "dashboard-loader-prefs-delay", "3000");
    await setSlider(page, "dashboard-loader-perms-delay", "3000");

    await setInput(page, "dashboard-loader-user-input", "testuser");
    await tid(page, "dashboard-loader-start-btn").click();

    // Should see loading badges
    await expect(tid(page, "dashboard-loader-profile-status")).toHaveText(
      "loading",
      { timeout: 5_000 },
    );
    await expect(tid(page, "dashboard-loader-prefs-status")).toHaveText(
      "loading",
      { timeout: 5_000 },
    );
    await expect(tid(page, "dashboard-loader-perms-status")).toHaveText(
      "loading",
      { timeout: 5_000 },
    );
  });

  test("shows error state when resource fails", async ({ page }) => {
    // Fast delay, 100% fail on profile
    await setSlider(page, "dashboard-loader-profile-delay", "500");
    await setSlider(page, "dashboard-loader-profile-failrate", "100");
    await setSlider(page, "dashboard-loader-prefs-delay", "500");
    await setSlider(page, "dashboard-loader-perms-delay", "500");

    await setInput(page, "dashboard-loader-user-input", "testuser");
    await tid(page, "dashboard-loader-start-btn").click();

    // Profile should eventually error (after retries)
    await expect(tid(page, "dashboard-loader-profile-status")).toHaveText(
      "error",
      { timeout: 30_000 },
    );
    // Retry button should appear
    await expect(tid(page, "dashboard-loader-profile-retry")).toBeVisible();
  });

  test("retry button re-fetches failed resource", async ({ page }) => {
    // 100% fail rate on profile, fast delays
    await setSlider(page, "dashboard-loader-profile-delay", "500");
    await setSlider(page, "dashboard-loader-profile-failrate", "100");
    await setSlider(page, "dashboard-loader-prefs-delay", "500");
    await setSlider(page, "dashboard-loader-perms-delay", "500");

    await setInput(page, "dashboard-loader-user-input", "testuser");
    await tid(page, "dashboard-loader-start-btn").click();

    // Wait for profile to fail
    await expect(tid(page, "dashboard-loader-profile-status")).toHaveText(
      "error",
      { timeout: 30_000 },
    );

    // Set fail rate to 0 so retry succeeds
    await setSlider(page, "dashboard-loader-profile-failrate", "0");

    // Click retry
    await tid(page, "dashboard-loader-profile-retry").click();

    // Should recover
    await expect(tid(page, "dashboard-loader-profile-status")).toHaveText(
      "success",
      { timeout: 15_000 },
    );
  });

  test("reload all resets and re-fetches", async ({ page }) => {
    // Fast delays, all succeed
    await setSlider(page, "dashboard-loader-profile-delay", "500");
    await setSlider(page, "dashboard-loader-prefs-delay", "500");
    await setSlider(page, "dashboard-loader-perms-delay", "500");

    await setInput(page, "dashboard-loader-user-input", "testuser");
    await tid(page, "dashboard-loader-start-btn").click();

    // Wait for all loaded
    await expect(tid(page, "dashboard-loader-profile-status")).toHaveText(
      "success",
      { timeout: 10_000 },
    );

    // Click reload
    await tid(page, "dashboard-loader-reload-btn").click();

    // Should see loading again
    await expect(tid(page, "dashboard-loader-profile-status")).toHaveText(
      "loading",
      { timeout: 5_000 },
    );

    // Then back to success
    await expect(tid(page, "dashboard-loader-profile-status")).toHaveText(
      "success",
      { timeout: 10_000 },
    );
  });

  test("combined status updates correctly", async ({ page }) => {
    await setSlider(page, "dashboard-loader-profile-delay", "500");
    await setSlider(page, "dashboard-loader-prefs-delay", "500");
    await setSlider(page, "dashboard-loader-perms-delay", "500");

    // Initially "Not started" (before any load is triggered)
    await expect(tid(page, "dashboard-loader-combined-status")).toContainText(
      "Not started",
      { timeout: 5_000 },
    );

    await setInput(page, "dashboard-loader-user-input", "testuser");
    await tid(page, "dashboard-loader-start-btn").click();

    // Eventually "All loaded"
    await expect(tid(page, "dashboard-loader-combined-status")).toHaveText(
      "All loaded",
      { timeout: 10_000 },
    );
  });

  test("delay sliders affect fetch time", async ({ page }) => {
    // Profile: fast (500ms), Perms: slow (3000ms)
    await setSlider(page, "dashboard-loader-profile-delay", "500");
    await setSlider(page, "dashboard-loader-prefs-delay", "500");
    await setSlider(page, "dashboard-loader-perms-delay", "3000");

    await setInput(page, "dashboard-loader-user-input", "testuser");
    await tid(page, "dashboard-loader-start-btn").click();

    // Profile should complete first
    await expect(tid(page, "dashboard-loader-profile-status")).toHaveText(
      "success",
      { timeout: 5_000 },
    );
    // Permissions should still be loading
    await expect(tid(page, "dashboard-loader-perms-status")).toHaveText(
      "loading",
    );
  });

  test("timeline log records events", async ({ page }) => {
    await setSlider(page, "dashboard-loader-profile-delay", "500");
    await setSlider(page, "dashboard-loader-prefs-delay", "500");
    await setSlider(page, "dashboard-loader-perms-delay", "500");

    await setInput(page, "dashboard-loader-user-input", "testuser");
    await tid(page, "dashboard-loader-start-btn").click();

    // Wait for some loading to happen
    await expect(tid(page, "dashboard-loader-profile-status")).toHaveText(
      "success",
      { timeout: 10_000 },
    );

    // Timeline should have entries
    const entries = tid(page, "dashboard-loader-timeline").locator(
      ".dl-timeline-entry",
    );
    await expect(entries.first()).toBeVisible();

    const count = await entries.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
