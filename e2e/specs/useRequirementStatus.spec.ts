import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useRequirementStatus", async (_fw, { page }) => {
  // Initially not loading
  await expect(tid(page, TestIds.reqStatusLoading)).toHaveText("false");

  // Trigger load → isLoading becomes true
  await tid(page, TestIds.btnTriggerLoad).click();
  await expect(tid(page, TestIds.reqStatusLoading)).toHaveText("true", { timeout: 2000 });

  // After resolution → isLoading false
  await expect(tid(page, TestIds.reqStatusLoading)).toHaveText("false", { timeout: 5000 });
  await expect(tid(page, TestIds.factSingle)).toHaveText("done", { timeout: 5000 });

  // Reset
  await tid(page, TestIds.btnReset).click();
});
