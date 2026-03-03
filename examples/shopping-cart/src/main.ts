/**
 * Shopping Cart — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * and renders the cart items, order summary, coupon, and checkout.
 */

import {
  type CartItem,
  authSchema,
  cartSchema,
  system,
} from "./shopping-cart.js";

// ============================================================================
// System Startup
// ============================================================================

system.start();

// ============================================================================
// DOM References
// ============================================================================

const itemListEl = document.getElementById("sc-item-list")!;
const subtotalEl = document.getElementById("sc-subtotal")!;
const discountRowEl = document.getElementById("sc-discount-row")!;
const discountEl = document.getElementById("sc-discount")!;
const taxEl = document.getElementById("sc-tax")!;
const totalEl = document.getElementById("sc-total")!;
const freeShippingEl = document.getElementById("sc-free-shipping")!;
const itemCountEl = document.getElementById("sc-item-count")!;

const couponInputEl = document.getElementById(
  "sc-coupon-input",
) as HTMLInputElement;
const couponApplyBtn = document.getElementById(
  "sc-coupon-apply",
) as HTMLButtonElement;
const couponStatusEl = document.getElementById("sc-coupon-status")!;
const couponClearBtn = document.getElementById(
  "sc-coupon-clear",
) as HTMLButtonElement;

const checkoutBtn = document.getElementById(
  "sc-checkout-btn",
) as HTMLButtonElement;
const checkoutStatusEl = document.getElementById("sc-checkout-status")!;

const authToggleBtn = document.getElementById(
  "sc-auth-toggle",
) as HTMLButtonElement;
const authStatusEl = document.getElementById("sc-auth-status")!;

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

