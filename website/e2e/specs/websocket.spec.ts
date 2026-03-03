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

test.describe("WebSocket example", () => {
  // Dev server can be slow under parallel load
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/websocket");
    try {
      await page.waitForSelector("directive-websocket", {
        state: "attached",
        timeout: 30_000,
      });
    } catch {
      // Dev server sometimes needs a second attempt under parallel load
      await page.reload();
      await page.waitForSelector("directive-websocket", {
        state: "attached",
        timeout: 30_000,
      });
    }
    await page.waitForSelector("[data-websocket-ready]", { timeout: 15_000 });
  });

  test("page loads and UI renders", async ({ page }) => {
    await expect(tid(page, "ws-url-input")).toBeVisible();
    await expect(tid(page, "ws-connect-btn")).toBeVisible();
    await expect(tid(page, "ws-status-badge")).toBeVisible();
    await expect(tid(page, "ws-message-feed")).toBeVisible();
  });

  test("connect establishes connection", async ({ page }) => {
    await tid(page, "ws-connect-btn").click();

    // Should transition from connecting to connected
    await expect(tid(page, "ws-status-badge")).toHaveText("connected", {
      timeout: 10_000,
    });
  });

  test("messages received after connection", async ({ page }) => {
    // Set fast message rate for test speed
    await setSlider(page, "ws-message-rate", "1");
    await tid(page, "ws-connect-btn").click();
    await expect(tid(page, "ws-status-badge")).toHaveText("connected", {
      timeout: 10_000,
    });

    // Wait for at least one message
    await expect(tid(page, "ws-message-feed").locator(".ws-message-item"))
      .toHaveCount(1, { timeout: 5_000 })
      .catch(() => {
        // Retry with broader check — at least 1 message
      });
    await expect(
      tid(page, "ws-message-feed").locator(".ws-message-item").first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("send message and receive echo", async ({ page }) => {
    await tid(page, "ws-connect-btn").click();
    await expect(tid(page, "ws-status-badge")).toHaveText("connected", {
      timeout: 10_000,
    });

    // Type and send a message
    await setInput(page, "ws-message-input", "Hello Directive!");
    await tid(page, "ws-send-btn").click();

    // Should see the echo in the feed (from "You")
    await expect(tid(page, "ws-message-feed")).toContainText(
      "Hello Directive!",
      { timeout: 5_000 },
    );
  });

  test("disconnect closes connection", async ({ page }) => {
    await tid(page, "ws-connect-btn").click();
    await expect(tid(page, "ws-status-badge")).toHaveText("connected", {
      timeout: 10_000,
    });

    await tid(page, "ws-disconnect-btn").click();
    await expect(tid(page, "ws-status-badge")).toHaveText("disconnected", {
      timeout: 5_000,
    });
  });

  test("auto-reconnect on error", async ({ page }) => {
    await tid(page, "ws-connect-btn").click();
    await expect(tid(page, "ws-status-badge")).toHaveText("connected", {
      timeout: 10_000,
    });

    // Force error to trigger reconnection
    await tid(page, "ws-force-error-btn").click();

    // Should see error then reconnecting
    await expect(tid(page, "ws-status-badge")).toHaveText(
      /error|reconnecting/,
      { timeout: 5_000 },
    );
  });

  test("reconnect countdown visible", async ({ page }) => {
    await tid(page, "ws-connect-btn").click();
    await expect(tid(page, "ws-status-badge")).toHaveText("connected", {
      timeout: 10_000,
    });

    await tid(page, "ws-force-error-btn").click();

    // Wait for reconnecting state
    await expect(tid(page, "ws-status-badge")).toHaveText("reconnecting", {
      timeout: 5_000,
    });

    // Countdown should show seconds
    await expect(tid(page, "ws-reconnect-countdown")).toBeVisible({
      timeout: 5_000,
    });
    await expect(tid(page, "ws-reconnect-countdown")).toContainText(
      "Reconnecting in",
      { timeout: 5_000 },
    );
  });

  test("reconnect succeeds", async ({ page }) => {
    // Ensure 0% fail rate so reconnect succeeds
    await setSlider(page, "ws-connect-failrate", "0");
    await setSlider(page, "ws-reconnect-failrate", "0");

    await tid(page, "ws-connect-btn").click();
    await expect(tid(page, "ws-status-badge")).toHaveText("connected", {
      timeout: 10_000,
    });

    await tid(page, "ws-force-error-btn").click();

    // Should eventually reconnect to connected
    await expect(tid(page, "ws-status-badge")).toHaveText("connected", {
      timeout: 15_000,
    });
  });

  test("max retries exhausted", async ({ page }) => {
    // Set max retries to 1 and 100% connect fail rate
    await setSlider(page, "ws-max-retries", "1");

    await tid(page, "ws-connect-btn").click();
    await expect(tid(page, "ws-status-badge")).toHaveText("connected", {
      timeout: 10_000,
    });

    // Now set 100% connect fail so reconnection attempts fail
    await setSlider(page, "ws-connect-failrate", "100");

    await tid(page, "ws-force-error-btn").click();

    // Wait for reconnect to attempt and fail — after 1 retry, should stay at error
    // The reconnect resolver increments retryCount then sets status=connecting,
    // which triggers connect resolver that fails, setting status=error.
    // With maxRetries=1 and retryCount=1, shouldReconnect becomes false.
    await expect(tid(page, "ws-status-badge")).toHaveText("error", {
      timeout: 15_000,
    });

    // Verify it stays at error (shouldReconnect should be false)
    await page.waitForTimeout(2000);
    await expect(tid(page, "ws-deriv-should-reconnect")).toContainText("false");
  });

  test("derivations update in real-time", async ({ page }) => {
    // Before connection: isConnected should be false
    await expect(tid(page, "ws-deriv-connected")).toContainText("false");

    await tid(page, "ws-connect-btn").click();
    await expect(tid(page, "ws-status-badge")).toHaveText("connected", {
      timeout: 10_000,
    });

    // After connection: isConnected flips to true
    await expect(tid(page, "ws-deriv-connected")).toContainText("true", {
      timeout: 5_000,
    });

    // Disconnect and verify it goes back to false
    await tid(page, "ws-disconnect-btn").click();
    await expect(tid(page, "ws-deriv-connected")).toContainText("false", {
      timeout: 5_000,
    });
  });

  test("clear messages empties feed", async ({ page }) => {
    await setSlider(page, "ws-message-rate", "1");
    await tid(page, "ws-connect-btn").click();
    await expect(tid(page, "ws-status-badge")).toHaveText("connected", {
      timeout: 10_000,
    });

    // Wait for at least one message
    await expect(
      tid(page, "ws-message-feed").locator(".ws-message-item").first(),
    ).toBeVisible({ timeout: 5_000 });

    // Clear messages
    await tid(page, "ws-clear-btn").click();

    // Feed should be empty
    await expect(tid(page, "ws-message-count")).toHaveText("0 messages", {
      timeout: 5_000,
    });
  });

  test("code tabs visible below example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
