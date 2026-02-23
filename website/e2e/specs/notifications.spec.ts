import { test, expect } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("Notifications example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/notifications");
    try {
      await page.waitForSelector("directive-notifications", { state: "attached", timeout: 30_000 });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-notifications", { state: "attached", timeout: 30_000 });
    }
    await page.waitForSelector("[data-notifications-ready]", { timeout: 15_000 });
  });

  test("page loads with empty queue", async ({ page }) => {
    await expect(tid(page, "nt-queue-count")).toHaveText("0");
    await expect(tid(page, "nt-toast-stack").locator(".nt-toast")).toHaveCount(0);
    await expect(tid(page, "nt-add-info")).toBeVisible();
    await expect(tid(page, "nt-add-success")).toBeVisible();
    await expect(tid(page, "nt-add-warning")).toBeVisible();
    await expect(tid(page, "nt-add-error")).toBeVisible();
    await expect(tid(page, "nt-burst")).toBeVisible();
  });

  test("add info toast appears in stack", async ({ page }) => {
    await tid(page, "nt-add-info").click();
    await page.waitForTimeout(300);

    await expect(tid(page, "nt-toast-stack").locator(".nt-toast")).toHaveCount(1);
    await expect(tid(page, "nt-toast-stack").locator(".nt-toast-info")).toBeVisible();
    await expect(tid(page, "nt-queue-count")).toHaveText("1");
  });

  test("each level creates correct toast type", async ({ page }) => {
    await tid(page, "nt-add-info").click();
    await tid(page, "nt-add-success").click();
    await tid(page, "nt-add-warning").click();
    await tid(page, "nt-add-error").click();
    await page.waitForTimeout(300);

    await expect(tid(page, "nt-toast-stack").locator(".nt-toast")).toHaveCount(4);
    await expect(tid(page, "nt-toast-stack").locator(".nt-toast-info")).toHaveCount(1);
    await expect(tid(page, "nt-toast-stack").locator(".nt-toast-success")).toHaveCount(1);
    await expect(tid(page, "nt-toast-stack").locator(".nt-toast-warning")).toHaveCount(1);
    await expect(tid(page, "nt-toast-stack").locator(".nt-toast-error")).toHaveCount(1);
    await expect(tid(page, "nt-queue-count")).toHaveText("4");
  });

  test("dismiss toast via close button", async ({ page }) => {
    await tid(page, "nt-add-info").click();
    await page.waitForTimeout(300);
    await expect(tid(page, "nt-queue-count")).toHaveText("1");

    // Click the dismiss button on the toast
    const closeBtn = tid(page, "nt-toast-stack").locator(".nt-toast-close").first();
    await closeBtn.click();
    await page.waitForTimeout(500);

    await expect(tid(page, "nt-queue-count")).toHaveText("0");
  });

  test("burst adds 5 notifications", async ({ page }) => {
    await tid(page, "nt-burst").click();
    await page.waitForTimeout(300);

    await expect(tid(page, "nt-queue-count")).toHaveText("5");
    await expect(tid(page, "nt-toast-stack").locator(".nt-toast")).toHaveCount(5);
  });

  test("max visible slider limits displayed toasts", async ({ page }) => {
    // Add 4 notifications
    await tid(page, "nt-add-info").click();
    await tid(page, "nt-add-success").click();
    await tid(page, "nt-add-warning").click();
    await tid(page, "nt-add-error").click();
    await page.waitForTimeout(300);
    await expect(tid(page, "nt-toast-stack").locator(".nt-toast")).toHaveCount(4);

    // Set max visible to 2 via slider
    await tid(page, "nt-max-visible").fill("2");
    await tid(page, "nt-max-visible").dispatchEvent("input");
    await page.waitForTimeout(300);

    // Only 2 toasts visible, but queue still has 4
    await expect(tid(page, "nt-toast-stack").locator(".nt-toast")).toHaveCount(2);
    await expect(tid(page, "nt-queue-count")).toHaveText("4");
  });

  test("action log records entries", async ({ page }) => {
    await tid(page, "nt-add-info").click();
    await tid(page, "nt-add-error").click();
    await page.waitForTimeout(300);

    const logEntries = page.locator(".nt-log-entry");
    await expect(logEntries).toHaveCount(2);
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
