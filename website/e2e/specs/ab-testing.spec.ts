import { expect, test } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("A/B Testing example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/ab-testing");
    try {
      await page.waitForSelector("directive-ab-testing", {
        state: "attached",
        timeout: 30_000,
      });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-ab-testing", {
        state: "attached",
        timeout: 30_000,
      });
    }
    await page.waitForSelector("[data-ab-testing-ready]", { timeout: 15_000 });
  });

  test("page loads with experiments", async ({ page }) => {
    await expect(tid(page, "ab-experiment-count")).toHaveText("2", {
      timeout: 5_000,
    });

    // Two experiment cards should be visible
    const experiments = tid(page, "ab-experiments").locator(".experiment");
    await expect(experiments).toHaveCount(2, { timeout: 5_000 });
  });

  test("experiments show variant assignments", async ({ page }) => {
    // Assignments happen automatically via constraint chain
    await expect(tid(page, "ab-assigned-count")).toHaveText("2", {
      timeout: 5_000,
    });

    // Each experiment card should show "Assigned:" with a variant ID (not "–")
    const experiments = tid(page, "ab-experiments").locator(".experiment");
    const firstMeta = experiments.first().locator(".experiment-meta");
    await expect(firstMeta).not.toContainText("Assigned: –", {
      timeout: 5_000,
    });
  });

  test("exposure count matches assignments", async ({ page }) => {
    // Both should be tracked after constraint chain settles
    await expect(tid(page, "ab-assigned-count")).toHaveText("2", {
      timeout: 5_000,
    });
    await expect(tid(page, "ab-exposed-count")).toHaveText("2", {
      timeout: 5_000,
    });
  });

  test("pause button toggles to resume", async ({ page }) => {
    await expect(tid(page, "ab-btn-pause")).toHaveText("Pause All", {
      timeout: 5_000,
    });

    await tid(page, "ab-btn-pause").click();

    await expect(tid(page, "ab-btn-pause")).toHaveText("Resume All", {
      timeout: 5_000,
    });
  });

  test("resume re-enables constraints", async ({ page }) => {
    // Pause
    await tid(page, "ab-btn-pause").click();
    await expect(tid(page, "ab-btn-pause")).toHaveText("Resume All", {
      timeout: 5_000,
    });

    // Resume
    await tid(page, "ab-btn-pause").click();
    await expect(tid(page, "ab-btn-pause")).toHaveText("Pause All", {
      timeout: 5_000,
    });

    // Experiments should still be assigned
    await expect(tid(page, "ab-assigned-count")).toHaveText("2", {
      timeout: 5_000,
    });
  });

  test("reset clears assignments and re-assigns", async ({ page }) => {
    // Wait for initial assignments
    await expect(tid(page, "ab-assigned-count")).toHaveText("2", {
      timeout: 5_000,
    });

    // Reset
    await tid(page, "ab-btn-reset").click();

    // After reset, constraint chain should re-assign automatically
    await expect(tid(page, "ab-assigned-count")).toHaveText("2", {
      timeout: 5_000,
    });
    await expect(tid(page, "ab-exposed-count")).toHaveText("2", {
      timeout: 5_000,
    });
  });

  test("source code visible below example", async ({ page }) => {
    const sourceSection = page.locator("text=Source code");
    await expect(sourceSection).toBeVisible();
  });
});
