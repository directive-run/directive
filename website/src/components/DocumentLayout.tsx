import type { Node } from "@markdoc/markdoc";

import { BlogPostLayout } from "@/components/BlogPostLayout";
import { DocsLayout } from "@/components/DocsLayout";

interface DocumentFrontmatter {
  title?: string;
  description?: string;
  layout?: string;
  date?: string;
  author?: string;
  categories?: string[];
}

export function DocumentLayout({
  children,
  frontmatter,
  nodes,
}: {
  children: React.ReactNode;
  frontmatter: DocumentFrontmatter;
  nodes: Array<Node>;
}) {
  if (frontmatter?.layout === "blog") {
    return (
      <BlogPostLayout frontmatter={frontmatter} nodes={nodes}>
        {children}
      </BlogPostLayout>
    );
  }

  return (
    <DocsLayout frontmatter={frontmatter} nodes={nodes}>
      {children}
    </DocsLayout>
  );
}
