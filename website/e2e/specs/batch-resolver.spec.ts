import { expect, test } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("Batch Resolver example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/batch-resolver");
    try {
      await page.waitForSelector("directive-batch-resolver", {
        state: "attached",
        timeout: 30_000,
      });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-batch-resolver", {
        state: "attached",
        timeout: 30_000,
      });
    }
    await page.waitForSelector("[data-batch-resolver-ready]", {
      timeout: 15_000,
    });
  });

  test("page loads and UI renders", async ({ page }) => {
    await expect(tid(page, "bl-load-all")).toBeVisible();
    await expect(tid(page, "bl-load-20")).toBeVisible();
    await expect(tid(page, "bl-timeline")).toBeVisible();
  });

  test("load individual user increments batch count", async ({ page }) => {
    await tid(page, "bl-load-1").click();
    await page.waitForTimeout(1500);

    await expect(tid(page, "bl-batch-count")).not.toHaveText("0", {
      timeout: 5_000,
    });
  });

  test("load all 5 creates single batch", async ({ page }) => {
    await tid(page, "bl-load-all").click();
    await page.waitForTimeout(2000);

    const batchCount = await tid(page, "bl-batch-count").textContent();
    // Should be 1 batch (not 5 individual loads)
    expect(Number(batchCount)).toBe(1);
  });

  test("load 20 splits into multiple batches", async ({ page }) => {
    await tid(page, "bl-load-20").click();
    await page.waitForTimeout(3000);

    const batchCount = await tid(page, "bl-batch-count").textContent();
    // Should be 2+ batches (20 / maxBatchSize)
    expect(Number(batchCount)).toBeGreaterThan(1);
  });

  test("user count increases after loading", async ({ page }) => {
    await tid(page, "bl-load-all").click();
    await page.waitForTimeout(2000);

    const userCount = await tid(page, "bl-user-count").textContent();
    expect(Number(userCount)).toBeGreaterThan(0);
  });

  test("per-item failure shows partial success", async ({ page }) => {
    // Set fail item to user 3
    await page.selectOption("[data-testid='bl-fail-item']", "3");

    await tid(page, "bl-load-all").click();
    await page.waitForTimeout(2000);

    // Some users loaded, error count > 0
    const userCount = await tid(page, "bl-user-count").textContent();
    expect(Number(userCount)).toBeGreaterThan(0);

    // Timeline should mention failure
    const timeline = tid(page, "bl-timeline");
    await expect(timeline.locator(".bl-timeline-entry.error")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("schema error injection shows validation error", async ({ page }) => {
    await tid(page, "bl-schema-error").click();
    await page.waitForTimeout(1000);

    await expect(tid(page, "bl-validation-errors")).not.toHaveText("0", {
      timeout: 5_000,
    });
  });

  test("reset clears all state", async ({ page }) => {
    await tid(page, "bl-load-all").click();
    await page.waitForTimeout(2000);

    await tid(page, "bl-reset").click();
    await page.waitForTimeout(500);

    await expect(tid(page, "bl-user-count")).toHaveText("0");
    await expect(tid(page, "bl-batch-count")).toHaveText("0");
  });
});
