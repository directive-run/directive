import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useDirective", async (_fw, { page }) => {
  // System is valid
  await expect(tid(page, TestIds.directiveSystem)).toHaveText("valid");

  // Facts render initial values
  await expect(tid(page, TestIds.directiveFact)).toHaveText("0");

  // Derivations compute correctly
  await expect(tid(page, TestIds.directiveDerived)).toHaveText("0");

  // Events dispatch works
  await tid(page, TestIds.btnIncrement).click();
  await expect(tid(page, TestIds.directiveFact)).toHaveText("1");
  await expect(tid(page, TestIds.directiveDerived)).toHaveText("2");
});