function formatPrice(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

const ITEM_ICONS: Record<string, string> = {
  headphones: "headphones-icon",
  keyboard: "keyboard-icon",
  hub: "hub-icon",
};

// ============================================================================
// Render
// ============================================================================

function render(): void {
  const facts = system.facts;
  const derive = system.derive;

  const items = facts.cart.items as CartItem[];
  const couponCode = facts.cart.couponCode as string;
  const couponStatus = facts.cart.couponStatus as string;
  const couponDiscount = facts.cart.couponDiscount as number;
  const checkoutStatus = facts.cart.checkoutStatus as string;
  const checkoutError = facts.cart.checkoutError as string;
  const checkoutRequested = facts.cart.checkoutRequested as boolean;

  const subtotal = derive.cart.subtotal as number;
  const discount = derive.cart.discount as number;
  const tax = derive.cart.tax as number;
  const total = derive.cart.total as number;
  const itemCount = derive.cart.itemCount as number;
  const isEmpty = derive.cart.isEmpty as boolean;
  const freeShipping = derive.cart.freeShipping as boolean;

  const isAuthenticated = facts.auth.isAuthenticated as boolean;
  const userName = facts.auth.userName as string;

  // ---- Item Count Badge ----
  itemCountEl.textContent = `${itemCount} item${itemCount !== 1 ? "s" : ""}`;

  // ---- Cart Items ----
  if (isEmpty) {
    itemListEl.innerHTML = `
      <div class="sc-empty-cart">
        <div class="sc-empty-icon">&#128722;</div>
        <p>Your cart is empty</p>
      </div>
    `;
  } else {
    itemListEl.innerHTML = items
      .map((item) => {
        const overstock = item.quantity > item.maxStock;
        const itemTotal = item.price * item.quantity;

        return `
          <div class="sc-item${overstock ? " sc-item-overstock" : ""}" data-item-id="${escapeHtml(item.id)}">
            <div class="sc-item-icon sc-icon-${escapeHtml(item.image)}"></div>
            <div class="sc-item-details">
              <div class="sc-item-name">${escapeHtml(item.name)}</div>
              <div class="sc-item-price">${formatPrice(item.price)} each</div>
              ${overstock ? `<div class="sc-stock-warning">Only ${item.maxStock} in stock</div>` : ""}
            </div>
            <div class="sc-item-controls">
              <button class="sc-qty-btn" data-action="decrease" data-id="${escapeHtml(item.id)}" ${item.quantity <= 1 ? "disabled" : ""}>-</button>
              <span class="sc-qty-value">${item.quantity}</span>
              <button class="sc-qty-btn" data-action="increase" data-id="${escapeHtml(item.id)}" ${item.quantity >= item.maxStock ? "disabled" : ""}>+</button>
            </div>
            <div class="sc-item-total">${formatPrice(itemTotal)}</div>
            <button class="sc-remove-btn" data-action="remove" data-id="${escapeHtml(item.id)}" title="Remove item">&times;</button>
          </div>
        `;
      })
      .join("");
  }

  // ---- Order Summary ----
  subtotalEl.textContent = formatPrice(subtotal);

  if (discount > 0) {
    discountRowEl.style.display = "flex";
    discountEl.textContent = `-${formatPrice(discount)}`;
  } else {
    discountRowEl.style.display = "none";
  }

  taxEl.textContent = formatPrice(tax);
  totalEl.textContent = formatPrice(total);

  // ---- Free Shipping Badge ----
  if (freeShipping && !isEmpty) {
    freeShippingEl.style.display = "flex";
  } else {
    freeShippingEl.style.display = "none";
  }

  // ---- Coupon ----
  couponStatusEl.className = "sc-coupon-badge";
  if (couponStatus === "checking") {
    couponStatusEl.className = "sc-coupon-badge sc-coupon-checking";
    couponStatusEl.textContent = "Checking...";
    couponStatusEl.style.display = "inline-block";
  } else if (couponStatus === "valid") {
    couponStatusEl.className = "sc-coupon-badge sc-coupon-valid";
    couponStatusEl.textContent = `${couponDiscount}% off applied`;
    couponStatusEl.style.display = "inline-block";
  } else if (couponStatus === "invalid") {
    couponStatusEl.className = "sc-coupon-badge sc-coupon-invalid";
    couponStatusEl.textContent = "Invalid code";
    couponStatusEl.style.display = "inline-block";
  } else {
    couponStatusEl.style.display = "none";
  }

  couponClearBtn.style.display = couponCode !== "" ? "inline-block" : "none";
  couponApplyBtn.disabled = couponStatus === "checking";

  // ---- Checkout ----
  const isProcessing = checkoutStatus === "processing" || checkoutRequested;
  checkoutBtn.disabled = isEmpty || !isAuthenticated || isProcessing;

  if (checkoutStatus === "processing") {
    checkoutBtn.innerHTML = '<span class="sc-spinner"></span> Processing...';
  } else {
    checkoutBtn.textContent = "Checkout";
  }

  // Checkout status overlay
  if (checkoutStatus === "complete") {
    checkoutStatusEl.innerHTML = `
      <div class="sc-overlay sc-overlay-success">
        <div class="sc-overlay-icon">&#10003;</div>
        <div class="sc-overlay-title">Order Complete!</div>
        <div class="sc-overlay-detail">Thank you for your purchase.</div>
        <button class="sc-overlay-btn" id="sc-reset-btn">Continue Shopping</button>
      </div>
    `;
    checkoutStatusEl.style.display = "flex";
  } else if (checkoutStatus === "failed") {
    checkoutStatusEl.innerHTML = `
      <div class="sc-overlay sc-overlay-error">
        <div class="sc-overlay-icon">&#10007;</div>
        <div class="sc-overlay-title">Checkout Failed</div>
        <div class="sc-overlay-detail">${escapeHtml(checkoutError)}</div>
        <button class="sc-overlay-btn" id="sc-retry-checkout-btn">Try Again</button>
        <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-dismiss-btn">Dismiss</button>
      </div>
    `;
    checkoutStatusEl.style.display = "flex";
  } else {
    checkoutStatusEl.style.display = "none";
  }

  // ---- Auth ----
  if (isAuthenticated) {
    authToggleBtn.textContent = "Sign Out";
    authStatusEl.innerHTML = `<span class="sc-auth-badge sc-auth-in">Signed in as ${escapeHtml(userName)}</span>`;
  } else {
    authToggleBtn.textContent = "Sign In";
    authStatusEl.innerHTML =
      '<span class="sc-auth-badge sc-auth-out">Not signed in</span>';
  }
}

// ============================================================================
// Subscribe
// ============================================================================

const allCartKeys = [
  ...Object.keys(cartSchema.facts).map((k) => `cart::${k}`),
  ...Object.keys(cartSchema.derivations).map((k) => `cart::${k}`),
  ...Object.keys(authSchema.facts).map((k) => `auth::${k}`),
  ...Object.keys(authSchema.derivations).map((k) => `auth::${k}`),
];

system.subscribe(allCartKeys, render);

// Also poll for checkout status updates during processing
setInterval(render, 200);

// ============================================================================
// Event Handlers
// ============================================================================

// Delegated click handler for cart item buttons
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const action = target.dataset.action;
  const id = target.dataset.id;

  if (!action || !id) {
    return;
  }

  if (action === "increase") {
    const item = (system.facts.cart.items as CartItem[]).find(
      (i) => i.id === id,
    );
    if (item) {
      system.events.cart.updateQuantity({ id, quantity: item.quantity + 1 });
    }
  } else if (action === "decrease") {
    const item = (system.facts.cart.items as CartItem[]).find(
      (i) => i.id === id,
    );
    if (item) {
      system.events.cart.updateQuantity({ id, quantity: item.quantity - 1 });
    }
  } else if (action === "remove") {
    system.events.cart.removeItem({ id });
  }
});

// Checkout overlay buttons (delegated)
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;

  if (target.id === "sc-reset-btn") {
    system.events.cart.resetCheckout();
  } else if (target.id === "sc-retry-checkout-btn") {
    system.events.cart.resetCheckout();
    system.events.cart.requestCheckout();
  } else if (target.id === "sc-dismiss-btn") {
    system.events.cart.resetCheckout();
  }
});

// Coupon
couponApplyBtn.addEventListener("click", () => {
  const code = couponInputEl.value.trim();
  if (code === "") {
    return;
  }

  system.events.cart.applyCoupon({ code });
});

couponInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const code = couponInputEl.value.trim();
    if (code === "") {
      return;
    }

    system.events.cart.applyCoupon({ code });
  }
});

couponClearBtn.addEventListener("click", () => {
  couponInputEl.value = "";
  system.events.cart.clearCoupon();
});

// Checkout
checkoutBtn.addEventListener("click", () => {
  system.events.cart.requestCheckout();
});

// Auth toggle
authToggleBtn.addEventListener("click", () => {
  system.events.auth.toggleAuth();
});

// ============================================================================
// Initial Render
// ============================================================================

render();

// Signal to tests that the module script has fully initialized
document.body.setAttribute("data-shopping-cart-ready", "true");
