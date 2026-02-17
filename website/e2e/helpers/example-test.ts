import type { Page, Locator } from "@playwright/test";

/**
 * Navigate to an example page and wait for the custom element to mount.
 */
export async function gotoExample(page: Page, name: string): Promise<void> {
  await page.goto(`/docs/examples/${name}`);
  await page.waitForSelector(`directive-${name}`, { state: "attached", timeout: 15_000 });
}

/**
 * Shorthand for locating an element by data-testid within the page.
 */
export function tid(page: Page, testId: string): Locator {
  return page.locator(`[data-testid="${testId}"]`);
}
