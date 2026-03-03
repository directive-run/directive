/**
 * System Configuration
 *
 * Two ways to create a system:
 *
 * 1. Single module (direct access):
 *    `module: counterModule` → `system.facts.count`
 *
 * 2. Multiple modules (namespaced access):
 *    `modules: { auth, data, ui }` → `system.facts.auth.token`
 *
 * This example uses multiple modules with namespaced access.
 */

import { createSystem } from "@directive-run/core";
import { devtoolsPlugin, loggingPlugin } from "@directive-run/core/plugins";
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
    devtoolsPlugin({ name: "multi-module" }),
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
