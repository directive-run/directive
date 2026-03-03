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

test.describe("Provider Routing example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/provider-routing");
    try {
      await page.waitForSelector("directive-provider-routing", {
        state: "attached",
        timeout: 30_000,
      });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-provider-routing", {
        state: "attached",
        timeout: 30_000,
      });
    }
    await page.waitForSelector("[data-provider-routing-ready]", {
      timeout: 15_000,
    });
  });

  test("page loads and UI renders", async ({ page }) => {
    await expect(tid(page, "pr-send")).toBeVisible();
    await expect(tid(page, "pr-burst-10")).toBeVisible();
    await expect(tid(page, "pr-reset")).toBeVisible();
    await expect(tid(page, "pr-timeline")).toBeVisible();
  });

  test("default routes to openai", async ({ page }) => {
    await tid(page, "pr-send").click();
    await page.waitForTimeout(1000);

    await expect(tid(page, "pr-last-provider")).toHaveText("openai", {
      timeout: 5_000,
    });
    await expect(tid(page, "pr-total-requests")).not.toHaveText("0");
  });

  test("errors on openai routes to anthropic", async ({ page }) => {
    // Inject errors on openai
    await tid(page, "pr-err-openai").click();

    // Send multiple requests to trip circuit and trigger fallback
    for (let i = 0; i < 4; i++) {
      await tid(page, "pr-send").click();
      await page.waitForTimeout(800);
    }

    // Last provider should switch away from openai
    const lastProvider = await tid(page, "pr-last-provider").textContent();
    expect(lastProvider).toMatch(/anthropic|ollama/);
  });

  test("prefer cheapest routes to ollama", async ({ page }) => {
    await tid(page, "pr-prefer-cheapest").click();

    await tid(page, "pr-send").click();
    await page.waitForTimeout(1000);

    await expect(tid(page, "pr-last-provider")).toHaveText("ollama", {
      timeout: 5_000,
    });
  });

  test("low budget routes to cheapest available", async ({ page }) => {
    // Set very low budget (only ollama is affordable)
    await setSlider(page, "pr-budget", "0.01");

    await tid(page, "pr-send").click();
    await page.waitForTimeout(1000);

    // Should route to ollama (cheapest)
    const provider = await tid(page, "pr-last-provider").textContent();
    expect(provider).toBe("ollama");
  });

  test("circuit breaker opens after failures", async ({ page }) => {
    await tid(page, "pr-err-openai").click();

    // Send requests to trip circuit
    for (let i = 0; i < 5; i++) {
      await tid(page, "pr-send").click();
      await page.waitForTimeout(600);
    }

    // OpenAI circuit should show OPEN
    const openaiStats = await tid(page, "pr-openai-stats").textContent();
    expect(openaiStats).toContain("OPEN");
  });

  test("all providers fail shows error", async ({ page }) => {
    // Inject errors on all providers
    await tid(page, "pr-err-openai").click();
    await tid(page, "pr-err-anthropic").click();
    await tid(page, "pr-err-ollama").click();

    // Send enough requests to trip all circuits
    for (let i = 0; i < 12; i++) {
      await tid(page, "pr-send").click();
      await page.waitForTimeout(500);
    }

    // Should show error
    const lastError = await tid(page, "pr-last-error").textContent();
    expect(lastError).not.toBe("\u2014");
  });

  test("burst 10 sends multiple requests", async ({ page }) => {
    await tid(page, "pr-burst-10").click();
    await page.waitForTimeout(5000);

    const total = await tid(page, "pr-total-requests").textContent();
    expect(Number(total)).toBeGreaterThanOrEqual(10);
  });

  test("reset stats returns to initial state", async ({ page }) => {
    await tid(page, "pr-send").click();
    await page.waitForTimeout(1000);

    await tid(page, "pr-reset").click();
    await page.waitForTimeout(500);

    await expect(tid(page, "pr-total-requests")).toHaveText("0");
    await expect(tid(page, "pr-last-provider")).toHaveText("\u2014");
    await expect(tid(page, "pr-budget-remaining")).toHaveText("$1");
  });

  test("budget decreases after successful request", async ({ page }) => {
    await tid(page, "pr-send").click();
    await page.waitForTimeout(1000);

    const budget = await tid(page, "pr-budget-remaining").textContent();
    // Budget should be less than $1
    const value = Number.parseFloat(budget?.replace("$", "") ?? "1");
    expect(value).toBeLessThan(1);
  });

  test("cheapest available derivation updates", async ({ page }) => {
    // Default cheapest should be ollama
    await expect(tid(page, "pr-cheapest")).toHaveText("ollama");
  });
});
