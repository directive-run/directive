import { test, expect } from "@playwright/test";

test.describe("Pitch Deck example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/ai/examples/pitch-deck");
  });

  test("page loads with header", async ({ page }) => {
    await expect(page.locator("h1")).toHaveText("Startup Pitch Deck");
  });

  test("InlineChat renders with correct placeholder", async ({ page }) => {
    const input = page.locator('textarea[placeholder="Describe your startup idea..."]');
    await expect(input).toBeVisible({ timeout: 15_000 });
  });

  test("example prompt buttons are present", async ({ page }) => {
    await expect(page.getByText("An AI-powered personal stylist app")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("A marketplace for local farm-to-table produce")).toBeVisible();
    await expect(page.getByText("A SaaS tool that automates legal contract review")).toBeVisible();
  });

  test("DevTools snapshot endpoint returns JSON", async ({ request }) => {
    const response = await request.get("/api/pitch-deck-devtools/snapshot");
    // 200 if orchestrator is active, 503 if not yet started — both are valid JSON
    expect([200, 503]).toContain(response.status());
    const body = await response.json();
    expect(body).toBeDefined();
  });
});
