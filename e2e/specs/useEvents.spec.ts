import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useEvents", async (_fw, { page }) => {
  // Initial value
  await expect(tid(page, TestIds.eventsResult)).toHaveText("0");

  // Typed event methods work
  await tid(page, TestIds.btnIncrement).click();
  await expect(tid(page, TestIds.eventsResult)).toHaveText("1");

  await tid(page, TestIds.btnIncrement).click();
  await expect(tid(page, TestIds.eventsResult)).toHaveText("2");

  // Decrement
  await tid(page, TestIds.btnDecrement).click();
  await expect(tid(page, TestIds.eventsResult)).toHaveText("1");
});
