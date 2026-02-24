import { test, expect } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("AI Checkpoint example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/ai-checkpoint");
    try {
      await page.waitForSelector("directive-ai-checkpoint", { state: "attached", timeout: 30_000 });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-ai-checkpoint", { state: "attached", timeout: 30_000 });
    }
    await page.waitForSelector("[data-ai-checkpoint-ready]", { timeout: 15_000 });
  });

  test("page loads and UI renders", async ({ page }) => {
    await expect(tid(page, "cp-advance")).toBeVisible();
    await expect(tid(page, "cp-auto-run")).toBeVisible();
    await expect(tid(page, "cp-save-ckpt")).toBeVisible();
    await expect(tid(page, "cp-timeline")).toBeVisible();
    await expect(tid(page, "cp-current-stage")).toHaveText("idle");
  });

  test("advance stage moves pipeline forward", async ({ page }) => {
    await tid(page, "cp-advance").click();
    await page.waitForTimeout(1500);

    // Should have moved past idle
    const stage = await tid(page, "cp-current-stage").textContent();
    expect(stage).not.toBe("idle");
  });

  test("auto-run completes all 4 stages", async ({ page }) => {
    await tid(page, "cp-auto-run").click();

    // Should reach done
    await expect(tid(page, "cp-current-stage")).toHaveText("done", { timeout: 15_000 });
    await expect(tid(page, "cp-completion")).toHaveText("100%");
  });

  test("total tokens accumulate", async ({ page }) => {
    await tid(page, "cp-auto-run").click();
    await expect(tid(page, "cp-current-stage")).toHaveText("done", { timeout: 15_000 });

    const tokens = await tid(page, "cp-total-tokens").textContent();
    expect(Number(tokens)).toBeGreaterThan(0);
  });

  test("checkpoint saved at current stage", async ({ page }) => {
    await tid(page, "cp-advance").click();
    await page.waitForTimeout(1500);

    await tid(page, "cp-save-ckpt").click();
    await page.waitForTimeout(500);

    // Checkpoint list should have entry
    const list = tid(page, "cp-checkpoint-list");
    await expect(list.locator(".cp-checkpoint-entry")).toBeVisible({ timeout: 5_000 });
  });

  test("restore checkpoint reverts state", async ({ page }) => {
    // Run pipeline
    await tid(page, "cp-auto-run").click();
    await expect(tid(page, "cp-current-stage")).toHaveText("done", { timeout: 15_000 });

    // Save checkpoint
    await tid(page, "cp-save-ckpt").click();
    await page.waitForTimeout(500);

    // Reset
    await tid(page, "cp-reset").click();
    await page.waitForTimeout(500);
    await expect(tid(page, "cp-current-stage")).toHaveText("idle");

    // Restore
    const restoreBtn = tid(page, "cp-checkpoint-list").locator("button[data-restore]").first();
    await restoreBtn.click();
    await page.waitForTimeout(500);

    await expect(tid(page, "cp-current-stage")).toHaveText("done");
  });

  test("delete checkpoint removes from list", async ({ page }) => {
    await tid(page, "cp-save-ckpt").click();
    await page.waitForTimeout(500);

    const list = tid(page, "cp-checkpoint-list");
    await expect(list.locator(".cp-checkpoint-entry")).toBeVisible({ timeout: 5_000 });

    // Delete it
    const deleteBtn = list.locator("button[data-delete]").first();
    await deleteBtn.click();
    await page.waitForTimeout(500);

    await expect(list.locator(".cp-checkpoint-entry")).toHaveCount(0);
  });

  test("failure triggers retry", async ({ page }) => {
    await page.selectOption("[data-testid='cp-fail-stage']", "summarize");

    await tid(page, "cp-auto-run").click();
    await page.waitForTimeout(8000);

    // Retry count should be > 0
    const retries = await tid(page, "cp-retry-count").textContent();
    expect(Number(retries)).toBeGreaterThan(0);
  });

  test("max retries exhausted halts pipeline", async ({ page }) => {
    await page.selectOption("[data-testid='cp-fail-stage']", "extract");

    await tid(page, "cp-auto-run").click();

    // Should reach error state after retries
    await expect(tid(page, "cp-current-stage")).toHaveText("error", { timeout: 20_000 });
    await expect(tid(page, "cp-last-error")).not.toHaveText("\u2014");
  });

  test("completion percentage updates through pipeline", async ({ page }) => {
    await expect(tid(page, "cp-completion")).toHaveText("0%");

    await tid(page, "cp-auto-run").click();
    await expect(tid(page, "cp-current-stage")).toHaveText("done", { timeout: 15_000 });

    await expect(tid(page, "cp-completion")).toHaveText("100%");
  });

  test("reset clears all state", async ({ page }) => {
    await tid(page, "cp-auto-run").click();
    await expect(tid(page, "cp-current-stage")).toHaveText("done", { timeout: 15_000 });

    await tid(page, "cp-reset").click();
    await page.waitForTimeout(500);

    await expect(tid(page, "cp-current-stage")).toHaveText("idle");
    await expect(tid(page, "cp-total-tokens")).toHaveText("0");
    await expect(tid(page, "cp-retry-count")).toHaveText("0");
    await expect(tid(page, "cp-completion")).toHaveText("0%");
  });
});
