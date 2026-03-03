import { type Page, test as base } from "@playwright/test";

/** Framework config for parametrized tests */
export interface FrameworkConfig {
  name: string;
  port: number;
}

export const FRAMEWORKS: FrameworkConfig[] = [
  { name: "react", port: 4001 },
  { name: "vue", port: 4002 },
  { name: "svelte", port: 4003 },
  { name: "solid", port: 4004 },
  { name: "lit", port: 4005 },
];

/** Build URL for a specific framework + hook route */
export function hookUrl(port: number, hook: string): string {
  return `http://localhost:${port}/#/${hook}`;
}

/** Get a locator by data-testid, piercing shadow DOM for Lit */
export function tid(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]`);
}

/** Create parametrized test for each framework */
export function forEachFramework(
  hookName: string,
  fn: (fw: FrameworkConfig, options: { page: Page }) => Promise<void>,
) {
  for (const fw of FRAMEWORKS) {
    base(`${hookName} [${fw.name}]`, async ({ page }) => {
      await page.goto(hookUrl(fw.port, hookName));
      await page.waitForSelector("[data-testid]", { timeout: 5000 });
      await fn(fw, { page });
    });
  }
}
