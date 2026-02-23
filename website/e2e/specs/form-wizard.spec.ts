import { test, expect } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("Form Wizard example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    // Clear persisted draft before each test
    await page.goto("/docs/examples/form-wizard");
    await page.evaluate(() => localStorage.removeItem("form-wizard-draft"));
    await page.reload();
    try {
      await page.waitForSelector("directive-form-wizard", { state: "attached", timeout: 30_000 });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-form-wizard", { state: "attached", timeout: 30_000 });
    }
    await page.waitForSelector("[data-form-wizard-ready]", { timeout: 15_000 });
  });

  test("page loads on step 1 with Next disabled", async ({ page }) => {
    await expect(tid(page, "fw-step-0")).toBeVisible();
    await expect(tid(page, "fw-next-btn")).toBeDisabled();
    await expect(tid(page, "fw-back-btn")).not.toBeVisible();
    await expect(tid(page, "fw-progress")).toContainText("Step 1 of 3");
  });

  test("step 1 validates email and password", async ({ page }) => {
    // Next stays disabled with incomplete fields
    await tid(page, "fw-email").fill("incomplete");
    await page.waitForTimeout(200);
    await expect(tid(page, "fw-next-btn")).toBeDisabled();

    // Valid email + short password still disabled
    await tid(page, "fw-email").fill("user@test.com");
    await tid(page, "fw-password").fill("short");
    await page.waitForTimeout(200);
    await expect(tid(page, "fw-next-btn")).toBeDisabled();

    // Valid email + 8+ char password enables Next
    await tid(page, "fw-password").fill("password123");
    await page.waitForTimeout(200);
    await expect(tid(page, "fw-next-btn")).toBeEnabled();
  });

  test("async email availability check", async ({ page }) => {
    await tid(page, "fw-email").fill("taken@test.com");

    // Wait for async check (500ms)
    await expect(tid(page, "fw-email-status")).toContainText("Email already taken", { timeout: 5_000 });

    // Change to available email
    await tid(page, "fw-email").fill("available@test.com");
    await expect(tid(page, "fw-email-status")).toContainText("Email available", { timeout: 5_000 });
  });

  test("advance to step 2 and back preserves data", async ({ page }) => {
    // Fill step 1
    await tid(page, "fw-email").fill("user@test.com");
    await tid(page, "fw-password").fill("password123");
    await page.waitForTimeout(200);

    // Advance
    await tid(page, "fw-next-btn").click();
    await page.waitForTimeout(300);

    // Step 2 visible
    await expect(tid(page, "fw-step-1")).toBeVisible();
    await expect(tid(page, "fw-step-0")).not.toBeVisible();
    await expect(tid(page, "fw-back-btn")).toBeVisible();
    await expect(tid(page, "fw-progress")).toContainText("Step 2 of 3");

    // Go back
    await tid(page, "fw-back-btn").click();
    await page.waitForTimeout(300);

    // Step 1 visible with data preserved
    await expect(tid(page, "fw-step-0")).toBeVisible();
    await expect(tid(page, "fw-email")).toHaveValue("user@test.com");
  });

  test("step 2 requires name", async ({ page }) => {
    // Fill step 1 and advance
    await tid(page, "fw-email").fill("user@test.com");
    await tid(page, "fw-password").fill("password123");
    await page.waitForTimeout(200);
    await tid(page, "fw-next-btn").click();
    await page.waitForTimeout(300);

    // Next disabled without name
    await expect(tid(page, "fw-next-btn")).toBeDisabled();

    // Fill name → Next enabled
    await tid(page, "fw-name").fill("Test User");
    await page.waitForTimeout(200);
    await expect(tid(page, "fw-next-btn")).toBeEnabled();
  });

  test("step 3 shows plan selection and submit", async ({ page }) => {
    // Fill step 1
    await tid(page, "fw-email").fill("user@test.com");
    await tid(page, "fw-password").fill("password123");
    await page.waitForTimeout(200);
    await tid(page, "fw-next-btn").click();
    await page.waitForTimeout(300);

    // Fill step 2
    await tid(page, "fw-name").fill("Test User");
    await page.waitForTimeout(200);
    await tid(page, "fw-next-btn").click();
    await page.waitForTimeout(300);

    // Step 3 visible with plan radios and submit button
    await expect(tid(page, "fw-step-2")).toBeVisible();
    await expect(tid(page, "fw-plan-free")).toBeChecked();
    await expect(tid(page, "fw-submit-btn")).toBeVisible();
    await expect(tid(page, "fw-next-btn")).not.toBeVisible();
    await expect(tid(page, "fw-progress")).toContainText("Step 3 of 3");
  });

  test("full wizard submission shows success", async ({ page }) => {
    // Step 1
    await tid(page, "fw-email").fill("user@test.com");
    await tid(page, "fw-password").fill("password123");
    await page.waitForTimeout(200);
    await tid(page, "fw-next-btn").click();
    await page.waitForTimeout(300);

    // Step 2
    await tid(page, "fw-name").fill("Test User");
    await page.waitForTimeout(200);
    await tid(page, "fw-next-btn").click();
    await page.waitForTimeout(300);

    // Step 3 — submit (plan defaults to "free")
    await tid(page, "fw-submit-btn").click();

    // Wait for success screen (800ms simulated API)
    await expect(tid(page, "fw-success")).toBeVisible({ timeout: 5_000 });
    await expect(tid(page, "fw-success")).toContainText("Account Created");
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
