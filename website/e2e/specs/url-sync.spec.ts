import { test, expect } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("URL Sync example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/url-sync");
    try {
      await page.waitForSelector("directive-url-sync", { state: "attached", timeout: 30_000 });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-url-sync", { state: "attached", timeout: 30_000 });
    }
    await page.waitForSelector("[data-url-sync-ready]", { timeout: 15_000 });
  });

  test("page loads with products", async ({ page }) => {
    // Wait for initial fetch (300ms mock delay)
    await expect(tid(page, "us-total-items")).toHaveText("50 items", { timeout: 5_000 });

    // 10 product cards on page 1
    const cards = tid(page, "us-product-list").locator(".us-product-card");
    await expect(cards).toHaveCount(10);

    // All category is active
    await expect(tid(page, "us-category-all")).toHaveClass(/active/);

    // Next page button enabled (5 pages total)
    await expect(tid(page, "us-page-next")).toBeEnabled();
  });

  test("search filters products", async ({ page }) => {
    await expect(tid(page, "us-total-items")).toHaveText("50 items", { timeout: 5_000 });

    // Search for "keyboard"
    await tid(page, "us-search").fill("keyboard");
    await page.waitForTimeout(500);

    // Should find "Mechanical Keyboard"
    await expect(tid(page, "us-total-items")).not.toHaveText("50 items", { timeout: 5_000 });
    await expect(tid(page, "us-product-list")).toContainText("Keyboard");
  });

  test("category filter works", async ({ page }) => {
    await expect(tid(page, "us-total-items")).toHaveText("50 items", { timeout: 5_000 });

    // Click electronics
    await tid(page, "us-category-electronics").click();
    await page.waitForTimeout(500);

    // 13 electronics products
    await expect(tid(page, "us-total-items")).toHaveText("13 items", { timeout: 5_000 });
    await expect(tid(page, "us-category-electronics")).toHaveClass(/active/);
    await expect(tid(page, "us-category-all")).not.toHaveClass(/active/);
  });

  test("sort by price ascending", async ({ page }) => {
    await expect(tid(page, "us-total-items")).toHaveText("50 items", { timeout: 5_000 });

    // Sort by price low to high
    await tid(page, "us-sort-select").selectOption("price-asc");
    await page.waitForTimeout(500);

    // First product card should have cheapest price ($9.99)
    const firstPrice = tid(page, "us-product-list").locator(".us-product-price").first();
    await expect(firstPrice).toHaveText("$9.99", { timeout: 5_000 });
  });

  test("pagination works", async ({ page }) => {
    await expect(tid(page, "us-total-items")).toHaveText("50 items", { timeout: 5_000 });

    // Click next page
    await tid(page, "us-page-next").click();
    await page.waitForTimeout(500);

    // Still 10 cards, prev enabled
    const cards = tid(page, "us-product-list").locator(".us-product-card");
    await expect(cards).toHaveCount(10, { timeout: 5_000 });
    await expect(tid(page, "us-page-prev")).toBeEnabled();
  });

  test("search resets to page 1", async ({ page }) => {
    await expect(tid(page, "us-total-items")).toHaveText("50 items", { timeout: 5_000 });

    // Go to page 2
    await tid(page, "us-page-next").click();
    await page.waitForTimeout(500);
    await expect(tid(page, "us-page-prev")).toBeEnabled();

    // Search — should reset to page 1
    await tid(page, "us-search").fill("cable");
    await page.waitForTimeout(500);

    // Prev should be disabled (page 1)
    await expect(tid(page, "us-page-prev")).toBeDisabled({ timeout: 5_000 });
  });

  test("empty search shows no results", async ({ page }) => {
    await expect(tid(page, "us-total-items")).toHaveText("50 items", { timeout: 5_000 });

    await tid(page, "us-search").fill("zzzznonexistent");
    await page.waitForTimeout(500);

    await expect(tid(page, "us-total-items")).toHaveText("0 items", { timeout: 5_000 });
    await expect(tid(page, "us-product-list")).toContainText("No products found", { timeout: 5_000 });
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
