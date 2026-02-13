import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useWatch", async (_fw, { page }) => {
  // Initially no watch has fired
  await expect(tid(page, TestIds.watchCount)).toHaveText("0");

  // Callback fires on fact change
  await tid(page, TestIds.btnIncrement).click();
  await expect(tid(page, TestIds.watchCount)).toHaveText("1");
  await expect(tid(page, TestIds.watchPrev)).toHaveText("0");
  await expect(tid(page, TestIds.watchNew)).toHaveText("1");

  // Second increment
  await tid(page, TestIds.btnIncrement).click();
  await expect(tid(page, TestIds.watchCount)).toHaveText("2");
  await expect(tid(page, TestIds.watchPrev)).toHaveText("1");
  await expect(tid(page, TestIds.watchNew)).toHaveText("2");
});
