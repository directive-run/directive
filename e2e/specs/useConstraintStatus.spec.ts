import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useConstraintStatus", async (_fw, { page }) => {
  // Has at least 1 constraint defined
  const count = await tid(page, TestIds.constraintList).textContent();
  expect(Number(count)).toBeGreaterThanOrEqual(1);

  // Initially no active constraints (status is idle, not loading)
  await expect(tid(page, TestIds.constraintActive)).toHaveText("0");

  // Trigger load → constraint becomes active, then resolves
  await tid(page, TestIds.btnTriggerLoad).click();

  // After resolution, status becomes "done" and constraint deactivates
  await expect(tid(page, TestIds.factSingle)).toHaveText("done", { timeout: 5000 });
  await expect(tid(page, TestIds.constraintActive)).toHaveText("0", { timeout: 2000 });

  await tid(page, TestIds.btnReset).click();
});
