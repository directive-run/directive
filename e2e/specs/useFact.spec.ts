import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useFact", async (_fw, { page }) => {
  // Single key renders initial value
  await expect(tid(page, TestIds.factSingle)).toHaveText("0");

  // Multi-key renders initial values
  await expect(tid(page, TestIds.factMulti)).toHaveText("0");
  await expect(tid(page, TestIds.factMultiName)).toHaveText("hello");

  // Single key updates after increment
  await tid(page, TestIds.btnIncrement).click();
  await expect(tid(page, TestIds.factSingle)).toHaveText("1");

  // Multi-key updates reactively
  await expect(tid(page, TestIds.factMulti)).toHaveText("1");

  // Name updates
  await tid(page, TestIds.btnSetName).click();
  await expect(tid(page, TestIds.factMultiName)).toHaveText("world");
});
