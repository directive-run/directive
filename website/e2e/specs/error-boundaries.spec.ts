import { expect, test } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

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

test.describe("Error Boundaries example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/error-boundaries");
    try {
      await page.waitForSelector("directive-error-boundaries", {
        state: "attached",
        timeout: 30_000,
      });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-error-boundaries", {
        state: "attached",
        timeout: 30_000,
      });
    }
    await page.waitForSelector("[data-error-boundaries-ready]", {
      timeout: 15_000,
    });
  });

  test("page loads and UI renders", async ({ page }) => {
    await expect(tid(page, "eb-fetch-all")).toBeVisible();
    await expect(tid(page, "eb-reset")).toBeVisible();
    await expect(tid(page, "eb-strategy")).toBeVisible();
    await expect(tid(page, "eb-timeline")).toBeVisible();
  });

  test("fetch all triggers requests and shows results", async ({ page }) => {
    await tid(page, "eb-fetch-all").click();

    // Wait for total requests to increment
    await expect(tid(page, "eb-total-requests")).not.toHaveText("0", {
      timeout: 10_000,
    });
  });

  test("inject error on service shows error in timeline", async ({ page }) => {
    // Set high fail rate on users service
    await setSlider(page, "eb-fail-users", "100");

    await tid(page, "eb-fetch-all").click();
    await page.waitForTimeout(2000);

    // Should have errors
    const errors = await tid(page, "eb-error-count").textContent();
    expect(Number(errors)).toBeGreaterThan(0);
  });

  test("circuit breaker opens after repeated failures", async ({ page }) => {
    await setSlider(page, "eb-fail-users", "100");

    // Send multiple requests to trip circuit breaker
    for (let i = 0; i < 4; i++) {
      await tid(page, "eb-fetch-all").click();
      await page.waitForTimeout(1000);
    }

    // Circuit state should show OPEN
    await expect(tid(page, "eb-circuit-users")).toContainText("OPEN", {
      timeout: 10_000,
    });
  });

  test("retry-later strategy shows retry events", async ({ page }) => {
    // Ensure retry-later strategy
    await page.selectOption("[data-testid='eb-strategy']", "retry-later");

    await setSlider(page, "eb-fail-orders", "100");
    await tid(page, "eb-fetch-all").click();
    await page.waitForTimeout(3000);

    // Timeline should contain retry entries
    const timeline = tid(page, "eb-timeline");
    await expect(timeline).not.toBeEmpty();
  });

  test("skip strategy swallows errors silently", async ({ page }) => {
    await page.selectOption("[data-testid='eb-strategy']", "skip");
    await setSlider(page, "eb-fail-analytics", "100");

    await tid(page, "eb-fetch-all").click();
    await page.waitForTimeout(2000);

    // Errors should be counted but pipeline continues
    const errors = await tid(page, "eb-error-count").textContent();
    expect(Number(errors)).toBeGreaterThan(0);
  });

  test("reset clears all stats and circuit states", async ({ page }) => {
    await setSlider(page, "eb-fail-users", "100");
    await tid(page, "eb-fetch-all").click();
    await page.waitForTimeout(2000);

    await tid(page, "eb-reset").click();
    await page.waitForTimeout(500);

    await expect(tid(page, "eb-total-requests")).toHaveText("0");
    await expect(tid(page, "eb-error-count")).toHaveText("0");
  });

  test("performance metrics show after requests", async ({ page }) => {
    await tid(page, "eb-fetch-all").click();
    await page.waitForTimeout(2000);

    const avgLatency = await tid(page, "eb-avg-latency").textContent();
    expect(avgLatency).not.toBe("0ms");
  });

  test("circuit recovers after errors stop", async ({ page }) => {
    await setSlider(page, "eb-fail-users", "100");

    // Trip circuit
    for (let i = 0; i < 4; i++) {
      await tid(page, "eb-fetch-all").click();
      await page.waitForTimeout(800);
    }

    await expect(tid(page, "eb-circuit-users")).toContainText("OPEN", {
      timeout: 10_000,
    });

    // Remove errors and wait for recovery
    await setSlider(page, "eb-fail-users", "0");
    await page.waitForTimeout(6000);

    // Circuit should transition to HALF_OPEN or CLOSED
    const circuitText = await tid(page, "eb-circuit-users").textContent();
    expect(circuitText).toMatch(/HALF_OPEN|CLOSED/);
  });
});
