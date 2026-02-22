/**
 * Mock Products — Data & Filtering
 *
 * 50 products across 4 categories with search, filter, sort, and pagination.
 */

// ============================================================================
// Types
// ============================================================================

export interface Product {
  id: number;
  name: string;
  category: "electronics" | "clothing" | "books" | "home";
  price: number;
}

export interface ProductFilters {
  search: string;
  category: string;
  sortBy: string;
  page: number;
  itemsPerPage: number;
}

export interface FilteredResult {
  items: Product[];
  totalItems: number;
}

// ============================================================================
// Mock Data
// ============================================================================

export const allProducts: Product[] = [
  // Electronics (13)
  { id: 1, name: "Wireless Bluetooth Headphones", category: "electronics", price: 79.99 },
  { id: 2, name: "USB-C Hub Adapter", category: "electronics", price: 34.99 },
  { id: 3, name: "Mechanical Keyboard", category: "electronics", price: 129.99 },
  { id: 4, name: "Portable SSD 1TB", category: "electronics", price: 89.99 },
  { id: 5, name: "Webcam HD 1080p", category: "electronics", price: 49.99 },
  { id: 6, name: "Wireless Mouse", category: "electronics", price: 29.99 },
  { id: 7, name: "Monitor Stand", category: "electronics", price: 44.99 },
  { id: 8, name: "Noise Cancelling Earbuds", category: "electronics", price: 149.99 },
  { id: 9, name: "Laptop Cooling Pad", category: "electronics", price: 24.99 },
  { id: 10, name: "Smart Power Strip", category: "electronics", price: 39.99 },
  { id: 11, name: "Portable Charger 20000mAh", category: "electronics", price: 35.99 },
  { id: 12, name: "HDMI Cable 6ft", category: "electronics", price: 12.99 },
  { id: 13, name: "Desk Lamp LED", category: "electronics", price: 27.99 },

  // Clothing (12)
  { id: 14, name: "Cotton Crew Neck T-Shirt", category: "clothing", price: 19.99 },
  { id: 15, name: "Slim Fit Jeans", category: "clothing", price: 49.99 },
  { id: 16, name: "Zip-Up Hoodie", category: "clothing", price: 44.99 },
  { id: 17, name: "Running Shoes", category: "clothing", price: 89.99 },
  { id: 18, name: "Winter Parka Jacket", category: "clothing", price: 129.99 },
  { id: 19, name: "Wool Beanie", category: "clothing", price: 14.99 },
  { id: 20, name: "Leather Belt", category: "clothing", price: 24.99 },
  { id: 21, name: "Athletic Socks 6-Pack", category: "clothing", price: 16.99 },
  { id: 22, name: "Flannel Button-Down", category: "clothing", price: 34.99 },
  { id: 23, name: "Canvas Sneakers", category: "clothing", price: 54.99 },
  { id: 24, name: "Linen Shorts", category: "clothing", price: 29.99 },
  { id: 25, name: "Waterproof Rain Jacket", category: "clothing", price: 69.99 },

  // Books (13)
  { id: 26, name: "TypeScript Design Patterns", category: "books", price: 39.99 },
  { id: 27, name: "Clean Architecture", category: "books", price: 34.99 },
  { id: 28, name: "The Pragmatic Programmer", category: "books", price: 44.99 },
  { id: 29, name: "Refactoring UI", category: "books", price: 79.99 },
  { id: 30, name: "Domain-Driven Design", category: "books", price: 54.99 },
  { id: 31, name: "System Design Interview", category: "books", price: 29.99 },
  { id: 32, name: "JavaScript: The Good Parts", category: "books", price: 19.99 },
  { id: 33, name: "Designing Data-Intensive Apps", category: "books", price: 42.99 },
  { id: 34, name: "You Don't Know JS", category: "books", price: 24.99 },
  { id: 35, name: "Eloquent JavaScript", category: "books", price: 29.99 },
  { id: 36, name: "Learning Go", category: "books", price: 34.99 },
  { id: 37, name: "Rust in Action", category: "books", price: 44.99 },
  { id: 38, name: "Programming Pearls", category: "books", price: 27.99 },

  // Home (12)
  { id: 39, name: "Ceramic Coffee Mug Set", category: "home", price: 24.99 },
  { id: 40, name: "Bamboo Cutting Board", category: "home", price: 19.99 },
  { id: 41, name: "Stainless Steel Water Bottle", category: "home", price: 22.99 },
  { id: 42, name: "Scented Soy Candle", category: "home", price: 14.99 },
  { id: 43, name: "Throw Blanket", category: "home", price: 34.99 },
  { id: 44, name: "Cast Iron Skillet", category: "home", price: 29.99 },
  { id: 45, name: "Indoor Plant Pot Set", category: "home", price: 27.99 },
  { id: 46, name: "Kitchen Timer Digital", category: "home", price: 9.99 },
  { id: 47, name: "Drawer Organizer Tray", category: "home", price: 16.99 },
  { id: 48, name: "French Press Coffee Maker", category: "home", price: 32.99 },
  { id: 49, name: "Wall-Mounted Shelf", category: "home", price: 39.99 },
  { id: 50, name: "Cotton Dish Towels 4-Pack", category: "home", price: 12.99 },
];

// ============================================================================
// Filter & Sort
// ============================================================================

export function filterProducts(
  products: Product[],
  filters: ProductFilters,
): FilteredResult {
  let filtered = [...products];

  // Filter by search
  if (filters.search.trim() !== "") {
    const query = filters.search.toLowerCase();
    filtered = filtered.filter((p) =>
      p.name.toLowerCase().includes(query),
    );
  }

  // Filter by category
  if (filters.category !== "" && filters.category !== "all") {
    filtered = filtered.filter((p) => p.category === filters.category);
  }

  // Sort
  switch (filters.sortBy) {
    case "price-asc":
      filtered.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      filtered.sort((a, b) => b.price - a.price);
      break;
    case "newest":
    default:
      // Default order (by id descending = newest first)
      filtered.sort((a, b) => b.id - a.id);
      break;
  }

  const totalItems = filtered.length;

  // Paginate
  const start = (filters.page - 1) * filters.itemsPerPage;
  const items = filtered.slice(start, start + filters.itemsPerPage);

  return { items, totalItems };
}
