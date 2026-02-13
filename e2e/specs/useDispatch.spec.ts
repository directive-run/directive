import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useDispatch", async (_fw, { page }) => {
  // Initial value
  await expect(tid(page, TestIds.dispatchResult)).toHaveText("0");

  // Raw dispatch triggers state change
  await tid(page, TestIds.btnDispatchIncrement).click();
  await expect(tid(page, TestIds.dispatchResult)).toHaveText("1");

  await tid(page, TestIds.btnDispatchIncrement).click();
  await expect(tid(page, TestIds.dispatchResult)).toHaveText("2");
});
