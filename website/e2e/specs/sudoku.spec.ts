import { test, expect } from "@playwright/test";
import { gotoExample, tid } from "../helpers/example-test.js";

test.describe("Sudoku example", () => {
  test.beforeEach(async ({ page }) => {
    await gotoExample(page, "sudoku");
  });

  test("page loads and grid renders 81 cells", async ({ page }) => {
    const grid = tid(page, "sudoku-grid");
    await expect(grid).toBeVisible();

    const cells = page.locator("[data-testid^='sudoku-cell-']");
    await expect(cells).toHaveCount(81);
  });

  test("selecting a cell highlights it", async ({ page }) => {
    const cell = tid(page, "sudoku-cell-40");
    await cell.click();
    await expect(cell).toHaveClass(/selected/);
  });

  test("numpad buttons are visible", async ({ page }) => {
    for (let d = 1; d <= 9; d++) {
      await expect(tid(page, `sudoku-num-${d}`)).toBeVisible();
    }
    await expect(tid(page, "sudoku-num-0")).toBeVisible();
  });

  test("notes toggle activates notes mode", async ({ page }) => {
    const toggle = tid(page, "sudoku-notes-toggle");
    await toggle.click();
    await expect(toggle).toHaveClass(/notes-active/);
  });

  test("difficulty buttons switch mode", async ({ page }) => {
    const medium = tid(page, "sudoku-mode-medium");
    await medium.click();
    await expect(medium).toHaveClass(/active/);
    await expect(tid(page, "sudoku-mode-easy")).not.toHaveClass(/active/);
  });

  test("new game button resets the grid", async ({ page }) => {
    const newGame = tid(page, "sudoku-new-game");
    await newGame.click();

    // Grid should still have 81 cells after reset
    const cells = page.locator("[data-testid^='sudoku-cell-']");
    await expect(cells).toHaveCount(81);
  });

  test("code tabs are visible below the example", async ({ page }) => {
    const codeTabs = page.locator("[data-testid='code-tabs-bar']");
    await expect(codeTabs).toBeVisible();
  });
});
