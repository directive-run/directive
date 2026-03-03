import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useOptimisticUpdate", async (_fw, { page }) => {
  // Initial state
  await expect(tid(page, TestIds.optimisticValue)).toHaveText("0");
  await expect(tid(page, TestIds.optimisticPending)).toHaveText("false");
  await expect(tid(page, TestIds.optimisticError)).toHaveText("null");

  // Mutate → isPending true, value updated optimistically
  await tid(page, TestIds.btnMutate).click();
  await expect(tid(page, TestIds.optimisticPending)).toHaveText("true", {
    timeout: 2000,
  });
  await expect(tid(page, TestIds.optimisticValue)).toHaveText("10");

  // After resolution → isPending false
  await expect(tid(page, TestIds.optimisticPending)).toHaveText("false", {
    timeout: 5000,
  });

  // Reset
  await tid(page, TestIds.btnReset).click();
});
