import { test, expect } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("Contact Form example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/contact-form");
    try {
      await page.waitForSelector("directive-contact-form", { state: "attached", timeout: 30_000 });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-contact-form", { state: "attached", timeout: 30_000 });
    }
    await page.waitForSelector("[data-contact-form-ready]", { timeout: 15_000 });
  });

  test("page loads with empty form and submit disabled", async ({ page }) => {
    await expect(tid(page, "cf-name")).toHaveValue("", { timeout: 5_000 });
    await expect(tid(page, "cf-email")).toHaveValue("");
    await expect(tid(page, "cf-subject")).toHaveValue("");
    await expect(tid(page, "cf-message")).toHaveValue("");
    await expect(tid(page, "cf-submit")).toBeDisabled();
  });

  test("validation errors show after blur", async ({ page }) => {
    // Focus and blur the name field without typing
    await tid(page, "cf-name").focus();
    await tid(page, "cf-name").blur();

    await expect(tid(page, "cf-name-error")).toHaveText("Name is required", { timeout: 5_000 });
  });

  test("email validation shows error for invalid format", async ({ page }) => {
    await tid(page, "cf-email").fill("notanemail");
    await tid(page, "cf-email").blur();

    await expect(tid(page, "cf-email-error")).toHaveText("Enter a valid email address", { timeout: 5_000 });
  });

  test("valid form enables submit", async ({ page }) => {
    await tid(page, "cf-name").fill("John Doe");
    await tid(page, "cf-email").fill("john@example.com");
    await tid(page, "cf-subject").selectOption("general");
    await tid(page, "cf-message").fill("This is a test message that is long enough");

    // Need to trigger blur/touch for validation
    await tid(page, "cf-name").blur();
    await tid(page, "cf-email").blur();
    await tid(page, "cf-subject").blur();
    await tid(page, "cf-message").blur();

    await expect(tid(page, "cf-submit")).toBeEnabled({ timeout: 5_000 });
  });

  test("character count updates on typing", async ({ page }) => {
    await expect(tid(page, "cf-char-count")).toHaveText("0 / 10 min", { timeout: 5_000 });

    await tid(page, "cf-message").fill("Hello");

    await expect(tid(page, "cf-char-count")).toHaveText("5 / 10 min", { timeout: 5_000 });
  });

  test("clear button resets form", async ({ page }) => {
    // Fill some fields
    await tid(page, "cf-name").fill("John");
    await tid(page, "cf-email").fill("john@example.com");

    // Click clear
    await tid(page, "cf-clear").click();

    // Fields should be empty
    await expect(tid(page, "cf-name")).toHaveValue("", { timeout: 5_000 });
    await expect(tid(page, "cf-email")).toHaveValue("");
  });

  test("source code visible below example", async ({ page }) => {
    const sourceSection = page.locator("text=Source code");
    await expect(sourceSection).toBeVisible();
  });
});
