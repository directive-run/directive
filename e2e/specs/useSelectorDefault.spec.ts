import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useSelectorDefault", async (_fw, { page }) => {
  // After system starts, init values replace defaults
  // (useDirectiveRef creates synchronously but start() runs in useEffect)
  await expect(tid(page, TestIds.selectorRefDefault)).toHaveText("hello");
  await expect(tid(page, TestIds.selectorRefLive)).toHaveText("0");

  // Selector still works reactively after start
  await tid(page, TestIds.btnIncrement).click();
  await expect(tid(page, TestIds.selectorRefLive)).toHaveText("1");

  await tid(page, TestIds.btnIncrement).click();
  await expect(tid(page, TestIds.selectorRefLive)).toHaveText("2");
});
