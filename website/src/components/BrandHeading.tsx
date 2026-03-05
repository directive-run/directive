import clsx from "clsx";

const alignMap = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
} as const;

export function BrandHeading({
  children,
  as: Tag = "p",
  align = "right",
  className,
}: {
  children: React.ReactNode;
  as?: "h1" | "h2" | "h3" | "h4" | "p" | "span";
  align?: "left" | "center" | "right";
  className?: string;
}) {
  return (
    <Tag
      className={clsx(
        "font-display text-3xl font-semibold tracking-tight sm:text-4xl",
        alignMap[align],
        className,
      )}
    >
      <span className="brand-heading-gradient inline bg-clip-text text-transparent">
        {children}
      </span>
    </Tag>
  );
}
