import { test, expect } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

/**
 * Helper: set a value on a select element via page.evaluate.
 */
async function setSelect(page: import("@playwright/test").Page, testid: string, value: string) {
  await page.evaluate(({ tid: t, val }) => {
    const select = document.querySelector(`[data-testid="${t}"]`) as HTMLSelectElement;
    select.value = val;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, { tid: testid, val: value });
}

test.describe("Pagination example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/pagination");
    try {
      await page.waitForSelector("directive-pagination", { state: "attached", timeout: 30_000 });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-pagination", { state: "attached", timeout: 30_000 });
    }
    await page.waitForSelector("[data-pagination-ready]", { timeout: 15_000 });
  });

  test("page loads and renders initial items", async ({ page }) => {
    // filterChanged constraint fires on init (hash "" !== lastFilterHash ""),
    // loading the first page via RESET_AND_LOAD after 500ms mock API delay
    const itemList = tid(page, "pg-item-list");
    await expect(itemList.locator(".pg-item").first()).toBeVisible({ timeout: 10_000 });

    // totalLoaded should show a positive number
    const totalText = await tid(page, "pg-total-loaded").textContent();
    const total = parseInt(totalText || "0", 10);
    expect(total).toBeGreaterThan(0);

    // Loading spinner should not be visible after load completes
    await expect(tid(page, "pg-loading")).not.toHaveClass(/visible/, { timeout: 5_000 });
  });

  test("category filter changes results", async ({ page }) => {
    // Wait for initial load
    const itemList = tid(page, "pg-item-list");
    await expect(itemList.locator(".pg-item").first()).toBeVisible({ timeout: 10_000 });

    // Click Technology chip
    await page.locator("[data-category='technology']").click();

    // Wait for RESET_AND_LOAD (500ms mock API)
    await page.waitForTimeout(1000);

    // All visible items should have "technology" category badge
    const categories = await itemList.locator(".pg-item-category").allTextContents();
    expect(categories.length).toBeGreaterThan(0);
    for (const cat of categories) {
      expect(cat.toLowerCase()).toBe("technology");
    }

    // Click All chip — all categories return
    await tid(page, "pg-category-all").click();
    await page.waitForTimeout(1000);

    const allCategories = await itemList.locator(".pg-item-category").allTextContents();
    const uniqueCategories = [...new Set(allCategories.map((c) => c.toLowerCase()))];
    expect(uniqueCategories.length).toBeGreaterThan(1);
  });

  test("search filters items", async ({ page }) => {
    // Wait for initial load
    await expect(tid(page, "pg-item-list").locator(".pg-item").first()).toBeVisible({ timeout: 10_000 });

    // Use Playwright fill() which properly dispatches input events
    // 300ms debounce + 500ms mock API delay
    await tid(page, "pg-search").fill("rust");
    await page.waitForTimeout(2000);

    // Items should contain "Rust" in their titles
    const titles = await tid(page, "pg-item-list").locator(".pg-item-title").allTextContents();
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(title.toLowerCase()).toContain("rust");
    }
  });

  test("sort changes item order", async ({ page }) => {
    // Wait for initial load
    await expect(tid(page, "pg-item-list").locator(".pg-item").first()).toBeVisible({ timeout: 10_000 });

    // Capture initial first title
    const firstTitleBefore = await tid(page, "pg-item-list").locator(".pg-item-title").first().textContent();

    // Switch to "title" sort
    await setSelect(page, "pg-sort-select", "title");
    await page.waitForTimeout(1000);

    // Verify items reloaded — first title should differ (alphabetical vs newest)
    const firstTitleAfter = await tid(page, "pg-item-list").locator(".pg-item-title").first().textContent();
    expect(firstTitleAfter).not.toBe(firstTitleBefore);
  });

  test("empty state when no results match", async ({ page }) => {
    // Wait for initial load
    await expect(tid(page, "pg-item-list").locator(".pg-item").first()).toBeVisible({ timeout: 10_000 });

    // Use Playwright fill() — 300ms debounce + 500ms mock API
    await tid(page, "pg-search").fill("zzzzxyzzy");
    await page.waitForTimeout(2000);

    // End message should show "No items match your filters"
    const endMessage = page.locator("#pg-end-message");
    await expect(endMessage).toHaveClass(/visible/, { timeout: 5_000 });
    await expect(endMessage).toContainText("No items match");
  });

  test("category chip active state updates", async ({ page }) => {
    // Wait for initial load
    await expect(tid(page, "pg-item-list").locator(".pg-item").first()).toBeVisible({ timeout: 10_000 });

    // Initially "All" is active
    await expect(tid(page, "pg-category-all")).toHaveClass(/active/);

    // Click Science chip
    const scienceChip = page.locator("[data-category='science']");
    await scienceChip.click();
    await page.waitForTimeout(200);

    // Science chip should be active, All should not
    await expect(scienceChip).toHaveClass(/active/);
    await expect(tid(page, "pg-category-all")).not.toHaveClass(/active/);
  });

  test("inspector shows correct state", async ({ page }) => {
    // Wait for initial load to complete
    await expect(tid(page, "pg-item-list").locator(".pg-item").first()).toBeVisible({ timeout: 10_000 });
    await expect(tid(page, "pg-loading")).not.toHaveClass(/visible/, { timeout: 5_000 });

    // totalLoaded should be > 0
    const totalText = await tid(page, "pg-total-loaded").textContent();
    const total = parseInt(totalText || "0", 10);
    expect(total).toBeGreaterThan(0);

    // hasMore should show "true" (100 items total, 20 per page)
    const hasMoreEl = page.locator("#pg-fact-has-more");
    await expect(hasMoreEl).toContainText("true");
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
