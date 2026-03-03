import { expect, test } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("Shopping Cart example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/shopping-cart");
    try {
      await page.waitForSelector("directive-shopping-cart", {
        state: "attached",
        timeout: 30_000,
      });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-shopping-cart", {
        state: "attached",
        timeout: 30_000,
      });
    }
    await page.waitForSelector("[data-shopping-cart-ready]", {
      timeout: 15_000,
    });
  });

  test("page loads with initial cart items", async ({ page }) => {
    const items = tid(page, "sc-item-list").locator(".sc-item");
    await expect(items).toHaveCount(3);
    await expect(tid(page, "sc-item-count")).toHaveText("4 items");
    await expect(tid(page, "sc-subtotal")).toHaveText(/\$\d+\.\d{2}/);
  });

  test("quantity controls update totals", async ({ page }) => {
    const beforeCount = await tid(page, "sc-item-count").textContent();
    const beforeSubtotal = await tid(page, "sc-subtotal").textContent();

    // Click + on first item
    const firstIncrease = tid(page, "sc-item-list")
      .locator(".sc-item")
      .first()
      .locator('[data-action="increase"]');
    await firstIncrease.click();
    await page.waitForTimeout(300);

    const afterCount = await tid(page, "sc-item-count").textContent();
    const afterSubtotal = await tid(page, "sc-subtotal").textContent();

    expect(afterCount).not.toBe(beforeCount);
    expect(afterSubtotal).not.toBe(beforeSubtotal);
  });

  test("remove item from cart", async ({ page }) => {
    const removeBtn = tid(page, "sc-item-list")
      .locator(".sc-item")
      .first()
      .locator('[data-action="remove"]');
    await removeBtn.click();
    await page.waitForTimeout(300);

    const items = tid(page, "sc-item-list").locator(".sc-item");
    await expect(items).toHaveCount(2);
  });

  test("valid coupon applies discount", async ({ page }) => {
    await tid(page, "sc-coupon-input").fill("SAVE10");
    await tid(page, "sc-coupon-apply").click();

    await expect(tid(page, "sc-coupon-status")).toContainText(
      "10% off applied",
      { timeout: 5_000 },
    );
    await expect(tid(page, "sc-discount")).toBeVisible();
    await expect(tid(page, "sc-discount")).toHaveText(/^-\$/);
  });

  test("invalid coupon shows error", async ({ page }) => {
    await tid(page, "sc-coupon-input").fill("BOGUS");
    await tid(page, "sc-coupon-apply").click();

    await expect(tid(page, "sc-coupon-status")).toContainText("Invalid code", {
      timeout: 5_000,
    });
  });

  test("free shipping threshold", async ({ page }) => {
    // Initial subtotal > $75 → free shipping visible
    await expect(tid(page, "sc-free-shipping")).toBeVisible();

    // Remove items until below threshold
    const removeButtons = tid(page, "sc-item-list").locator(
      '[data-action="remove"]',
    );
    const count = await removeButtons.count();
    for (let i = 0; i < count; i++) {
      await tid(page, "sc-item-list")
        .locator('[data-action="remove"]')
        .first()
        .click();
      await page.waitForTimeout(300);
    }

    // Cart empty → free shipping hidden
    await expect(tid(page, "sc-free-shipping")).not.toBeVisible();
  });

  test("auth toggle disables checkout", async ({ page }) => {
    // Initially signed in → checkout enabled
    await expect(tid(page, "sc-checkout-btn")).toBeEnabled();

    // Sign out
    await tid(page, "sc-auth-toggle").click();
    await page.waitForTimeout(300);
    await expect(tid(page, "sc-checkout-btn")).toBeDisabled();

    // Sign back in
    await tid(page, "sc-auth-toggle").click();
    await page.waitForTimeout(300);
    await expect(tid(page, "sc-checkout-btn")).toBeEnabled();
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
