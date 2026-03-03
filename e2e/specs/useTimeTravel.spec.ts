import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useTimeTravel", async (_fw, { page }) => {
  // Time-travel is enabled
  await expect(tid(page, TestIds.timeTravelEnabled)).toHaveText("true");

  // Initial state: can't undo/redo
  await expect(tid(page, TestIds.timeTravelCanUndo)).toHaveText("false");
  await expect(tid(page, TestIds.timeTravelCanRedo)).toHaveText("false");

  // Increment to create snapshots
  await tid(page, TestIds.btnIncrement).click();
  await expect(tid(page, TestIds.factSingle)).toHaveText("1");

  // Can now undo
  await expect(tid(page, TestIds.timeTravelCanUndo)).toHaveText("true", {
    timeout: 2000,
  });

  // Undo restores previous count
  await tid(page, TestIds.btnUndo).click();
  await expect(tid(page, TestIds.factSingle)).toHaveText("0", {
    timeout: 2000,
  });

  // Can now redo
  await expect(tid(page, TestIds.timeTravelCanRedo)).toHaveText("true", {
    timeout: 2000,
  });

  // Redo goes forward
  await tid(page, TestIds.btnRedo).click();
  await expect(tid(page, TestIds.factSingle)).toHaveText("1", {
    timeout: 2000,
  });
});
