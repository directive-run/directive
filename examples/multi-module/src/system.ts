/**
 * System Configuration
 *
 * Combines all modules using OBJECT syntax for automatic namespacing:
 * - `modules: { auth, data, ui }` → namespaced access
 * - Access via `system.facts.auth.token`, `system.derive.data.userCount`
 *
 * This replaces the array syntax:
 * - `modules: [authModule, dataModule]` → flat access
 * - Requires manual prefixes like `auth_token`, `data_users`
 */

import { createSystem } from "directive";
import { loggingPlugin } from "directive/plugins";
import { authModule } from "./modules/auth";
import { dataModule } from "./modules/data";
import { uiModule } from "./modules/ui";

// Create the combined system with OBJECT modules
// This enables namespaced access: system.facts.auth.token
export const system = createSystem({
  modules: {
    auth: authModule,
    data: dataModule,
    ui: uiModule,
  },
  plugins: [
    loggingPlugin({ level: "info" }),
  ],
  debug: {
    timeTravel: true,
    maxSnapshots: 50,
  },
});

// Type-safe access to facts through namespaces
// No manual type helper needed - types flow from the modules!
export type System = typeof system;

// Helper for main.ts to access facts with proper typing
export function getFacts() {
  return system.facts;
}

export function getDerive() {
  return system.derive;
}
