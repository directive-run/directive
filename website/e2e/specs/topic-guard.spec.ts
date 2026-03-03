import { expect, test } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

/**
 * Helper: type text into the input and wait for the send button to enable.
 * Uses page.evaluate to directly set value and fire input event in page context.
 */
async function typeMessage(
  page: import("@playwright/test").Page,
  text: string,
) {
  await page.evaluate((t) => {
    const input = document.querySelector(
      '[data-testid="topic-guard-input"]',
    ) as HTMLInputElement;
    input.value = t;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await expect(tid(page, "topic-guard-send-btn")).toBeEnabled({
    timeout: 5000,
  });
}

test.describe("Topic Guard example", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/topic-guard");
    // Dev server may need extra time when parallel workers compile simultaneously
    await page.waitForSelector("directive-topic-guard", {
      state: "attached",
      timeout: 30_000,
    });
    // Wait for the module script to fully initialize
    await page.waitForSelector("[data-topic-guard-ready]", { timeout: 15_000 });
  });

  test("page loads and UI renders", async ({ page }) => {
    await expect(tid(page, "topic-guard-input")).toBeVisible();
    await expect(tid(page, "topic-guard-send-btn")).toBeVisible();
    await expect(tid(page, "topic-guard-messages")).toBeVisible();
  });

  test("send button is disabled when input is empty", async ({ page }) => {
    await expect(tid(page, "topic-guard-send-btn")).toBeDisabled();
  });

  test("on-topic message is allowed", async ({ page }) => {
    await typeMessage(page, "How do I reset my password?");
    await tid(page, "topic-guard-send-btn").click();

    // Should see user message + agent response (not blocked)
    const messages = page.locator("[data-testid^='topic-guard-message-']");
    await expect(messages.first()).toBeVisible();
    await expect(messages.first()).not.toHaveClass(/blocked/);

    // Stats should update
    await expect(tid(page, "topic-guard-allowed-count")).toContainText("1");
  });

  test("off-topic message is blocked", async ({ page }) => {
    await typeMessage(page, "How do I make pasta?");
    await tid(page, "topic-guard-send-btn").click();

    // User message should be marked blocked
    const userMsg = page.locator("[data-testid='topic-guard-message-0']");
    await expect(userMsg).toBeVisible();
    await expect(userMsg).toHaveClass(/blocked/);
    await expect(tid(page, "topic-guard-blocked-count")).toContainText("1");
  });

  test("guardrail log updates on each message", async ({ page }) => {
    await typeMessage(page, "Tell me about the election");
    await tid(page, "topic-guard-send-btn").click();

    const logEntries = tid(page, "topic-guard-log").locator(".tg-log-entry");
    await expect(logEntries).toHaveCount(1);
  });

  test("block rate updates correctly", async ({ page }) => {
    // Send one allowed
    await typeMessage(page, "What is my billing status?");
    await tid(page, "topic-guard-send-btn").click();
    await expect(tid(page, "topic-guard-block-rate")).toContainText("0%");

    // Send one blocked
    await typeMessage(page, "Who won the NBA game?");
    await tid(page, "topic-guard-send-btn").click();
    await expect(tid(page, "topic-guard-block-rate")).toContainText("50%");
  });

  test("clear button resets chat", async ({ page }) => {
    await typeMessage(page, "Hello there");
    await tid(page, "topic-guard-send-btn").click();

    // Wait for message to appear
    await expect(
      page.locator("[data-testid^='topic-guard-message-']").first(),
    ).toBeVisible();

    await tid(page, "topic-guard-clear-btn").click();

    const msgs = page.locator("[data-testid^='topic-guard-message-']");
    await expect(msgs).toHaveCount(0);
  });

  test("example chips fill input", async ({ page }) => {
    const chip = page
      .locator("[data-testid^='topic-guard-example-chip-']")
      .first();
    await chip.click();
    const inputVal = await tid(page, "topic-guard-input").inputValue();
    expect(inputVal.length).toBeGreaterThan(0);
  });

  test("code tabs are visible below the example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
