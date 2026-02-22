/**
 * Mock API — Shopping cart backend simulation.
 * No real network calls; configurable delays and failure rates.
 */

// ============================================================================
// Types
// ============================================================================

export interface CouponResult {
  valid: boolean;
  discount: number;
}

export interface CheckoutResult {
  orderId: string;
  success: boolean;
}

export interface InventoryResult {
  inStock: number;
}

// ============================================================================
// Helpers
// ============================================================================

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Validate a coupon code.
 * Valid codes: "SAVE10" (10% off), "HALF" (50% off).
 * Anything else is invalid.
 */
export async function validateCoupon(code: string): Promise<CouponResult> {
  await wait(500);

  const normalized = code.toUpperCase().trim();

  if (normalized === "SAVE10") {
    return { valid: true, discount: 10 };
  }

  if (normalized === "HALF") {
    return { valid: true, discount: 50 };
  }

  return { valid: false, discount: 0 };
}

/**
 * Process a checkout. 10% random failure rate.
 */
export async function processCheckout(
  items: Array<{ id: string; name: string; quantity: number; price: number }>,
  couponCode: string,
): Promise<CheckoutResult> {
  await wait(1000);

  if (Math.random() < 0.1) {
    throw new Error("Payment processing failed. Please try again.");
  }

  const orderId = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  return { orderId, success: true };
}

/**
 * Check inventory for a given item.
 */
export async function checkInventory(itemId: string): Promise<InventoryResult> {
  await wait(200);

  // Deterministic stock based on item ID hash
  const hash = itemId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);

  return { inStock: (hash % 10) + 1 };
}
