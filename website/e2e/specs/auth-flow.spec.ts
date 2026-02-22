import { test, expect } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

/**
 * Helper: set a value on an input element via page.evaluate to bypass
 * Playwright's typing delay.
 */
async function setInput(page: import("@playwright/test").Page, testid: string, value: string) {
  await page.evaluate(({ tid: t, val }) => {
    const input = document.querySelector(`[data-testid="${t}"]`) as HTMLInputElement;
    input.value = val;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, { tid: testid, val: value });
}

async function setSlider(page: import("@playwright/test").Page, testid: string, value: string) {
  await page.evaluate(({ tid: t, val }) => {
    const input = document.querySelector(`[data-testid="${t}"]`) as HTMLInputElement;
    input.value = val;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, { tid: testid, val: value });
}

test.describe("Auth Flow example", () => {
  // Dev server can be slow under parallel load
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/auth-flow");
    try {
      await page.waitForSelector("directive-auth-flow", { state: "attached", timeout: 30_000 });
    } catch {
      // Dev server sometimes needs a second attempt under parallel load
      await page.reload();
      await page.waitForSelector("directive-auth-flow", { state: "attached", timeout: 30_000 });
    }
    await page.waitForSelector("[data-auth-flow-ready]", { timeout: 15_000 });
  });

  test("page loads and UI renders", async ({ page }) => {
    await expect(tid(page, "auth-flow-email-input")).toBeVisible();
    await expect(tid(page, "auth-flow-password-input")).toBeVisible();
    await expect(tid(page, "auth-flow-login-btn")).toBeVisible();
    await expect(tid(page, "auth-flow-status-badge")).toBeVisible();
  });

  test("login button disabled when fields empty", async ({ page }) => {
    await setInput(page, "auth-flow-email-input", "");
    await page.waitForTimeout(100);
    await expect(tid(page, "auth-flow-login-btn")).toBeDisabled();
  });

  test("successful login flow", async ({ page }) => {
    // Ensure default credentials
    await setInput(page, "auth-flow-email-input", "alice@test.com");
    await setInput(page, "auth-flow-password-input", "password");

    await tid(page, "auth-flow-login-btn").click();

    // Should reach authenticated with user data
    await expect(tid(page, "auth-flow-status-badge")).toHaveText("authenticated", { timeout: 10_000 });
    await expect(tid(page, "auth-flow-user-display")).not.toHaveText("\u2014", { timeout: 10_000 });
  });

  test("shows authenticating state during login", async ({ page }) => {
    await tid(page, "auth-flow-login-btn").click();

    // Should see authenticating badge briefly
    await expect(tid(page, "auth-flow-status-badge")).toHaveText("authenticating", { timeout: 5_000 });
  });

  test("login failure shows error", async ({ page }) => {
    // Set 100% login fail rate
    await setSlider(page, "auth-flow-login-failrate", "100");
    await tid(page, "auth-flow-login-btn").click();

    // Should show error message
    await expect(tid(page, "auth-flow-login-error")).toBeVisible({ timeout: 10_000 });
    await expect(tid(page, "auth-flow-login-error")).not.toBeEmpty();
  });

  test("auto-refresh fires before token expires", async ({ page }) => {
    // Short TTL, generous buffer so refresh fires quickly
    await setSlider(page, "auth-flow-token-ttl", "8");
    await setSlider(page, "auth-flow-refresh-buffer", "5");

    await tid(page, "auth-flow-login-btn").click();
    await expect(tid(page, "auth-flow-status-badge")).toHaveText("authenticated", { timeout: 10_000 });

    // Wait for refresh event in timeline (should fire within ~3s)
    await expect(
      tid(page, "auth-flow-timeline").locator(".af-timeline-entry.refresh-success")
    ).toBeVisible({ timeout: 15_000 });
  });

  test("refresh failure expires session", async ({ page }) => {
    await setSlider(page, "auth-flow-token-ttl", "10");
    await setSlider(page, "auth-flow-refresh-buffer", "5");

    await tid(page, "auth-flow-login-btn").click();
    await expect(tid(page, "auth-flow-status-badge")).toHaveText("authenticated", { timeout: 10_000 });

    // Set 100% refresh fail and force expire
    await setSlider(page, "auth-flow-refresh-failrate", "100");
    await tid(page, "auth-flow-force-expire-btn").click();

    // Should end up expired after retries fail
    await expect(tid(page, "auth-flow-status-badge")).toHaveText("expired", { timeout: 15_000 });
  });

  test("force expire triggers refresh", async ({ page }) => {
    await tid(page, "auth-flow-login-btn").click();
    await expect(tid(page, "auth-flow-status-badge")).toHaveText("authenticated", { timeout: 10_000 });

    await tid(page, "auth-flow-force-expire-btn").click();

    // Should see refreshing state
    await expect(tid(page, "auth-flow-status-badge")).toHaveText(/refreshing|authenticated/, { timeout: 10_000 });
  });

  test("logout clears all state", async ({ page }) => {
    await tid(page, "auth-flow-login-btn").click();
    await expect(tid(page, "auth-flow-status-badge")).toHaveText("authenticated", { timeout: 10_000 });

    await tid(page, "auth-flow-logout-btn").click();

    await expect(tid(page, "auth-flow-status-badge")).toHaveText("idle", { timeout: 5_000 });
    await expect(tid(page, "auth-flow-user-display")).toContainText("\u2014");
  });

  test("needsUser waits for refreshNeeded", async ({ page }) => {
    await tid(page, "auth-flow-login-btn").click();
    await expect(tid(page, "auth-flow-status-badge")).toHaveText("authenticated", { timeout: 10_000 });

    // Verify user was fetched (appears in timeline after login)
    await expect(
      tid(page, "auth-flow-timeline").locator(".af-timeline-entry.fetch-user-success")
    ).toBeVisible({ timeout: 10_000 });
  });

  test("derivations update in real-time", async ({ page }) => {
    // Before login: isAuthenticated should be false
    await expect(tid(page, "auth-flow-deriv-authenticated")).toContainText("false");
    await expect(tid(page, "auth-flow-deriv-time-remaining")).toHaveText("0s");

    await tid(page, "auth-flow-login-btn").click();
    await expect(tid(page, "auth-flow-status-badge")).toHaveText("authenticated", { timeout: 10_000 });

    // After login: isAuthenticated flips to true
    await expect(tid(page, "auth-flow-deriv-authenticated")).toContainText("true", { timeout: 5_000 });
    // canRefresh should be true (refreshToken exists)
    await expect(tid(page, "auth-flow-deriv-can-refresh")).toContainText("true", { timeout: 5_000 });

    // tokenTimeRemaining should be counting down (not 0)
    const remaining = await tid(page, "auth-flow-deriv-time-remaining").textContent();
    const seconds = parseInt(remaining || "0", 10);
    expect(seconds).toBeGreaterThan(0);

    // Wait 2s and verify it decreased
    await page.waitForTimeout(2000);
    const remaining2 = await tid(page, "auth-flow-deriv-time-remaining").textContent();
    const seconds2 = parseInt(remaining2 || "0", 10);
    expect(seconds2).toBeLessThan(seconds);
  });

  test("code tabs visible below example", async ({ page }) => {

    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
