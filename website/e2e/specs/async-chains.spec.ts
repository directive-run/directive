import { expect, test } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("Async Chains example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/async-chains");
    try {
      await page.waitForSelector("directive-async-chains", {
        state: "attached",
        timeout: 30_000,
      });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-async-chains", {
        state: "attached",
        timeout: 30_000,
      });
    }
    await page.waitForSelector("[data-async-chains-ready]", {
      timeout: 15_000,
    });
  });

  test("page loads and UI renders", async ({ page }) => {
    await expect(tid(page, "ac-start-btn")).toBeVisible();
    await expect(tid(page, "ac-reset-btn")).toBeVisible();
    await expect(tid(page, "ac-auth-status")).toBeVisible();
    await expect(tid(page, "ac-perms-status")).toBeVisible();
    await expect(tid(page, "ac-dash-status")).toBeVisible();
  });

  test("all steps start as idle", async ({ page }) => {
    await expect(tid(page, "ac-auth-status")).toHaveText("idle");
    await expect(tid(page, "ac-perms-status")).toHaveText("idle");
    await expect(tid(page, "ac-dash-status")).toHaveText("idle");
  });

  test("start chain triggers auth validation", async ({ page }) => {
    await tid(page, "ac-start-btn").click();

    // Auth should move to running or success
    await expect(tid(page, "ac-auth-status")).not.toHaveText("idle", {
      timeout: 5_000,
    });
  });

  test("full chain completes: auth → permissions → dashboard", async ({
    page,
  }) => {
    await tid(page, "ac-start-btn").click();

    // Step 1: auth must succeed first
    await expect(tid(page, "ac-auth-status")).toHaveText("success", {
      timeout: 30_000,
    });

    // Step 2: permissions fires after auth (after ordering)
    await expect(tid(page, "ac-perms-status")).not.toHaveText("idle", {
      timeout: 30_000,
    });
    await expect(tid(page, "ac-perms-status")).toHaveText("success", {
      timeout: 30_000,
    });

    // Step 3: dashboard fires after permissions
    await expect(tid(page, "ac-dash-status")).not.toHaveText("idle", {
      timeout: 30_000,
    });
    await expect(tid(page, "ac-dash-status")).toHaveText("success", {
      timeout: 30_000,
    });
  });

  test("timeline records events", async ({ page }) => {
    await tid(page, "ac-start-btn").click();

    // Wait for chain to complete (3-step async chain + reconciliation)
    await expect(tid(page, "ac-dash-status")).toHaveText("success", {
      timeout: 30_000,
    });

    // Timeline should have entries
    const entries = tid(page, "ac-timeline").locator(".ac-timeline-entry");
    await expect(entries.first()).toBeVisible();
    const count = await entries.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("reset clears all modules", async ({ page }) => {
    await tid(page, "ac-start-btn").click();
    await expect(tid(page, "ac-auth-status")).toHaveText("success", {
      timeout: 15_000,
    });

    await tid(page, "ac-reset-btn").click();

    await expect(tid(page, "ac-auth-status")).toHaveText("idle", {
      timeout: 5_000,
    });
    await expect(tid(page, "ac-perms-status")).toHaveText("idle", {
      timeout: 5_000,
    });
    await expect(tid(page, "ac-dash-status")).toHaveText("idle", {
      timeout: 5_000,
    });
  });

  test("fail rate sliders respond", async ({ page }) => {
    // Set auth fail rate via evaluate
    await page.evaluate(() => {
      const slider = document.querySelector(
        '[data-testid="ac-auth-fail-rate"]',
      ) as HTMLInputElement;
      slider.value = "50";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Verify the label updates
    const label = page.locator("#ac-auth-fail-val");
    await expect(label).toHaveText("50%", { timeout: 3_000 });
  });

  test("no JS errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/docs/examples/async-chains");
    await page.waitForSelector("directive-async-chains", {
      state: "attached",
      timeout: 30_000,
    });
    await page.waitForSelector("[data-async-chains-ready]", {
      timeout: 15_000,
    });
    expect(errors).toEqual([]);
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
