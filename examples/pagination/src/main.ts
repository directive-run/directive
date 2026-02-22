/**
 * Pagination & Infinite Scroll — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the filter bar, item list with scroll sentinel,
 * and state inspector sidebar.
 */

import { system, filtersSchema, listSchema } from "./pagination.js";
import type { ListItem } from "./mock-api.js";

// ============================================================================
// System
// ============================================================================

system.start();

const allKeys = [
  ...Object.keys(filtersSchema.facts).map((k) => `filters_${k}`),
  ...Object.keys(listSchema.facts).map((k) => `list_${k}`),
  ...Object.keys(listSchema.derivations ?? {}).map((k) => `list_${k}`),
];

// ============================================================================
// DOM References
// ============================================================================

// Filters
const searchInput = document.getElementById("pg-search") as HTMLInputElement;
const categoryBtns = document.querySelectorAll<HTMLButtonElement>("[data-category]");
const sortSelect = document.getElementById("pg-sort-select") as HTMLSelectElement;

// List
const itemListEl = document.getElementById("pg-item-list")!;
const loadingEl = document.getElementById("pg-loading")!;
const endMessageEl = document.getElementById("pg-end-message")!;

// Inspector
const factItemsCount = document.getElementById("pg-fact-items-count")!;
const factCursor = document.getElementById("pg-fact-cursor")!;
const factHasMore = document.getElementById("pg-fact-has-more")!;
const factIsLoading = document.getElementById("pg-fact-is-loading")!;
const factScrollNear = document.getElementById("pg-fact-scroll-near")!;
const factFilterHash = document.getElementById("pg-fact-filter-hash")!;
const factSearch = document.getElementById("pg-fact-search")!;
const factSortBy = document.getElementById("pg-fact-sort-by")!;
const factCategory = document.getElementById("pg-fact-category")!;
const derivTotalLoaded = document.getElementById("pg-total-loaded")!;
const derivIsEmpty = document.getElementById("pg-deriv-is-empty")!;

// ============================================================================
// Render
// ============================================================================

const CATEGORY_COLORS: Record<string, string> = {
  technology: "var(--brand-primary)",
  science: "var(--brand-success)",
  design: "var(--brand-warning)",
  business: "var(--brand-error)",
};

function renderBoolIndicator(el: HTMLElement, value: boolean): void {
  const cls = value ? "true" : "false";
  el.innerHTML = `<span class="pg-indicator ${cls}"></span> ${value}`;
}

function renderItems(items: ListItem[]): void {
  if (items.length === 0) {
    itemListEl.innerHTML = "";

    return;
  }

  // Build all items as HTML string for performance
  let html = "";
  for (const item of items) {
    const color = CATEGORY_COLORS[item.category] ?? "var(--brand-text-dim)";
    html += `
      <div class="pg-item">
        <span class="pg-item-category" style="background: ${color}">${escapeHtml(item.category)}</span>
        <span class="pg-item-title">${escapeHtml(item.title)}</span>
        <span class="pg-item-id">${escapeHtml(item.id)}</span>
      </div>
    `;
  }

  itemListEl.innerHTML = html;
}

function render(): void {
  const facts = system.facts;
  const derive = system.derive;

  const items = facts.list.items;
  const cursor = facts.list.cursor;
  const hasMore = facts.list.hasMore;
  const isLoadingMore = facts.list.isLoadingMore;
  const scrollNearBottom = facts.list.scrollNearBottom;
  const lastFilterHash = facts.list.lastFilterHash;
  const search = facts.filters.search;
  const sortBy = facts.filters.sortBy;
  const category = facts.filters.category;
  const totalLoaded = derive.list.totalLoaded;
  const isEmpty = derive.list.isEmpty;

  // --- Item list ---
  renderItems(items);

  // --- Loading indicator ---
  loadingEl.classList.toggle("visible", isLoadingMore);

  // --- End message ---
  if (isEmpty) {
    endMessageEl.textContent = "No items match your filters";
    endMessageEl.classList.add("visible");
  } else if (!hasMore && items.length > 0) {
    endMessageEl.textContent = "All items loaded";
    endMessageEl.classList.add("visible");
  } else {
    endMessageEl.classList.remove("visible");
  }

  // --- Active category button ---
  for (const btn of categoryBtns) {
    btn.classList.toggle("active", btn.dataset.category === category);
  }

  // --- Search input sync (only if not focused) ---
  if (document.activeElement !== searchInput) {
    searchInput.value = search;
  }

  // --- Sort select sync ---
  sortSelect.value = sortBy;

  // --- Inspector: Facts ---
  factItemsCount.textContent = `${items.length} items`;
  factCursor.textContent = cursor || "\u2014";
  renderBoolIndicator(factHasMore, hasMore);
  renderBoolIndicator(factIsLoading, isLoadingMore);
  renderBoolIndicator(factScrollNear, scrollNearBottom);
  factFilterHash.textContent = lastFilterHash || "\u2014";
  factSearch.textContent = search || "\u2014";
  factSortBy.textContent = sortBy;
  factCategory.textContent = category;

  // --- Inspector: Derivations ---
  derivTotalLoaded.textContent = String(totalLoaded);
  renderBoolIndicator(derivIsEmpty, isEmpty);
}

// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(allKeys, render);

// ============================================================================
// Controls
// ============================================================================

let searchDebounce: ReturnType<typeof setTimeout> | null = null;

searchInput.addEventListener("input", () => {
  if (searchDebounce) {
    clearTimeout(searchDebounce);
  }

  searchDebounce = setTimeout(() => {
    system.events.filters.setSearch({ value: searchInput.value });
  }, 300);
});

for (const btn of categoryBtns) {
  btn.addEventListener("click", () => {
    const cat = btn.dataset.category;
    if (cat) {
      system.events.filters.setCategory({ value: cat });
    }
  });
}

sortSelect.addEventListener("change", () => {
  system.events.filters.setSortBy({ value: sortSelect.value });
});

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

// ============================================================================
// Initial Render
// ============================================================================

render();

// Signal to tests that the module script has fully initialized
document.body.setAttribute("data-pagination-ready", "true");
