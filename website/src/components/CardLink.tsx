import { clsx } from "clsx";
import Link from "next/link";

export function CardLink({
  href,
  external,
  className,
  rounded = "rounded-xl",
  children,
}: {
  href: string;
  external?: boolean;
  className?: string;
  rounded?: string;
  children: React.ReactNode;
}) {
  const Tag = external ? "a" : Link;
  const externalProps = external
    ? { target: "_blank" as const, rel: "noopener noreferrer" }
    : {};

  return (
    <Tag
      href={href}
      {...externalProps}
      className={clsx(
        "group relative flex flex-col border border-slate-200 bg-white outline-none dark:border-slate-700 dark:bg-slate-800",
        "focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900",
        rounded,
      )}
    >
      {/* Gradient border overlay */}
      <div
        className={clsx(
          "absolute -inset-px border-2 border-transparent opacity-0",
          "[background:linear-gradient(var(--card-hover-bg,var(--brand-primary-50)),var(--card-hover-bg,var(--brand-primary-50)))_padding-box,linear-gradient(to_top,var(--brand-accent-400),var(--brand-primary-400),var(--brand-primary-500))_border-box]",
          "group-hover:opacity-100 group-focus-visible:opacity-100",
          "dark:[--card-hover-bg:var(--color-slate-800)]",
          rounded,
        )}
      />

      {/* Content */}
      <div
        className={clsx("relative flex-1 overflow-hidden", rounded, className)}
      >
        {children}
      </div>
    </Tag>
  );
}
