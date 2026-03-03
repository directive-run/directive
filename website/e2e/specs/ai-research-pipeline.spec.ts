import { expect, test } from "@playwright/test";

/**
 * AI Research Pipeline Example E2E Tests
 *
 * Tests the /ai/examples/ai-research-pipeline page which renders an InlineChat
 * panel backed by the 6-agent DAG orchestrator with SSE streaming.
 */
test.describe("AI Research Pipeline Example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/ai/examples/ai-research-pipeline");
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
  });

  test("page loads with header and description", async ({ page }) => {
    await expect(
      page.locator("h1", { hasText: "Research Pipeline" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=6 agents")).toBeVisible();
  });

  test("chat panel renders with input", async ({ page }) => {
    await expect(page.locator("text=Research Pipeline")).toBeVisible({
      timeout: 10_000,
    });
    const input = page.locator(
      "input[placeholder='Enter a research topic...']",
    );
    await expect(input).toBeVisible();
  });

  test("example prompt buttons are present", async ({ page }) => {
    await expect(
      page.locator("button", {
        hasText: "Research the impact of AI on healthcare",
      }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("DAG devtools snapshot endpoint returns JSON", async ({ page }) => {
    const response = await page.request.get("/api/dag-devtools/snapshot");
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
