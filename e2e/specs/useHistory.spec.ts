import { expect } from "@playwright/test";
import { forEachFramework, tid } from "../helpers/framework-test";
import { TestIds } from "../shared/test-ids";

forEachFramework("useHistory", async (_fw, { page }) => {
  // History is enabled
  await expect(tid(page, TestIds.historyEnabled)).toHaveText("true");

  // Initial state: can't go back/forward
  await expect(tid(page, TestIds.historyCanGoBack)).toHaveText("false");
  await expect(tid(page, TestIds.historyCanGoForward)).toHaveText("false");

  // Increment to create snapshots
  await tid(page, TestIds.btnIncrement).click();
  await expect(tid(page, TestIds.factSingle)).toHaveText("1");

  // Can now go back
  await expect(tid(page, TestIds.historyCanGoBack)).toHaveText("true", {
    timeout: 2000,
  });

  // Go back restores previous count
  await tid(page, TestIds.btnGoBack).click();
  await expect(tid(page, TestIds.factSingle)).toHaveText("0", {
    timeout: 2000,
  });

  // Can now go forward
  await expect(tid(page, TestIds.historyCanGoForward)).toHaveText("true", {
    timeout: 2000,
  });

  // Go forward
  await tid(page, TestIds.btnGoForward).click();
  await expect(tid(page, TestIds.factSingle)).toHaveText("1", {
    timeout: 2000,
  });
});
