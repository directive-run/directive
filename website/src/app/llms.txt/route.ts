import { getPublishedPosts } from "@/lib/blog";
import { aiNavigation, docsNavigation } from "@/lib/navigation";

export function GET() {
  const baseUrl = "https://directive.run";

  const lines: string[] = [
    "# Directive",
    "",
    "> Constraint-driven state management for TypeScript",
    "",
    "Directive is a runtime that automatically resolves what your system needs. Declare constraints (what must be true), let resolvers fulfill requirements (how to make it true), and inspect everything with time-travel debugging.",
    "",
    "## Documentation",
    "",
  ];

  for (const section of docsNavigation) {
    lines.push(`### ${section.title}`);
    for (const link of section.links) {
      lines.push(`- [${link.title}](${baseUrl}${link.href})`);
    }
    lines.push("");
  }

  lines.push("## AI");
  lines.push("");

  for (const section of aiNavigation) {
    lines.push(`### ${section.title}`);
    for (const link of section.links) {
      lines.push(`- [${link.title}](${baseUrl}${link.href})`);
    }
    lines.push("");
  }

  lines.push("## Blog");
  lines.push("");
  for (const post of getPublishedPosts()) {
    lines.push(
      `- [${post.title}](${baseUrl}/blog/${post.slug}): ${post.description}`,
    );
  }
  lines.push("");

  lines.push("## Links");
  lines.push("");
  lines.push(`- [Homepage](${baseUrl})`);
  lines.push(`- [GitHub](https://github.com/directive-run/directive)`);
  lines.push(`- [npm](https://www.npmjs.com/package/directive)`);
  lines.push("");

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
