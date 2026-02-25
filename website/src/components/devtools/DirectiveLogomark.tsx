export function DirectiveLogomark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 36 36" fill="none" className={className}>
      <g fill="none" strokeLinejoin="round" strokeLinecap="round">
        <path d="M6 8 L16 18 L6 28" stroke="var(--brand-primary)" strokeWidth={3} />
        <path d="M24 8 L24 28" stroke="var(--brand-accent)" strokeWidth={3} />
      </g>
    </svg>
  )
}
