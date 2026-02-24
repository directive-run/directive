import { test, expect } from "@playwright/test";
import { tid } from "../helpers/example-test.js";

test.describe("Time Machine example", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/examples/time-machine");
    try {
      await page.waitForSelector("directive-time-machine", { state: "attached", timeout: 30_000 });
    } catch {
      await page.reload();
      await page.waitForSelector("directive-time-machine", { state: "attached", timeout: 30_000 });
    }
    await page.waitForSelector("[data-time-machine-ready]", { timeout: 15_000 });
  });

  test("page loads and UI renders", async ({ page }) => {
    await expect(tid(page, "tm-canvas")).toBeVisible();
    await expect(tid(page, "tm-undo")).toBeVisible();
    await expect(tid(page, "tm-redo")).toBeVisible();
    await expect(tid(page, "tm-timeline")).toBeVisible();
  });

  test("drawing on canvas creates strokes and snapshots", async ({ page }) => {
    const canvas = tid(page, "tm-canvas");
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error("Canvas not found");
    }

    // Draw a stroke
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 150, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Stroke count should increase
    const strokeCount = await tid(page, "tm-stroke-count").textContent();
    expect(Number(strokeCount)).toBeGreaterThan(0);

    // Total snapshots should increase
    const snapshots = await tid(page, "tm-total-snapshots").textContent();
    expect(Number(snapshots)).toBeGreaterThan(0);
  });

  test("undo removes last stroke", async ({ page }) => {
    const canvas = tid(page, "tm-canvas");
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error("Canvas not found");
    }

    // Draw 2 strokes
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 100, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    await page.mouse.move(box.x + 150, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 100, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const beforeCount = await tid(page, "tm-stroke-count").textContent();

    // Undo
    await tid(page, "tm-undo").click();
    await page.waitForTimeout(500);

    const afterCount = await tid(page, "tm-stroke-count").textContent();
    expect(Number(afterCount)).toBeLessThan(Number(beforeCount));
  });

  test("redo restores undone stroke", async ({ page }) => {
    const canvas = tid(page, "tm-canvas");
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error("Canvas not found");
    }

    // Draw a stroke
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 100, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Undo
    await tid(page, "tm-undo").click();
    await page.waitForTimeout(300);
    const undoneCount = await tid(page, "tm-stroke-count").textContent();

    // Redo
    await tid(page, "tm-redo").click();
    await page.waitForTimeout(300);
    const redoneCount = await tid(page, "tm-stroke-count").textContent();

    expect(Number(redoneCount)).toBeGreaterThan(Number(undoneCount));
  });

  test("export produces valid JSON", async ({ page }) => {
    const canvas = tid(page, "tm-canvas");
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error("Canvas not found");
    }

    // Draw a stroke
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 100, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Export
    await tid(page, "tm-export").click();
    await page.waitForTimeout(300);

    const exportText = await tid(page, "tm-export-area").inputValue();
    expect(exportText.length).toBeGreaterThan(0);

    // Should be valid JSON
    const parsed = JSON.parse(exportText);
    expect(parsed).toBeDefined();
  });

  test("import restores exported state", async ({ page }) => {
    const canvas = tid(page, "tm-canvas");
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error("Canvas not found");
    }

    // Draw a stroke
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 100, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Export
    await tid(page, "tm-export").click();
    await page.waitForTimeout(300);
    const exportText = await tid(page, "tm-export-area").inputValue();

    // Clear
    await tid(page, "tm-clear").click();
    await page.waitForTimeout(300);
    await expect(tid(page, "tm-stroke-count")).toHaveText("0");

    // Import
    await tid(page, "tm-export-area").fill(exportText);
    await tid(page, "tm-import").click();
    await page.waitForTimeout(500);

    const restoredCount = await tid(page, "tm-stroke-count").textContent();
    expect(Number(restoredCount)).toBeGreaterThan(0);
  });

  test("changeset groups strokes for single undo", async ({ page }) => {
    const canvas = tid(page, "tm-canvas");
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error("Canvas not found");
    }

    // Begin changeset
    await tid(page, "tm-begin-changeset").click();
    await page.waitForTimeout(200);

    // Draw 3 strokes
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(box.x + 30 + i * 50, box.y + 50);
      await page.mouse.down();
      await page.mouse.move(box.x + 60 + i * 50, box.y + 100, { steps: 3 });
      await page.mouse.up();
      await page.waitForTimeout(200);
    }

    // End changeset
    await tid(page, "tm-end-changeset").click();
    await page.waitForTimeout(300);

    const beforeUndo = await tid(page, "tm-stroke-count").textContent();
    expect(Number(beforeUndo)).toBe(3);

    // Single undo should remove all 3
    await tid(page, "tm-undo").click();
    await page.waitForTimeout(500);

    const afterUndo = await tid(page, "tm-stroke-count").textContent();
    expect(Number(afterUndo)).toBe(0);
  });

  test("clear resets canvas and state", async ({ page }) => {
    const canvas = tid(page, "tm-canvas");
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error("Canvas not found");
    }

    // Draw
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 100, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    await tid(page, "tm-clear").click();
    await page.waitForTimeout(500);

    await expect(tid(page, "tm-stroke-count")).toHaveText("0");
  });

  test("replay plays back strokes", async ({ page }) => {
    const canvas = tid(page, "tm-canvas");
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error("Canvas not found");
    }

    // Draw 2 strokes
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 100, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    await page.mouse.move(box.x + 150, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 100, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Replay
    await tid(page, "tm-replay").click();

    // Timeline should show replay event
    await expect(tid(page, "tm-timeline").locator(".tm-timeline-entry")).toBeVisible({ timeout: 10_000 });
  });
});
