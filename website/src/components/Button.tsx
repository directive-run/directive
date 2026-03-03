import clsx from "clsx";
import Link from "next/link";

const variantStyles = {
  primary:
    "cursor-pointer rounded-full bg-brand-primary-300 py-3 px-6 sm:py-2 sm:px-4 text-sm font-semibold text-slate-900 hover:bg-brand-primary-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary-300/50 active:bg-brand-primary-500",
  secondary:
    "cursor-pointer rounded-full bg-slate-800 py-3 px-6 sm:py-2 sm:px-4 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50 active:text-slate-400",
};

type ButtonProps = {
  variant?: keyof typeof variantStyles;
} & (
  | React.ComponentPropsWithoutRef<typeof Link>
  | (React.ComponentPropsWithoutRef<"button"> & { href?: undefined })
);

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonProps) {
  className = clsx(variantStyles[variant], className);

  return typeof props.href === "undefined" ? (
    <button className={className} {...props} />
  ) : (
    <Link className={className} {...props} />
  );
}
