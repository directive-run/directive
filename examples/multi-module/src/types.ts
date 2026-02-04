/**
 * Shared Types for Multi-Module System
 *
 * With namespaced modules, we only need to define entity types.
 * No more CombinedFacts or asCombined() helper needed!
 *
 * Cross-module access is automatic:
 * - facts.auth.token
 * - facts.data.users
 * - facts.ui.notifications
 */

// ============================================================================
// Entity Types
// ============================================================================

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface UserData {
  id: string;
  name: string;
  department: string;
}

export interface Notification {
  id: string;
  type: "success" | "error" | "info";
  message: string;
  timestamp: number;
}

// ============================================================================
// Note on Cross-Module Types
// ============================================================================

/**
 * With namespaced modules (object syntax), you don't need:
 * - Manual CombinedFacts type definition
 * - asCombined() helper function
 * - Prefix convention (auth_token, data_users)
 *
 * Instead, the system automatically provides:
 * - facts.auth.token, facts.data.users, facts.ui.notifications
 * - derive.auth.status, derive.data.userCount
 * - events.auth.login(), events.data.refresh()
 *
 * Types flow automatically from the module schemas!
 */
