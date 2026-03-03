import { expect, test } from "@playwright/test";

/**
 * DevTools verification across all example pages.
 *
 * For each page:
 * 1. Navigate and wait for the custom element to mount
 * 2. Verify window.__DIRECTIVE__ exists
 * 3. Verify getSystems() returns the expected system name
 * 4. Verify inspect() returns fact data
 * 5. Verify the FloatingFab button is visible (docs layout wraps all examples)
 */

interface ExampleSpec {
  url: string;
  tag: string;
  systemName: string;
  readySelector?: string;
}

const EXAMPLES: ExampleSpec[] = [
  {
    url: "/docs/examples/counter",
    tag: "directive-counter",
    systemName: "number-match",
  },
  {
    url: "/docs/examples/shopping-cart",
    tag: "directive-shopping-cart",
    systemName: "shopping-cart",
    readySelector: "[data-shopping-cart-ready]",
  },
  {
    url: "/docs/examples/auth-flow",
    tag: "directive-auth-flow",
    systemName: "auth-flow",
  },
  {
    url: "/docs/examples/contact-form",
    tag: "directive-contact-form",
    systemName: "contact-form",
  },
  {
    url: "/docs/examples/form-wizard",
    tag: "directive-form-wizard",
    systemName: "form-wizard",
  },
  {
    url: "/docs/examples/notifications",
    tag: "directive-notifications",
    systemName: "notifications",
  },
  {
    url: "/docs/examples/permissions",
    tag: "directive-permissions",
    systemName: "permissions",
  },
  {
    url: "/docs/examples/url-sync",
    tag: "directive-url-sync",
    systemName: "url-sync",
  },
  {
    url: "/docs/examples/pagination",
    tag: "directive-pagination",
    systemName: "pagination",
  },
  {
    url: "/docs/examples/optimistic-updates",
    tag: "directive-optimistic-updates",
    systemName: "optimistic-updates",
  },
  {
    url: "/docs/examples/debounce-constraints",
    tag: "directive-debounce-constraints",
    systemName: "debounce-constraints",
  },
  {
    url: "/docs/examples/dynamic-modules",
    tag: "directive-dynamic-modules",
    systemName: "dynamic-modules",
  },
  {
    url: "/docs/examples/batch-resolver",
    tag: "directive-batch-resolver",
    systemName: "batch-resolver",
  },
  {
    url: "/docs/examples/async-chains",
    tag: "directive-async-chains",
    systemName: "async-chains",
  },
  {
    url: "/docs/examples/error-boundaries",
    tag: "directive-error-boundaries",
    systemName: "error-boundaries",
  },
  {
    url: "/docs/examples/ab-testing",
    tag: "directive-ab-testing",
    systemName: "ab-testing",
  },
  {
    url: "/docs/examples/theme-locale",
    tag: "directive-theme-locale",
    systemName: "theme-locale",
  },
  {
    url: "/docs/examples/time-machine",
    tag: "directive-time-machine",
    systemName: "time-machine",
  },
  {
    url: "/docs/examples/websocket",
    tag: "directive-websocket",
    systemName: "websocket",
  },
  {
    url: "/docs/examples/dashboard-loader",
    tag: "directive-dashboard-loader",
    systemName: "dashboard-loader",
  },
  {
    url: "/docs/examples/feature-flags",
    tag: "directive-feature-flags",
    systemName: "feature-flags",
  },
  {
    url: "/docs/examples/sudoku",
    tag: "directive-sudoku",
    systemName: "sudoku",
  },
  {
    url: "/docs/examples/checkers",
    tag: "directive-checkers",
    systemName: "checkers",
  },
  {
    url: "/docs/examples/topic-guard",
    tag: "directive-topic-guard",
    systemName: "topic-guard",
  },
  {
    url: "/docs/examples/ai-guardrails",
    tag: "directive-ai-guardrails",
    systemName: "ai-guardrails",
  },
  {
    url: "/docs/examples/ai-checkpoint",
    tag: "directive-ai-checkpoint",
    systemName: "ai-checkpoint",
  },
  {
    url: "/docs/examples/fraud-analysis",
    tag: "directive-fraud-analysis",
    systemName: "fraud-analysis",
  },
  {
    url: "/docs/examples/provider-routing",
    tag: "directive-provider-routing",
    systemName: "provider-routing",
  },
];

test.describe("DevTools on all example pages", () => {
  test.describe.configure({ timeout: 60_000 });

  for (const example of EXAMPLES) {
    test(`${example.systemName}: devtools registered`, async ({ page }) => {
      await page.goto(example.url);

      // Wait for the custom element to mount
      try {
        await page.waitForSelector(example.tag, {
          state: "attached",
          timeout: 30_000,
        });
      } catch {
        await page.reload();
        await page.waitForSelector(example.tag, {
          state: "attached",
          timeout: 30_000,
        });
      }

      // Wait for ready selector if specified
      if (example.readySelector) {
        await page.waitForSelector(example.readySelector, { timeout: 15_000 });
      }

      // Wait briefly for devtools plugin to register
      await page.waitForFunction(
        () =>
          typeof window.__DIRECTIVE__ === "object" &&
          window.__DIRECTIVE__ !== null,
        { timeout: 15_000 },
      );

      // Verify getSystems() includes the expected system name
      const systems = await page.evaluate(
        () => window.__DIRECTIVE__?.getSystems() ?? [],
      );
      expect(systems).toContain(example.systemName);

      // Verify inspect() returns constraint/requirement data
      const inspection = await page.evaluate((name) => {
        const result = window.__DIRECTIVE__?.inspect(name) as
          | Record<string, unknown>
          | undefined;
        if (!result) return null;
        return {
          hasUnmet: Array.isArray(result.unmet),
          hasInflight: Array.isArray(result.inflight),
          hasConstraints: Array.isArray(result.constraints),
        };
      }, example.systemName);

      expect(inspection).not.toBeNull();
      expect(inspection!.hasUnmet).toBe(true);
      expect(inspection!.hasInflight).toBe(true);
    });
  }
});

