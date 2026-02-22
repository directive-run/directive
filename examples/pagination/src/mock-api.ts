/**
 * Mock Paginated API — generates 100 items with cursor-based pagination.
 * No real network calls; all data is deterministic with a simulated delay.
 */

// ============================================================================
// Types
// ============================================================================

export interface ListItem {
  id: string;
  title: string;
  category: string;
}

export interface PageResponse {
  items: ListItem[];
  nextCursor: string;
  hasMore: boolean;
}

// ============================================================================
// Categories & Item Generation
// ============================================================================

const CATEGORIES = ["technology", "science", "design", "business"] as const;

const TITLE_PREFIXES = [
  "Introduction to",
  "Advanced",
  "Understanding",
  "Building",
  "Exploring",
  "Mastering",
  "The Future of",
  "Practical",
  "Deep Dive into",
  "Getting Started with",
];

const TITLE_SUBJECTS: Record<string, string[]> = {
  technology: [
    "Distributed Systems",
    "WebAssembly",
    "Edge Computing",
    "Rust Programming",
    "Container Orchestration",
    "GraphQL APIs",
    "Serverless Architecture",
    "TypeScript Patterns",
    "Micro-Frontends",
    "WASM Runtimes",
  ],
  science: [
    "Quantum Computing",
    "Neural Networks",
    "Gene Editing",
    "Climate Models",
    "Protein Folding",
    "Dark Matter",
    "Synthetic Biology",
    "Fusion Energy",
    "Exoplanet Detection",
    "Gravitational Waves",
  ],
  design: [
    "Design Systems",
    "Motion Design",
    "Accessibility",
    "Color Theory",
    "Typography",
    "Layout Grids",
    "Responsive Patterns",
    "Icon Design",
    "Dark Mode",
    "Micro-Interactions",
  ],
  business: [
    "Market Strategy",
    "Product Analytics",
    "Growth Hacking",
    "Team Scaling",
    "OKR Frameworks",
    "Revenue Models",
    "Customer Retention",
    "Pricing Strategy",
    "Remote Culture",
    "Lean Operations",
  ],
};

function generateItems(count: number, startId: number): ListItem[] {
  const items: ListItem[] = [];

  for (let i = 0; i < count; i++) {
    const id = startId + i;
    const category = CATEGORIES[id % CATEGORIES.length];
    const subjects = TITLE_SUBJECTS[category];
    const prefix = TITLE_PREFIXES[id % TITLE_PREFIXES.length];
    const subject = subjects[Math.floor(id / CATEGORIES.length) % subjects.length];

    items.push({
      id: `item-${id}`,
      title: `${prefix} ${subject}`,
      category,
    });
  }

  return items;
}

// Pre-generate 100 items
const ALL_ITEMS = generateItems(100, 1);

// ============================================================================
// Mock API
// ============================================================================

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchPage(
  cursor: string,
  limit: number,
  filters: { search: string; category: string; sortBy: string },
): Promise<PageResponse> {
  await wait(500);

  // Filter items
  let filtered = ALL_ITEMS;

  if (filters.category !== "all") {
    filtered = filtered.filter((item) => item.category === filters.category);
  }

  if (filters.search.trim() !== "") {
    const query = filters.search.toLowerCase();
    filtered = filtered.filter((item) =>
      item.title.toLowerCase().includes(query),
    );
  }

  // Sort items
  if (filters.sortBy === "oldest") {
    filtered = [...filtered].reverse();
  } else if (filters.sortBy === "title") {
    filtered = [...filtered].sort((a, b) => a.title.localeCompare(b.title));
  }
  // "newest" is the default order

  // Paginate from cursor
  const startIndex = cursor === "" ? 0 : parseInt(cursor, 10);
  const page = filtered.slice(startIndex, startIndex + limit);
  const nextIndex = startIndex + limit;
  const hasMore = nextIndex < filtered.length;

  return {
    items: page,
    nextCursor: hasMore ? String(nextIndex) : "",
    hasMore,
  };
}
