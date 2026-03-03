import clsx from "clsx";
import Link from "next/link";

interface DirectiveCalloutProps {
  /** What "this" refers to, e.g. "form", "signup", "chat" */
  subject: string;
  /** Link to related blog post or docs page */
  href: string;
  /** Link label (default: "Read how it works") */
  linkLabel?: string;
  /** Compact variant for tight spaces like chat widgets */
  compact?: boolean;
}

export function DirectiveCallout({
  subject,
  href,
  linkLabel = "Read how it works",
  compact = false,
}: DirectiveCalloutProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-brand-primary-200/60 bg-brand-primary-50/60 dark:border-brand-primary-800/20 dark:bg-brand-primary-950/10",
        compact ? "rounded-lg px-3 py-2" : "px-5 py-4",
      )}
    >
      <p
        className={clsx(
          "text-slate-600 dark:text-slate-400",
          compact ? "text-xs" : "text-sm",
        )}
      >
        <span className="font-semibold text-slate-900 dark:text-white">
          Powered by Directive.
        </span>{" "}
        This {subject} uses a Directive module with facts, derivations,
        constraints, and resolvers &ndash; zero{" "}
        <code
          className={clsx(
            "rounded bg-slate-100 dark:bg-slate-700",
            compact ? "px-1 py-0.5 text-[10px]" : "px-1.5 py-0.5 text-xs",
          )}
        >
          useState
        </code>
        , zero{" "}
        <code
          className={clsx(
            "rounded bg-slate-100 dark:bg-slate-700",
            compact ? "px-1 py-0.5 text-[10px]" : "px-1.5 py-0.5 text-xs",
          )}
        >
          useEffect
        </code>
        .{" "}
        <Link
          href={href}
          className="font-medium text-brand-primary hover:underline dark:text-brand-primary-400"
        >
          {linkLabel} &rarr;
        </Link>
      </p>
    </div>
  );
}
