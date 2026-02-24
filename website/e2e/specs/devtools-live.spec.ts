import { test, expect } from "@playwright/test";

/**
 * AI DevTools Live Demo E2E Tests
 *
 * Tests the /devtools page which has a split layout with
 * LiveDevTools (SSE consumer) and an inline chat panel.
 */
test.describe("AI DevTools Live Demo", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/devtools");
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
  });

  test("page loads with header and description", async ({ page }) => {
    await expect(page.locator("h1", { hasText: "DevTools" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Send a message below")).toBeVisible();
  });

  test("DevTools panel renders with view tabs", async ({ page }) => {
    const timelineTab = page.getByRole("tab", { name: "Timeline" });
    await expect(timelineTab).toBeVisible({ timeout: 10_000 });

    const costTab = page.getByRole("tab", { name: "Cost" });
    await expect(costTab).toBeVisible();

    const stateTab = page.getByRole("tab", { name: "State" });
    await expect(stateTab).toBeVisible();
  });

  test("Timeline view shows waiting state or events", async ({ page }) => {
    const timelineTab = page.getByRole("tab", { name: "Timeline" });
    await expect(timelineTab).toBeVisible({ timeout: 10_000 });

    const content = page.locator("text=Waiting for first message").or(page.locator("text=agent"));
    await expect(content.first()).toBeVisible({ timeout: 15_000 });
  });

  test("switching to Cost view shows content", async ({ page }) => {
    // Wait for React hydration by checking the tabpanel role attribute exists
    // (ARIA attributes are set by client-side React, not SSR)
    const tabpanel = page.locator('[role="tabpanel"]');
    await expect(tabpanel).toBeAttached({ timeout: 10_000 });

    // Click via stable CSS attribute selector
    const costTab = page.locator('button[aria-controls="devtools-tabpanel-cost"]');
    await expect(costTab).toBeVisible({ timeout: 5_000 });

    // Retry click pattern: some dev server HMR cycles can reset state
    await expect(async () => {
      await costTab.click();
      await expect(costTab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });

    // Cost view shows either "No completed agent runs yet" or actual data
    const content = page.locator("text=No completed agent runs yet").or(page.locator("text=Total tokens"));
    await expect(content.first()).toBeVisible({ timeout: 5_000 });
  });

  test("switching to State view shows content", async ({ page }) => {
    const tabpanel = page.locator('[role="tabpanel"]');
    await expect(tabpanel).toBeAttached({ timeout: 10_000 });

    const stateTab = page.locator('button[aria-controls="devtools-tabpanel-state"]');
    await expect(stateTab).toBeVisible({ timeout: 5_000 });

    // Retry click pattern
    await expect(async () => {
      await stateTab.click();
      await expect(stateTab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });

    // State view shows loading, orchestrator data, or an error
    const content = page.locator("text=Loading")
      .or(page.locator("text=Orchestrator not initialized"))
      .or(page.locator("text=Failed to fetch"))
      .or(page.locator("text=eventCount"));
    await expect(content.first()).toBeVisible({ timeout: 5_000 });
  });

  test("connection status indicator is visible", async ({ page }) => {
    const statusText = page.locator("text=Live")
      .or(page.locator("text=Connecting"))
      .or(page.locator("text=Disconnected"))
      .or(page.locator("text=Waiting"));
    await expect(statusText.first()).toBeVisible({ timeout: 15_000 });
  });

  test("chat panel renders with input", async ({ page }) => {
    await expect(page.locator("text=Directive AI")).toBeVisible({ timeout: 10_000 });
    const input = page.locator("input[placeholder='Ask about Directive...']");
    await expect(input).toBeVisible();
  });

  test("example prompt buttons are present", async ({ page }) => {
    await expect(page.locator("button", { hasText: "How do constraints work?" })).toBeVisible({ timeout: 10_000 });
  });

  test("event legend shows event types", async ({ page }) => {
    await expect(page.locator("text=agent_start")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=guardrail_check")).toBeVisible();
    await expect(page.locator("text=agent_complete")).toBeVisible();
  });

  test("footer shows event count and streaming status", async ({ page }) => {
    const footer = page.locator("text=/\\d+ events/");
    await expect(footer).toBeVisible({ timeout: 10_000 });
  });

  test("clear button is present", async ({ page }) => {
    const clearBtn = page.locator("button", { hasText: "Clear" });
    await expect(clearBtn).toBeVisible({ timeout: 10_000 });
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
