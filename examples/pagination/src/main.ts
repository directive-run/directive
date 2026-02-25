/**
 * Pagination & Infinite Scroll — DOM Rendering & System Wiring
 *
 * Creates the Directive system, subscribes to state changes,
 * renders the filter bar, item list with scroll sentinel,
 * and scroll sentinel.
 */

import { system, filtersSchema, listSchema } from "./pagination.js";
import type { ListItem } from "./mock-api.js";

// ============================================================================
// System
// ============================================================================

system.start();

const allKeys = [
  ...Object.keys(filtersSchema.facts).map((k) => `filters::${k}`),
  ...Object.keys(listSchema.facts).map((k) => `list::${k}`),
  ...Object.keys(listSchema.derivations ?? {}).map((k) => `list::${k}`),
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

// ============================================================================
// Render
// ============================================================================

const CATEGORY_COLORS: Record<string, string> = {
  technology: "var(--brand-primary)",
  science: "var(--brand-success)",
  design: "var(--brand-warning)",
  business: "var(--brand-error)",
};

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
  const hasMore = facts.list.hasMore;
  const isLoadingMore = facts.list.isLoadingMore;
  const search = facts.filters.search;
  const sortBy = facts.filters.sortBy;
  const category = facts.filters.category;
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
