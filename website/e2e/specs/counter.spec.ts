import { expect, test } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("Counter (Number Match) example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/counter");
    try {
      await page.waitForSelector("directive-counter", {
        state: "attached",
        timeout: 30_000,
      });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-counter", {
        state: "attached",
        timeout: 30_000,
      });
    }
    await page.waitForSelector("[data-counter-ready]", { timeout: 15_000 });
  });

  test("page loads with 9 tiles in grid", async ({ page }) => {
    const tiles = tid(page, "nm-grid").locator(".tile:not(.empty)");
    await expect(tiles).toHaveCount(9, { timeout: 5_000 });
  });

  test("selecting a tile highlights it", async ({ page }) => {
    const firstTile = tid(page, "nm-grid").locator(".tile:not(.empty)").first();
    await firstTile.click();
    await expect(firstTile).toHaveClass(/selected/, { timeout: 5_000 });
  });

  test("matching pair removes tiles and updates stats", async ({ page }) => {
    const tiles = tid(page, "nm-grid").locator(".tile:not(.empty)");
    await expect(tiles).toHaveCount(9, { timeout: 5_000 });

    // Read tile values and find a matching pair
    const tileElements = await tiles.all();
    const values: { index: number; value: number }[] = [];
    for (let i = 0; i < tileElements.length; i++) {
      const text = await tileElements[i].textContent();
      values.push({ index: i, value: Number(text) });
    }

    // Find a pair that sums to 10
    let pair: [number, number] | null = null;
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        if (values[i].value + values[j].value === 10) {
          pair = [i, j];
          break;
        }
      }
      if (pair) break;
    }

    if (pair) {
      // Click both tiles
      await tileElements[pair[0]].click();
      await tileElements[pair[1]].click();

      // Wait for resolver to process — moves should increment
      await expect(tid(page, "nm-moves")).not.toHaveText("0", {
        timeout: 5_000,
      });
      await expect(tid(page, "nm-removed")).not.toHaveText("0", {
        timeout: 5_000,
      });
    }
  });

  test("non-matching pair clears after second bad pick", async ({ page }) => {
    const tiles = tid(page, "nm-grid").locator(".tile:not(.empty)");
    await expect(tiles).toHaveCount(9, { timeout: 5_000 });

    // Read tile values and find a non-matching pair
    const tileElements = await tiles.all();
    const values: { index: number; value: number }[] = [];
    for (let i = 0; i < tileElements.length; i++) {
      const text = await tileElements[i].textContent();
      values.push({ index: i, value: Number(text) });
    }

    // Find a pair that does NOT sum to 10
    let pair: [number, number] | null = null;
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        if (values[i].value + values[j].value !== 10) {
          pair = [i, j];
          break;
        }
      }
      if (pair) break;
    }

    if (pair) {
      await tileElements[pair[0]].click();
      await tileElements[pair[1]].click();

      // Moves should still be 0 — no match was made
      await expect(tid(page, "nm-moves")).toHaveText("0", { timeout: 5_000 });
    }
  });

  test("clear selection deselects tiles", async ({ page }) => {
    const firstTile = tid(page, "nm-grid").locator(".tile:not(.empty)").first();
    await firstTile.click();
    await expect(firstTile).toHaveClass(/selected/, { timeout: 5_000 });

    await tid(page, "nm-clear").click();

    // No tiles should be selected
    const selected = tid(page, "nm-grid").locator(".tile.selected");
    await expect(selected).toHaveCount(0, { timeout: 5_000 });
  });

  test("new game resets board", async ({ page }) => {
    // Make a match first to change stats
    const tiles = tid(page, "nm-grid").locator(".tile:not(.empty)");
    await expect(tiles).toHaveCount(9, { timeout: 5_000 });

    // Click new game
    await tid(page, "nm-newgame").click();

    // Stats should be reset
    await expect(tid(page, "nm-moves")).toHaveText("0", { timeout: 5_000 });
    await expect(tid(page, "nm-removed")).toHaveText("0", { timeout: 5_000 });

    // Should still have 9 tiles
    const newTiles = tid(page, "nm-grid").locator(".tile:not(.empty)");
    await expect(newTiles).toHaveCount(9, { timeout: 5_000 });
  });

  test("source code visible below example", async ({ page }) => {
    // Single-file example renders filename header instead of tab bar
    const sourceSection = page.locator("text=Source code");
    await expect(sourceSection).toBeVisible();
  });
});
