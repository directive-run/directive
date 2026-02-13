import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useInspect", async (_fw, { page }) => {
  // Initially settled
  await expect(tid(page, TestIds.inspectSettled)).toHaveText("true");
  await expect(tid(page, TestIds.inspectWorking)).toHaveText("false");

  // Trigger load → isWorking becomes true
  await tid(page, TestIds.btnTriggerLoad).click();
  await expect(tid(page, TestIds.inspectWorking)).toHaveText("true", { timeout: 2000 });

  // After resolution → returns to settled
  await expect(tid(page, TestIds.inspectSettled)).toHaveText("true", { timeout: 5000 });
  await expect(tid(page, TestIds.inspectWorking)).toHaveText("false", { timeout: 5000 });

  // Reset for next test
  await tid(page, TestIds.btnReset).click();
});
