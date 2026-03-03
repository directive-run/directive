import { expect, test } from "@playwright/test";
import { gotoExample } from "../helpers/example-test.js";

const EXAMPLES = ["sudoku", "checkers"] as const;

for (const name of EXAMPLES) {
  test.describe(`${name} embed`, () => {
    test("custom element mounts without JS errors", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));

      await gotoExample(page, name);

      const el = page.locator(`directive-${name}`);
      await expect(el).toBeAttached();

      expect(errors).toEqual([]);
    });

    test("embed container has content", async ({ page }) => {
      await gotoExample(page, name);

      const el = page.locator(`directive-${name}`);
      const html = await el.innerHTML();
      expect(html.length).toBeGreaterThan(100);
    });

    test("example does not leak styles to host page", async ({ page }) => {
      await gotoExample(page, name);

      // The page heading should use the site's font, not the example's
      const heading = page.locator("h1").first();
      await expect(heading).toBeVisible();

      // Host page body should not have the example's dark background
      const bodyBg = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      // Site uses white/light background in light mode, not #0f172a (rgb(15, 23, 42))
      expect(bodyBg).not.toBe("rgb(15, 23, 42)");
    });
  });
}
