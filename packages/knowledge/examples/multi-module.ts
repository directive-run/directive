import { system } from "./system";

// DOM Elements

// Start the system
system.start();

// Update UI function

// Subscribe to derivation changes using namespaced keys
// Note: The internal keys are still prefixed (auth_status), so we use those for subscribe
system.subscribe(
  [
    "auth_status",
    "auth_displayName",
    "data_status",
    "data_userCount",
    "ui_hasNotifications",
  ],
  () => {
    updateUI();
  },
);

// Also update on fact changes via polling (simple approach for this demo)

// Event handlers using namespaced events accessor

// Initial render
updateUI();

// Log to console for debugging
console.log("Multi-Module Example Started (Namespaced Mode)");
console.log("Try clicking Login to see the cross-module constraint in action:");
console.log("1. Auth module validates token via facts.auth.*");
console.log(
  "2. Data module automatically fetches users when facts.auth.isAuthenticated",
);
console.log("3. UI module effects react to facts.data.* changes");
