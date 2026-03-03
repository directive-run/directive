import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useExplain", async (_fw, { page }) => {
  // No active requirement → null
  await expect(tid(page, TestIds.explainResult)).toHaveText("null");

  // Trigger load → requirement activates, then resolves
  await tid(page, TestIds.btnTriggerLoad).click();

  // After resolution → status is "done"
  await expect(tid(page, TestIds.factSingle)).toHaveText("done", {
    timeout: 5000,
  });

  await tid(page, TestIds.btnReset).click();
});
