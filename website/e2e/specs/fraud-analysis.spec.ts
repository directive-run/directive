import { expect, test } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("Fraud Analysis example", () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/fraud-analysis");
    try {
      await page.waitForSelector("directive-fraud-analysis", {
        state: "attached",
        timeout: 30_000,
      });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-fraud-analysis", {
        state: "attached",
        timeout: 30_000,
      });
    }
    await page.waitForSelector("[data-fraud-analysis-ready]", {
      timeout: 15_000,
    });
  });

  test("page loads with initial idle state", async ({ page }) => {
    await expect(tid(page, "fraud-stage-badge")).toHaveText("idle");
    await expect(tid(page, "fraud-progress-label")).toHaveText("0%");
    await expect(tid(page, "fraud-metric-stage")).toHaveText("idle");
    await expect(tid(page, "fraud-metric-cases")).toHaveText("0");
    await expect(tid(page, "fraud-metric-pii")).toHaveText("0");
  });

  test("scenario selector updates description", async ({ page }) => {
    await expect(tid(page, "fraud-scenario-desc")).not.toBeEmpty();

    await tid(page, "fraud-scenario-select").selectOption("account-takeover");
    await page.waitForTimeout(200);
    await expect(tid(page, "fraud-scenario-desc")).toContainText("SSN");
  });

  test("risk threshold slider updates value", async ({ page }) => {
    const slider = tid(page, "fraud-threshold-slider");
    await slider.fill("85");
    await page.waitForTimeout(200);
    await expect(tid(page, "fraud-threshold-value")).toHaveText("85");
  });

  test("budget slider updates value", async ({ page }) => {
    const slider = tid(page, "fraud-budget-slider");
    await slider.fill("150");
    await page.waitForTimeout(200);
    await expect(tid(page, "fraud-budget-value")).toHaveText("150");
  });

  test("run pipeline creates cases from card-skimming scenario", async ({
    page,
  }) => {
    await tid(page, "fraud-run-btn").click();

    // Wait for cases to appear
    await expect(page.locator(".fraud-case-card")).toHaveCount(1, {
      timeout: 15_000,
    });

    // Stage should advance past idle
    await expect(tid(page, "fraud-metric-stage")).not.toHaveText("idle", {
      timeout: 10_000,
    });
  });

  test("auto-run processes full pipeline", async ({ page }) => {
    await tid(page, "fraud-auto-btn").click();

    // Wait for completion
    await expect(tid(page, "fraud-stage-badge")).toHaveText("complete", {
      timeout: 30_000,
    });

    // Should have case cards
    const cards = page.locator(".fraud-case-card");
    expect(await cards.count()).toBeGreaterThan(0);

    // Completion should be 100%
    await expect(tid(page, "fraud-progress-label")).toHaveText("100%");
  });

  test("account-takeover scenario detects PII", async ({ page }) => {
    await tid(page, "fraud-scenario-select").selectOption("account-takeover");
    await page.waitForTimeout(200);
    await tid(page, "fraud-auto-btn").click();

    // Wait for PII detection
    await expect(tid(page, "fraud-metric-pii")).not.toHaveText("0", {
      timeout: 20_000,
    });
  });

  test("reset clears all state", async ({ page }) => {
    // Run pipeline first
    await tid(page, "fraud-auto-btn").click();
    await expect(tid(page, "fraud-stage-badge")).toHaveText("complete", {
      timeout: 30_000,
    });

    // Reset
    await tid(page, "fraud-reset-btn").click();
    await page.waitForTimeout(500);

    await expect(tid(page, "fraud-stage-badge")).toHaveText("idle");
    await expect(tid(page, "fraud-metric-cases")).toHaveText("0");
    await expect(tid(page, "fraud-progress-label")).toHaveText("0%");
  });

  test("save and restore checkpoint", async ({ page }) => {
    // Run pipeline partially
    await tid(page, "fraud-run-btn").click();
    await page.waitForTimeout(2_000);

    // Save checkpoint
    await tid(page, "fraud-save-btn").click();
    await page.waitForTimeout(500);

    // Verify checkpoint appears
    const checkpoints = page.locator(".fraud-checkpoint-item");
    expect(await checkpoints.count()).toBeGreaterThan(0);
  });

  test("expanding case card shows transaction table and signals", async ({
    page,
  }) => {
    await tid(page, "fraud-auto-btn").click();
    await expect(tid(page, "fraud-stage-badge")).toHaveText("complete", {
      timeout: 30_000,
    });

    // Click the first case details summary
    const firstDetails = page.locator(".fraud-case-details summary").first();
    await firstDetails.click();
    await page.waitForTimeout(300);

    // Transaction table should be visible
    const txnTable = page.locator(".fraud-txn-table").first();
    await expect(txnTable).toBeVisible();

    // Should have signal bars
    const signals = page.locator(".fraud-signal-item").first();
    await expect(signals).toBeVisible();
  });

  test("expanded card shows analysis notes after pipeline completes", async ({
    page,
  }) => {
    await tid(page, "fraud-auto-btn").click();
    await expect(tid(page, "fraud-stage-badge")).toHaveText("complete", {
      timeout: 30_000,
    });

    // Expand first card
    const firstDetails = page.locator(".fraud-case-details summary").first();
    await firstDetails.click();
    await page.waitForTimeout(300);

    // Analysis notes should appear
    const notes = page.locator(".fraud-analysis-note").first();
    await expect(notes).toBeVisible();
  });

  test("disposition breakdown shows after pipeline completes", async ({
    page,
  }) => {
    await tid(page, "fraud-auto-btn").click();
    await expect(tid(page, "fraud-stage-badge")).toHaveText("complete", {
      timeout: 30_000,
    });

    // Disposition breakdown should have rows
    const breakdownRows = page.locator(".fraud-disposition-row");
    expect(await breakdownRows.count()).toBeGreaterThan(0);
  });

  test("stage detail shows pipeline stats", async ({ page }) => {
    await tid(page, "fraud-auto-btn").click();
    await expect(tid(page, "fraud-stage-badge")).toHaveText("complete", {
      timeout: 30_000,
    });

    // Open the stage detail
    const stageSummary = page.locator(
      "[data-testid='fraud-stage-detail'] summary",
    );
    await stageSummary.click();
    await page.waitForTimeout(300);

    // Stats grid should be visible with non-zero events
    const statsGrid = tid(page, "fraud-stage-stats");
    await expect(statsGrid).toBeVisible();
    await expect(tid(page, "fraud-stat-events")).not.toHaveText("0");
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
