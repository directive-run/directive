/**
 * URL Sync — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * and renders the product grid, filters, and pagination.
 */

import { system, urlSchema, productsSchema } from "./url-sync.js";
import type { Product } from "./mock-products.js";

// ============================================================================
// System
// ============================================================================

system.start();

const allKeys = [
  ...Object.keys(urlSchema.facts).map((k) => `url::${k}`),
  ...Object.keys(productsSchema.facts).map((k) => `products::${k}`),
  ...Object.keys(productsSchema.derivations).map((k) => `products::${k}`),
];

// ============================================================================
// DOM References
// ============================================================================

const searchInput = document.getElementById("us-search") as HTMLInputElement;
const categoryBtns = document.querySelectorAll<HTMLButtonElement>("[data-category]");
const sortSelect = document.getElementById("us-sort-select") as HTMLSelectElement;
const productList = document.getElementById("us-product-list")!;
const prevBtn = document.getElementById("us-page-prev") as HTMLButtonElement;
const nextBtn = document.getElementById("us-page-next") as HTMLButtonElement;
const pageNumbers = document.getElementById("us-page-numbers")!;
const currentUrl = document.getElementById("us-current-url")!;
const totalItems = document.getElementById("us-total-items")!;
const pageDisplay = document.getElementById("us-page-display")!;
const loadingIndicator = document.getElementById("us-loading")!;

// ============================================================================
// Render
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

function categoryLabel(cat: string): string {
  if (cat === "") {
    return "All";
  }

  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

function render(): void {
  const urlFacts = system.facts.url;
  const productFacts = system.facts.products;
  const productDerive = system.derive.products;

  // Search input (only update if not focused to avoid cursor jump)
  if (document.activeElement !== searchInput) {
    searchInput.value = urlFacts.search;
  }

  // Category buttons
  const activeCat = urlFacts.category === "" ? "all" : urlFacts.category;
  categoryBtns.forEach((btn) => {
    const cat = btn.dataset.category ?? "";
    if (cat === activeCat) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Sort select
  if (document.activeElement !== sortSelect) {
    sortSelect.value = urlFacts.sortBy;
  }

  // Loading indicator
  if (productFacts.isLoading) {
    loadingIndicator.style.display = "flex";
  } else {
    loadingIndicator.style.display = "none";
  }

  // Product list
  const items = productFacts.items as Product[];
  if (items.length === 0 && !productFacts.isLoading) {
    productList.innerHTML = '<div class="us-empty">No products found. Try adjusting your filters.</div>';
  } else {
    productList.innerHTML = "";
    for (const product of items) {
      const card = document.createElement("div");
      card.className = "us-product-card";
      card.innerHTML = `
        <div class="us-product-category">${escapeHtml(categoryLabel(product.category))}</div>
        <div class="us-product-name">${escapeHtml(product.name)}</div>
        <div class="us-product-price">${formatPrice(product.price)}</div>
      `;
      productList.appendChild(card);
    }
  }

  // Total items
  totalItems.textContent = `${productFacts.totalItems} items`;

  // Page display
  pageDisplay.textContent = productDerive.currentPageDisplay as string;

  // Pagination
  const totalPg = productDerive.totalPages as number;
  const currentPg = urlFacts.page;

  prevBtn.disabled = currentPg <= 1;
  nextBtn.disabled = currentPg >= totalPg;

  pageNumbers.innerHTML = "";
  if (totalPg > 0) {
    const startPage = Math.max(1, currentPg - 2);
    const endPage = Math.min(totalPg, currentPg + 2);

    if (startPage > 1) {
      pageNumbers.appendChild(makePageBtn(1, currentPg));
      if (startPage > 2) {
        const ellipsis = document.createElement("span");
        ellipsis.className = "us-page-ellipsis";
        ellipsis.textContent = "\u2026";
        pageNumbers.appendChild(ellipsis);
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      pageNumbers.appendChild(makePageBtn(i, currentPg));
    }

    if (endPage < totalPg) {
      if (endPage < totalPg - 1) {
        const ellipsis = document.createElement("span");
        ellipsis.className = "us-page-ellipsis";
        ellipsis.textContent = "\u2026";
        pageNumbers.appendChild(ellipsis);
      }
      pageNumbers.appendChild(makePageBtn(totalPg, currentPg));
    }
  }

  // URL display
  const search = window.location.search || "(no params)";
  currentUrl.textContent = `${window.location.pathname}${search}`;

}

function makePageBtn(page: number, currentPage: number): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "us-btn us-page-btn";
  btn.textContent = String(page);
  if (page === currentPage) {
    btn.classList.add("active");
  }
  btn.addEventListener("click", () => {
    system.events.url.setPage({ value: page });
  });

  return btn;
}

// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(allKeys, render);

// ============================================================================
// Event Handlers
// ============================================================================

// Search input
searchInput.addEventListener("input", () => {
  system.events.url.setSearch({ value: searchInput.value });
});

// Category buttons
categoryBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const cat = btn.dataset.category ?? "";
    const value = cat === "all" ? "" : cat;
    system.events.url.setCategory({ value });
  });
});

// Sort select
sortSelect.addEventListener("change", () => {
  system.events.url.setSortBy({ value: sortSelect.value });
});

// Pagination
prevBtn.addEventListener("click", () => {
  const page = system.facts.url.page;
  if (page > 1) {
    system.events.url.setPage({ value: page - 1 });
  }
});

nextBtn.addEventListener("click", () => {
  const page = system.facts.url.page;
  const totalPg = system.derive.products.totalPages as number;
  if (page < totalPg) {
    system.events.url.setPage({ value: page + 1 });
  }
});

// ============================================================================
// Initial Render
// ============================================================================

render();

// Signal to tests that the module script has fully initialized
document.body.setAttribute("data-url-sync-ready", "true");
