import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useSelector", async (_fw, { page }) => {
  // Custom selector computes correctly
  await expect(tid(page, TestIds.selectorResult)).toHaveText("0");

  // Updates after fact change
  await tid(page, TestIds.btnIncrement).click();
  await expect(tid(page, TestIds.selectorResult)).toHaveText("3");

  await tid(page, TestIds.btnIncrement).click();
  await expect(tid(page, TestIds.selectorResult)).toHaveText("6");
});
