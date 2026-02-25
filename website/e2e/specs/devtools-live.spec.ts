import { test, expect } from "@playwright/test";

/**
 * AI Chat Example E2E Tests
 *
 * Tests the /ai/examples/ai-chat page which renders an InlineChat
 * panel backed by the single-agent orchestrator with SSE streaming.
 */
test.describe("AI Chat Example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/ai/examples/ai-chat");
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
  });

  test("page loads with header and description", async ({ page }) => {
    await expect(page.locator("h1", { hasText: "AI Chat" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Send a message below")).toBeVisible();
  });

  test("chat panel renders with input", async ({ page }) => {
    await expect(page.locator("text=Directive AI")).toBeVisible({ timeout: 10_000 });
    const input = page.locator("input[placeholder='Ask about Directive...']");
    await expect(input).toBeVisible();
  });

  test("example prompt buttons are present", async ({ page }) => {
    await expect(page.locator("button", { hasText: "Tell me about Directive" })).toBeVisible({ timeout: 10_000 });
  });

  test("snapshot endpoint returns JSON", async ({ page }) => {
    const response = await page.request.get("/api/devtools/snapshot");
    expect([200, 503]).toContain(response.status());
    const json = await response.json();
    expect(json).toBeDefined();

    if (response.status() === 503) {
      expect(json.error).toBeDefined();
    } else {
      expect(json.timestamp).toBeDefined();
      expect(json.eventCount).toBeDefined();
    }
  });
});
