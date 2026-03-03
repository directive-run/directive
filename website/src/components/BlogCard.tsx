import Link from "next/link";

import type { BlogPost } from "@/lib/blog";
import { resolveAuthor } from "@/lib/blog";

function formatDate(dateStr: string): string {
  const date = new Date(
    dateStr.includes("T") ? dateStr : dateStr + "T00:00:00",
  );

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function BlogCard({ post }: { post: BlogPost }) {
  const author = resolveAuthor(post.author);

  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group rounded-3xl bg-white p-2 shadow-sm ring-1 ring-slate-900/[0.04] transition-shadow hover:shadow-lg dark:bg-slate-800/80 dark:ring-brand-primary-400/[0.08]"
    >
      <div className="relative aspect-[16/9] overflow-hidden rounded-2xl [background:linear-gradient(to_bottom_right,var(--brand-primary-200),var(--brand-accent-200),var(--brand-primary-300))] dark:[background:linear-gradient(to_bottom_right,var(--brand-primary-900),var(--brand-accent-900),var(--brand-primary-800))]">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-16 w-16 rounded-2xl bg-white/20 backdrop-blur-sm dark:bg-white/10" />
        </div>
      </div>
      <div className="px-4 pt-4 pb-5">
        <time
          dateTime={post.date}
          className="text-xs font-medium text-slate-500 dark:text-slate-400"
        >
          {formatDate(post.date)}
        </time>
        <h3 className="mt-1 text-lg font-semibold text-slate-900 group-hover:text-brand-primary dark:text-white dark:group-hover:text-brand-primary-400">
          {post.title}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">
          {post.description}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <div
            className="h-6 w-6 rounded-full"
            style={{
              background:
                "linear-gradient(to bottom right, var(--brand-primary-400), var(--brand-accent-400))",
            }}
          />
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            {author.name}
          </span>
        </div>
      </div>
    </Link>
  );
}
