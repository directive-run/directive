import { test, expect } from "@playwright/test";

const GUIDES = [
  {
    slug: "prevent-off-topic-responses",
    title: "Prevent Off-Topic Responses",
  },
  {
    slug: "human-approval-workflows",
    title: "Human Approval Workflows",
  },
  { slug: "control-ai-costs", title: "Control AI Costs" },
  { slug: "customer-support-bot", title: "Customer Support Bot" },
  {
    slug: "validate-structured-output",
    title: "Validate Structured Output",
  },
  { slug: "chatbot-memory", title: "Add Chatbot Memory" },
  { slug: "handle-agent-errors", title: "Handle Agent Errors" },
  {
    slug: "stream-agent-responses",
    title: "Stream Agent Responses",
  },
  { slug: "multi-step-pipeline", title: "Multi-Step Pipeline" },
  {
    slug: "test-agents-without-llm",
    title: "Test Without LLM Calls",
  },
  { slug: "smart-model-routing", title: "Smart Model Routing" },
  { slug: "dag-pipeline", title: "DAG Pipeline" },
  { slug: "self-improving-agents", title: "Self-Improving Agents" },
] as const;

for (const guide of GUIDES) {
  test.describe(guide.slug, () => {
    test("page loads without JS errors", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.goto(`/ai/guides/${guide.slug}`);
      await expect(page.locator("h1")).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("title renders correctly", async ({ page }) => {
      await page.goto(`/ai/guides/${guide.slug}`);
      await expect(page.locator("h1")).toContainText(guide.title);
    });

    test("code blocks render with content", async ({ page }) => {
      await page.goto(`/ai/guides/${guide.slug}`);
      const codeBlocks = page.locator("pre code");
      await expect(codeBlocks.first()).toBeVisible();
      const count = await codeBlocks.count();
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });
}

test("invalid guide slug returns 404", async ({ page }) => {
  const response = await page.goto("/ai/guides/nonexistent-guide");
  expect(response?.status()).toBe(404);
});
