import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useHistory", async (_fw, { page }) => {
  // History is enabled
  await expect(tid(page, TestIds.historyEnabled)).toHaveText("true");

  // Initial state: can't undo/redo
  await expect(tid(page, TestIds.historyCanUndo)).toHaveText("false");
  await expect(tid(page, TestIds.historyCanRedo)).toHaveText("false");

  // Increment to create snapshots
  await tid(page, TestIds.btnIncrement).click();
  await expect(tid(page, TestIds.factSingle)).toHaveText("1");

  // Can now undo
  await expect(tid(page, TestIds.historyCanUndo)).toHaveText("true", {
    timeout: 2000,
  });

  // Undo restores previous count
  await tid(page, TestIds.btnUndo).click();
  await expect(tid(page, TestIds.factSingle)).toHaveText("0", {
    timeout: 2000,
  });

  // Can now redo
  await expect(tid(page, TestIds.historyCanRedo)).toHaveText("true", {
    timeout: 2000,
  });

  // Redo goes forward
  await tid(page, TestIds.btnRedo).click();
  await expect(tid(page, TestIds.factSingle)).toHaveText("1", {
    timeout: 2000,
  });
});
