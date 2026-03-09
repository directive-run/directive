/**
 * Shopping Cart — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * and renders the cart items, order summary, coupon, and checkout.
 */

import { el } from "@directive-run/el";
import { authSchema, cartSchema, system } from "./shopping-cart.js";

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

  const items = facts.cart.items;
  const couponCode = facts.cart.couponCode;
  const couponStatus = facts.cart.couponStatus;
  const couponDiscount = facts.cart.couponDiscount;
  const checkoutStatus = facts.cart.checkoutStatus;
  const checkoutError = facts.cart.checkoutError;
  const checkoutRequested = facts.cart.checkoutRequested;

  const subtotal = derive.cart.subtotal;
  const discount = derive.cart.discount;
  const tax = derive.cart.tax;
  const total = derive.cart.total;
  const itemCount = derive.cart.itemCount;
  const isEmpty = derive.cart.isEmpty;
  const freeShipping = derive.cart.freeShipping;

  const isAuthenticated = facts.auth.isAuthenticated;
  const userName = facts.auth.userName;

  // ---- Item Count Badge ----
  itemCountEl.textContent = `${itemCount} item${itemCount !== 1 ? "s" : ""}`;

  // ---- Cart Items ----
  if (isEmpty) {
    itemListEl.replaceChildren(
      el("div", { className: "sc-empty-cart" },
        el("div", { className: "sc-empty-icon" }, "\u{1F6D2}"),
        el("p", "Your cart is empty"),
      ),
    );
  } else {
    itemListEl.replaceChildren(
      ...items.map((item) => {
        const overstock = item.quantity > item.maxStock;
        const itemTotal = item.price * item.quantity;

        return el("div", { className: `sc-item${overstock ? " sc-item-overstock" : ""}`, dataset: { itemId: item.id } } as any,
          el("div", { className: `sc-item-icon sc-icon-${item.image}` }),
          el("div", { className: "sc-item-details" },
            el("div", { className: "sc-item-name" }, item.name),
            el("div", { className: "sc-item-price" }, `${formatPrice(item.price)} each`),
            overstock ? el("div", { className: "sc-stock-warning" }, `Only ${item.maxStock} in stock`) : null,
          ),
          el("div", { className: "sc-item-controls" },
            el("button", { className: "sc-qty-btn", dataset: { action: "decrease", id: item.id }, disabled: item.quantity <= 1 } as any, "-"),
            el("span", { className: "sc-qty-value" }, `${item.quantity}`),
            el("button", { className: "sc-qty-btn", dataset: { action: "increase", id: item.id }, disabled: item.quantity >= item.maxStock } as any, "+"),
          ),
          el("div", { className: "sc-item-total" }, formatPrice(itemTotal)),
          el("button", { className: "sc-remove-btn", dataset: { action: "remove", id: item.id }, title: "Remove item" } as any, "\u00D7"),
        );
      }),
    );
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
    checkoutBtn.replaceChildren(el("span", { className: "sc-spinner" }), " Processing...");
  } else {
    checkoutBtn.textContent = "Checkout";
  }

  // Checkout status overlay
  if (checkoutStatus === "complete") {
    checkoutStatusEl.replaceChildren(
      el("div", { className: "sc-overlay sc-overlay-success" },
        el("div", { className: "sc-overlay-icon" }, "\u2713"),
        el("div", { className: "sc-overlay-title" }, "Order Complete!"),
        el("div", { className: "sc-overlay-detail" }, "Thank you for your purchase."),
        el("button", { className: "sc-overlay-btn", id: "sc-reset-btn" }, "Continue Shopping"),
      ),
    );
    checkoutStatusEl.style.display = "flex";
  } else if (checkoutStatus === "failed") {
    checkoutStatusEl.replaceChildren(
      el("div", { className: "sc-overlay sc-overlay-error" },
        el("div", { className: "sc-overlay-icon" }, "\u2717"),
        el("div", { className: "sc-overlay-title" }, "Checkout Failed"),
        el("div", { className: "sc-overlay-detail" }, checkoutError),
        el("button", { className: "sc-overlay-btn", id: "sc-retry-checkout-btn" }, "Try Again"),
        el("button", { className: "sc-overlay-btn sc-overlay-btn-secondary", id: "sc-dismiss-btn" }, "Dismiss"),
      ),
    );
    checkoutStatusEl.style.display = "flex";
  } else {
    checkoutStatusEl.style.display = "none";
  }

  // ---- Auth ----
  if (isAuthenticated) {
    authToggleBtn.textContent = "Sign Out";
    authStatusEl.replaceChildren(
      el("span", { className: "sc-auth-badge sc-auth-in" }, `Signed in as ${userName}`),
    );
  } else {
    authToggleBtn.textContent = "Sign In";
    authStatusEl.replaceChildren(
      el("span", { className: "sc-auth-badge sc-auth-out" }, "Not signed in"),
    );
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
    const item = system.facts.cart.items.find((i) => i.id === id);
    if (item) {
      system.events.cart.updateQuantity({ id, quantity: item.quantity + 1 });
    }
  } else if (action === "decrease") {
    const item = system.facts.cart.items.find((i) => i.id === id);
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
