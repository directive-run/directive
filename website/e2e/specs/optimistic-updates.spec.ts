import { expect, test } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

/**
 * Helper: set a value on an input element via page.evaluate to bypass
 * Playwright's typing delay.
 */
async function setInput(
  page: import("@playwright/test").Page,
  testid: string,
  value: string,
) {
  await page.evaluate(
    ({ tid: t, val }) => {
      const input = document.querySelector(
        `[data-testid="${t}"]`,
      ) as HTMLInputElement;
      input.value = val;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { tid: testid, val: value },
  );
}

async function setSlider(
  page: import("@playwright/test").Page,
  testid: string,
  value: string,
) {
  await page.evaluate(
    ({ tid: t, val }) => {
      const input = document.querySelector(
        `[data-testid="${t}"]`,
      ) as HTMLInputElement;
      input.value = val;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { tid: testid, val: value },
  );
}

test.describe("Optimistic Updates example", () => {
  // Dev server can be slow under parallel load
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/optimistic-updates");
    try {
      await page.waitForSelector("directive-optimistic-updates", {
        state: "attached",
        timeout: 30_000,
      });
    } catch {
      // Dev server sometimes needs a second attempt under parallel load
      await page.reload();
      await page.waitForSelector("directive-optimistic-updates", {
        state: "attached",
        timeout: 30_000,
      });
    }
    await page.waitForSelector("[data-optimistic-updates-ready]", {
      timeout: 15_000,
    });
  });

  test("page loads and renders todo items", async ({ page }) => {
    await expect(tid(page, "ou-add-input")).toBeVisible();
    await expect(tid(page, "ou-add-btn")).toBeVisible();
    await expect(tid(page, "ou-todo-list")).toBeVisible();

    // 5 pre-seeded items
    const items = tid(page, "ou-todo-list").locator(".ou-todo-item");
    await expect(items).toHaveCount(5);
  });

  test("add button disabled when input empty", async ({ page }) => {
    await expect(tid(page, "ou-add-btn")).toBeDisabled();
  });

  test("toggle shows pending state immediately", async ({ page }) => {
    // Set high delay so pending state is clearly visible
    await setSlider(page, "ou-server-delay", "3000");

    // Toggle first item
    await tid(page, "ou-toggle-1").click();

    // Should show pending class within 500ms
    await expect(tid(page, "ou-item-1")).toHaveAttribute(
      "data-pending",
      "true",
      { timeout: 500 },
    );
  });

  test("successful toggle persists", async ({ page }) => {
    // Set 0% fail rate for deterministic success
    await setSlider(page, "ou-fail-rate", "0");
    await setSlider(page, "ou-server-delay", "200");

    // Item 1 starts as not done
    const checkbox = tid(page, "ou-toggle-1");

    // Toggle item 1
    await checkbox.click();

    // Wait for sync to complete — pending should clear
    await expect(tid(page, "ou-item-1")).not.toHaveAttribute(
      "data-pending",
      "true",
      { timeout: 5_000 },
    );

    // Item should have done class (was toggled from false to true)
    await expect(tid(page, "ou-item-1")).toHaveClass(/done/, {
      timeout: 5_000,
    });
  });

  test("failed toggle rolls back with toast", async ({ page }) => {
    // Set 100% fail rate
    await setSlider(page, "ou-fail-rate", "100");
    await setSlider(page, "ou-server-delay", "200");

    // Item 1 starts as not done — toggle it
    await tid(page, "ou-toggle-1").click();

    // After failure, item should revert — not done
    await expect(tid(page, "ou-item-1")).not.toHaveClass(/done/, {
      timeout: 5_000,
    });

    // Toast should appear
    await expect(tid(page, "ou-toast")).toContainText("rolled back", {
      timeout: 5_000,
    });
  });

  test("delete removes item immediately", async ({ page }) => {
    // Set 0% fail rate
    await setSlider(page, "ou-fail-rate", "0");
    await setSlider(page, "ou-server-delay", "200");

    // Delete item 3
    await tid(page, "ou-delete-3").click();

    // Item should be gone immediately
    await expect(tid(page, "ou-item-3")).toHaveCount(0, { timeout: 500 });

    // Should have 4 items now
    const items = tid(page, "ou-todo-list").locator(".ou-todo-item");
    await expect(items).toHaveCount(4, { timeout: 500 });
  });

  test("failed delete rolls back with toast", async ({ page }) => {
    // Set 100% fail rate
    await setSlider(page, "ou-fail-rate", "100");
    await setSlider(page, "ou-server-delay", "200");

    // Delete item 3
    await tid(page, "ou-delete-3").click();

    // Item should be gone immediately
    await expect(tid(page, "ou-item-3")).toHaveCount(0, { timeout: 500 });

    // After failure, item should reappear
    await expect(tid(page, "ou-item-3")).toBeVisible({ timeout: 5_000 });

    // Toast should show error
    await expect(tid(page, "ou-toast")).toContainText("rolled back", {
      timeout: 5_000,
    });
  });

  test("add item appears instantly", async ({ page }) => {
    await setSlider(page, "ou-fail-rate", "0");
    await setSlider(page, "ou-server-delay", "200");

    // Type and add
    await setInput(page, "ou-add-input", "New test todo");
    await tid(page, "ou-add-btn").click();

    // Should now have 6 items
    const items = tid(page, "ou-todo-list").locator(".ou-todo-item");
    await expect(items).toHaveCount(6, { timeout: 500 });

    // The new item text should be visible
    await expect(tid(page, "ou-todo-list")).toContainText("New test todo", {
      timeout: 500,
    });
  });

  test("failed add rolls back", async ({ page }) => {
    await setSlider(page, "ou-fail-rate", "100");
    await setSlider(page, "ou-server-delay", "200");

    // Type and add
    await setInput(page, "ou-add-input", "Doomed todo");
    await tid(page, "ou-add-btn").click();

    // Should appear instantly (6 items)
    const items = tid(page, "ou-todo-list").locator(".ou-todo-item");
    await expect(items).toHaveCount(6, { timeout: 500 });

    // After failure, item should disappear (back to 5)
    await expect(items).toHaveCount(5, { timeout: 5_000 });
  });

  test("pending count updates in real-time", async ({ page }) => {
    await setSlider(page, "ou-server-delay", "2000");
    await setSlider(page, "ou-fail-rate", "0");

    // Toggle item — pending count should become 1
    await tid(page, "ou-toggle-1").click();
    await expect(tid(page, "ou-pending-count")).toContainText("1 syncing", {
      timeout: 1_000,
    });

    // Wait for sync to complete — pending count should become 0
    await expect(tid(page, "ou-pending-count")).not.toHaveClass(/visible/, {
      timeout: 10_000,
    });
  });

  test("derivations update correctly", async ({ page }) => {
    // Initial state: 5 total, 2 done
    await expect(tid(page, "ou-deriv-total")).toContainText("5");
    await expect(tid(page, "ou-deriv-done")).toContainText("2");

    // Toggle item 1 (false → true) — done count should increase
    await setSlider(page, "ou-fail-rate", "0");
    await setSlider(page, "ou-server-delay", "200");
    await tid(page, "ou-toggle-1").click();

    // doneCount should now be 3
    await expect(tid(page, "ou-deriv-done")).toContainText("3", {
      timeout: 1_000,
    });
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
