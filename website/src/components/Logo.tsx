function LogomarkPaths() {
  return (
    <g fill="none" strokeLinejoin="round" strokeLinecap="round">
      {/* Arrow chevron - represents direction/flow */}
      <path
        d="M6 8 L16 18 L6 28"
        stroke="var(--brand-primary)"
        strokeWidth={3}
      />
      {/* Vertical constraint bar */}
      <path d="M24 8 L24 28" stroke="var(--brand-accent)" strokeWidth={3} />
    </g>
  );
}

export function Logomark(props: React.ComponentPropsWithoutRef<"svg">) {
  return (
    <svg aria-hidden="true" viewBox="0 0 36 36" fill="none" {...props}>
      <LogomarkPaths />
    </svg>
  );
}

export function Logo(props: React.ComponentPropsWithoutRef<"svg">) {
  return (
    <svg aria-hidden="true" viewBox="0 0 150 36" fill="none" {...props}>
      <LogomarkPaths />
      <text
        x="38"
        y="25"
        className="fill-slate-900 dark:fill-white"
        style={{
          fontFamily: "var(--font-lexend), system-ui, sans-serif",
          fontSize: "18px",
          fontWeight: 500,
          letterSpacing: "-0.025em",
        }}
      >
        directive
      </text>
    </svg>
  );
}