test.describe("DevTools FloatingFab on example pages", () => {
  test.describe.configure({ timeout: 60_000 });

  // Spot-check FloatingFab on 3 representative pages
  const SPOT_CHECK = [EXAMPLES[0], EXAMPLES[1], EXAMPLES[24]]; // counter, shopping-cart, ai-guardrails

  for (const example of SPOT_CHECK) {
    test(`${example.systemName}: FloatingFab visible`, async ({ page }) => {
      await page.goto(example.url);
      await page.waitForSelector(example.tag, {
        state: "attached",
        timeout: 30_000,
      });

      if (example.readySelector) {
        await page.waitForSelector(example.readySelector, { timeout: 15_000 });
      }

      // The FloatingFab should be rendered by the docs layout
      // aria-label is "Open DevTools (Connected)" or similar
      const fab = page.locator("button[aria-label^='Open DevTools']");
      await expect(fab).toBeVisible({ timeout: 15_000 });
    });
  }
});

test.describe("Multi-system DevTools page", () => {
  test.describe.configure({ timeout: 60_000 });

  test("registers both systems", async ({ page }) => {
    await page.goto("/docs/examples/multi-system-devtools");

    // Wait for both custom elements
    await page.waitForSelector("directive-counter", {
      state: "attached",
      timeout: 30_000,
    });
    await page.waitForSelector("directive-shopping-cart", {
      state: "attached",
      timeout: 30_000,
    });

    // Wait for devtools registration
    await page.waitForFunction(
      () => {
        const systems = window.__DIRECTIVE__?.getSystems() ?? [];
        return (
          systems.includes("number-match") && systems.includes("shopping-cart")
        );
      },
      { timeout: 15_000 },
    );

    const systems = await page.evaluate(
      () => window.__DIRECTIVE__?.getSystems() ?? [],
    );
    expect(systems).toContain("number-match");
    expect(systems).toContain("shopping-cart");
    expect(systems.length).toBeGreaterThanOrEqual(2);
  });

  test("can inspect both systems independently", async ({ page }) => {
    await page.goto("/docs/examples/multi-system-devtools");
    await page.waitForSelector("directive-counter", {
      state: "attached",
      timeout: 30_000,
    });
    await page.waitForSelector("directive-shopping-cart", {
      state: "attached",
      timeout: 30_000,
    });

    await page.waitForFunction(
      () => {
        const systems = window.__DIRECTIVE__?.getSystems() ?? [];
        return (
          systems.includes("number-match") && systems.includes("shopping-cart")
        );
      },
      { timeout: 15_000 },
    );

    // Inspect counter
    const counterInspection = await page.evaluate(() => {
      const result = window.__DIRECTIVE__?.inspect("number-match") as
        | Record<string, unknown>
        | undefined;
      return (
        result !== null &&
        result !== undefined &&
        Array.isArray(result.constraints)
      );
    });
    expect(counterInspection).toBe(true);

    // Inspect shopping cart
    const cartInspection = await page.evaluate(() => {
      const result = window.__DIRECTIVE__?.inspect("shopping-cart") as
        | Record<string, unknown>
        | undefined;
      return (
        result !== null &&
        result !== undefined &&
        Array.isArray(result.constraints)
      );
    });
    expect(cartInspection).toBe(true);
  });
});

test.describe("Mixed DevTools page", () => {
  test.describe.configure({ timeout: 60_000 });

  test("registers all three systems", async ({ page }) => {
    await page.goto("/docs/examples/mixed-devtools");

    // Wait for all custom elements
    await page.waitForSelector("directive-counter", {
      state: "attached",
      timeout: 30_000,
    });
    await page.waitForSelector("directive-ai-guardrails", {
      state: "attached",
      timeout: 30_000,
    });
    await page.waitForSelector("directive-fraud-analysis", {
      state: "attached",
      timeout: 30_000,
    });

    // Wait for all three systems to register
    await page.waitForFunction(
      () => {
        const systems = window.__DIRECTIVE__?.getSystems() ?? [];
        return (
          systems.includes("number-match") &&
          systems.includes("ai-guardrails") &&
          systems.includes("fraud-analysis")
        );
      },
      { timeout: 15_000 },
    );

    const systems = await page.evaluate(
      () => window.__DIRECTIVE__?.getSystems() ?? [],
    );
    expect(systems).toContain("number-match");
    expect(systems).toContain("ai-guardrails");
    expect(systems).toContain("fraud-analysis");
    expect(systems.length).toBeGreaterThanOrEqual(3);
  });
});
