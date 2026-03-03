import { expect, test } from "@playwright/test";
import { gotoExample, tid } from "../helpers/example-test.js";

test.describe("Checkers example", () => {
  test.beforeEach(async ({ page }) => {
    await gotoExample(page, "checkers");
  });

  test("page loads and board renders 64 squares", async ({ page }) => {
    const board = tid(page, "checkers-board");
    await expect(board).toBeVisible();

    const squares = page.locator("[data-testid^='checkers-square-']");
    await expect(squares).toHaveCount(64);
  });

  test("clicking a dark square with a piece selects it", async ({ page }) => {
    // Red pieces start on dark squares in the first 3 rows
    // Row 0 col 1 = index 1 (dark square with red piece)
    const square = tid(page, "checkers-square-1");
    await square.click();
    await expect(square).toHaveClass(/selected/);
  });

  test("mode toggle buttons work", async ({ page }) => {
    const computer = tid(page, "checkers-mode-computer");
    await computer.click();
    await expect(computer).toHaveClass(/active/);
    await expect(tid(page, "checkers-mode-2p")).not.toHaveClass(/active/);
  });

  test("new game button resets the board", async ({ page }) => {
    const newGame = tid(page, "checkers-new-game");
    await newGame.click();

    const squares = page.locator("[data-testid^='checkers-square-']");
    await expect(squares).toHaveCount(64);
  });

  test("message bar is visible", async ({ page }) => {
    const message = tid(page, "checkers-message");
    await expect(message).toBeVisible();
    await expect(message).not.toBeEmpty();
  });
});
