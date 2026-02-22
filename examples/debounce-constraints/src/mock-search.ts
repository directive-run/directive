export interface SearchResult {
  id: string;
  title: string;
  category: string;
}

export const MOCK_DATA: SearchResult[] = [
  { id: "1", title: "JavaScript", category: "Language" },
  { id: "2", title: "TypeScript", category: "Language" },
  { id: "3", title: "Python", category: "Language" },
  { id: "4", title: "Rust", category: "Language" },
  { id: "5", title: "Go", category: "Language" },
  { id: "6", title: "Java", category: "Language" },
  { id: "7", title: "C++", category: "Language" },
  { id: "8", title: "Swift", category: "Language" },
  { id: "9", title: "Kotlin", category: "Language" },
  { id: "10", title: "Ruby", category: "Language" },
  { id: "11", title: "React", category: "Framework" },
  { id: "12", title: "Vue", category: "Framework" },
  { id: "13", title: "Angular", category: "Framework" },
  { id: "14", title: "Svelte", category: "Framework" },
  { id: "15", title: "Solid", category: "Framework" },
  { id: "16", title: "Next.js", category: "Framework" },
  { id: "17", title: "Remix", category: "Framework" },
  { id: "18", title: "Astro", category: "Framework" },
  { id: "19", title: "Node.js", category: "Runtime" },
  { id: "20", title: "Deno", category: "Runtime" },
  { id: "21", title: "Bun", category: "Runtime" },
  { id: "22", title: "PostgreSQL", category: "Database" },
  { id: "23", title: "MongoDB", category: "Database" },
  { id: "24", title: "Redis", category: "Database" },
  { id: "25", title: "SQLite", category: "Database" },
  { id: "26", title: "Docker", category: "Tool" },
  { id: "27", title: "Kubernetes", category: "Tool" },
  { id: "28", title: "Git", category: "Tool" },
  { id: "29", title: "Webpack", category: "Tool" },
  { id: "30", title: "Vite", category: "Tool" },
];

export async function mockSearch(
  query: string,
  delay: number,
): Promise<SearchResult[]> {
  await new Promise((resolve) => setTimeout(resolve, delay));
  const q = query.toLowerCase();

  return MOCK_DATA.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q),
  );
}
