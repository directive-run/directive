import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useDerived", async (_fw, { page }) => {
  // Single derivation renders initial value
  await expect(tid(page, TestIds.derivedSingle)).toHaveText("0");
  await expect(tid(page, TestIds.derivedBool)).toHaveText("false");

  // Updates after increment
  await tid(page, TestIds.btnIncrement).click();
  await expect(tid(page, TestIds.derivedSingle)).toHaveText("2");
  await expect(tid(page, TestIds.derivedBool)).toHaveText("true");

  // Multi-key returns object
  const multiText = await tid(page, TestIds.derivedMulti).textContent();
  const multi = JSON.parse(multiText!);
  expect(multi.doubled).toBe(2);
  expect(multi.isPositive).toBe(true);
});
