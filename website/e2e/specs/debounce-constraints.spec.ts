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

test.describe("Debounce Constraints example", () => {
  // Dev server can be slow under parallel load
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/debounce-constraints");
    try {
      await page.waitForSelector("directive-debounce-constraints", { state: "attached", timeout: 30_000 });
    } catch {
      // Dev server sometimes needs a second attempt under parallel load
      await page.reload();
      await page.waitForSelector("directive-debounce-constraints", { state: "attached", timeout: 30_000 });
    }
    await page.waitForSelector("[data-debounce-constraints-ready]", { timeout: 15_000 });
  });

  test("page loads and renders search input", async ({ page }) => {
    await expect(tid(page, "dc-search-input")).toBeVisible();
    await expect(tid(page, "dc-clear-btn")).toBeVisible();
    await expect(tid(page, "dc-results-list")).toBeVisible();

    // No results initially
    await expect(tid(page, "dc-results-list")).toContainText("Type to search");
  });

  test("typing updates raw query display", async ({ page }) => {
    await setInput(page, "dc-search-input", "react");

    await expect(tid(page, "dc-raw-query")).toContainText("react", { timeout: 1_000 });
  });

  test("debounced query updates after delay", async ({ page }) => {
    // Set a specific debounce delay
    await setSlider(page, "dc-debounce-delay", "500");

    await setInput(page, "dc-search-input", "java");

    // Debounced query should eventually show "java"
    await expect(tid(page, "dc-debounced-query")).toContainText("java", { timeout: 3_000 });
  });

  test("debounce resets on new keystroke", async ({ page }) => {
    // Set long debounce so we can test reset
    await setSlider(page, "dc-debounce-delay", "1000");

    await setInput(page, "dc-search-input", "j");

    // Wait 500ms (half of debounce)
    await page.waitForTimeout(500);

    // Type another character — this resets the timer
    await setInput(page, "dc-search-input", "ja");

    // Wait another 500ms — still shouldn't have settled (timer was reset)
    await page.waitForTimeout(500);

    // Debounced query should still be empty (timer reset on second keystroke)
    await expect(tid(page, "dc-debounced-query")).toContainText('""', { timeout: 500 });
  });

  test("search results appear after debounce", async ({ page }) => {
    // Fast settings for this test
    await setSlider(page, "dc-debounce-delay", "200");
    await setSlider(page, "dc-api-delay", "200");

    await setInput(page, "dc-search-input", "react");

    // Results should appear after debounce + API delay
    await expect(tid(page, "dc-results-list")).toContainText("React", { timeout: 5_000 });
  });

  test("min chars threshold prevents search", async ({ page }) => {
    await setSlider(page, "dc-debounce-delay", "200");
    await setSlider(page, "dc-api-delay", "200");
    await setSlider(page, "dc-min-chars", "3");

    // Type only 2 chars — below threshold
    await setInput(page, "dc-search-input", "re");

    // Wait for debounce to settle
    await page.waitForTimeout(1_000);

    // No results should appear (below min chars)
    await expect(tid(page, "dc-results-list")).not.toContainText("React", { timeout: 1_000 });

    // Type 3 chars — meets threshold
    await setInput(page, "dc-search-input", "rea");

    // Results should now appear
    await expect(tid(page, "dc-results-list")).toContainText("React", { timeout: 5_000 });
  });

  test("keystroke counter tracks input", async ({ page }) => {
    await setInput(page, "dc-search-input", "h");
    await setInput(page, "dc-search-input", "he");
    await setInput(page, "dc-search-input", "hel");
    await setInput(page, "dc-search-input", "hell");
    await setInput(page, "dc-search-input", "hello");

    await expect(tid(page, "dc-stat-keystrokes")).toContainText("5", { timeout: 1_000 });
  });

  test("API calls saved counter", async ({ page }) => {
    // Fast debounce so the test resolves quickly
    await setSlider(page, "dc-debounce-delay", "200");
    await setSlider(page, "dc-api-delay", "200");

    // Type multiple characters rapidly
    await setInput(page, "dc-search-input", "j");
    await setInput(page, "dc-search-input", "ja");
    await setInput(page, "dc-search-input", "jav");
    await setInput(page, "dc-search-input", "java");

    // Wait for debounce + search to complete
    await expect(tid(page, "dc-results-list")).toContainText("Java", { timeout: 5_000 });

    // Saved calls should be > 0 (4 keystrokes but only 1 API call)
    await expect(tid(page, "dc-stat-saved")).not.toContainText("0 (0%)", { timeout: 2_000 });
  });

  test("progress bar visible during debounce", async ({ page }) => {
    // Long debounce so progress bar is clearly visible
    await setSlider(page, "dc-debounce-delay", "2000");

    await setInput(page, "dc-search-input", "a");

    // Progress bar should become visible
    await expect(tid(page, "dc-progress-bar")).not.toHaveClass(/hidden/, { timeout: 1_000 });
  });

  test("derivations update correctly", async ({ page }) => {
    await setSlider(page, "dc-debounce-delay", "200");
    await setSlider(page, "dc-api-delay", "200");

    // Initially
    await expect(tid(page, "dc-deriv-debouncing")).toContainText("false");
    await expect(tid(page, "dc-deriv-searching")).toContainText("false");
    await expect(tid(page, "dc-deriv-result-count")).toContainText("0");

    // Type something
    await setInput(page, "dc-search-input", "react");

    // Wait for results
    await expect(tid(page, "dc-deriv-result-count")).not.toContainText("0", { timeout: 5_000 });
  });

  test("clear resets search state", async ({ page }) => {
    await setSlider(page, "dc-debounce-delay", "200");
    await setSlider(page, "dc-api-delay", "200");

    // Type and wait for results
    await setInput(page, "dc-search-input", "react");
    await expect(tid(page, "dc-results-list")).toContainText("React", { timeout: 5_000 });

    // Click clear
    await tid(page, "dc-clear-btn").click();

    // Results should be gone
    await expect(tid(page, "dc-results-list")).toContainText("Type to search", { timeout: 1_000 });

    // Input should be empty
    await expect(tid(page, "dc-search-input")).toHaveValue("", { timeout: 1_000 });
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
