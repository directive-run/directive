"use client";

const DARK_SLATE = "#0f172a";
const INDIGO = "#6366f1";
const SKY = "#0ea5e9";
const WHITE = "#ffffff";

interface ConceptProps {
  size?: number;
  className?: string;
  darkBg?: boolean;
}

function Wrapper({
  children,
  size = 36,
  className,
  darkBg,
  viewBox = "0 0 36 36",
}: ConceptProps & { children: React.ReactNode; viewBox?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={viewBox}
      fill="none"
      width={size}
      height={size}
      className={className}
      style={darkBg ? { backgroundColor: DARK_SLATE, borderRadius: 4 } : undefined}
    >
      {children}
    </svg>
  );
}

/** #1: The Resolver — three lines converging to a luminous point */
export function ResolverMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      <line x1="4" y1="7" x2="27" y2="18" stroke={INDIGO} strokeWidth={2.5} strokeLinecap="round" />
      <line x1="4" y1="18" x2="27" y2="18" stroke="#4f8af0" strokeWidth={2.5} strokeLinecap="round" />
      <line x1="4" y1="29" x2="27" y2="18" stroke={SKY} strokeWidth={2.5} strokeLinecap="round" />
      <circle cx="29" cy="18" r="3.5" fill={SKY} opacity={0.85} />
    </Wrapper>
  );
}

/** #2: The Sentinel — geometric eye with diamond pupil */
export function SentinelMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      <path d="M 4,18 C 4,6 32,6 32,18" stroke={INDIGO} strokeWidth={2.5} fill="none" strokeLinecap="round" />
      <path d="M 4,18 C 4,30 32,30 32,18" stroke={SKY} strokeWidth={2.5} fill="none" strokeLinecap="round" />
      <path d="M 18,13 L 23,18 L 18,23 L 13,18 Z" fill={WHITE} />
    </Wrapper>
  );
}

/** #3: The Bound Arrow — arrow passing through constraint bars */
export function BoundArrowMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      <line x1="12" y1="6" x2="12" y2="30" stroke={INDIGO} strokeWidth={2.5} strokeLinecap="round" />
      <line x1="22" y1="6" x2="22" y2="30" stroke={INDIGO} strokeWidth={2.5} strokeLinecap="round" />
      <line x1="5" y1="18" x2="29" y2="18" stroke={SKY} strokeWidth={2.5} strokeLinecap="round" />
      <path d="M 26,13 L 32,18 L 26,23" stroke={SKY} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Wrapper>
  );
}

/** #4: The Equilibrium — opposing chevrons with center dot */
export function EquilibriumMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      <path d="M 14,7 L 5,18 L 14,29" stroke={INDIGO} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 22,7 L 31,18 L 22,29" stroke={SKY} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18" cy="18" r="2.5" fill={WHITE} />
    </Wrapper>
  );
}

/** #5: The Glyph — refined chevron + notched constraint bar */
export function GlyphMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      <path d="M 6,8 L 16,18 L 6,28" stroke={SKY} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="24" y1="8" x2="24" y2="14" stroke={INDIGO} strokeWidth={3} strokeLinecap="round" />
      <line x1="24" y1="22" x2="24" y2="28" stroke={INDIGO} strokeWidth={3} strokeLinecap="round" />
      <circle cx="24" cy="18" r="2" fill={INDIGO} />
    </Wrapper>
  );
}

/** #6: Constraint Diamond — split rotated square */
export function DiamondMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      <path d="M 18,4 L 32,17.25 L 4,17.25 Z" fill={INDIGO} />
      <path d="M 4,18.75 L 32,18.75 L 18,32 Z" fill={SKY} />
    </Wrapper>
  );
}

/** #8: The Lattice — constraint network with resolve path */
export function LatticeMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      {/* Grid connections (faint) */}
      <line x1="8" y1="8" x2="28" y2="8" stroke={INDIGO} strokeWidth={1.5} opacity={0.3} />
      <line x1="8" y1="8" x2="8" y2="28" stroke={INDIGO} strokeWidth={1.5} opacity={0.3} />
      <line x1="8" y1="28" x2="28" y2="28" stroke={SKY} strokeWidth={1.5} opacity={0.3} />
      <line x1="28" y1="8" x2="28" y2="28" stroke={SKY} strokeWidth={1.5} opacity={0.3} />
      {/* Resolve path (highlighted diagonal) */}
      <line x1="8" y1="8" x2="18" y2="18" stroke={INDIGO} strokeWidth={2} strokeLinecap="round" />
      <line x1="18" y1="18" x2="28" y2="28" stroke={SKY} strokeWidth={2} strokeLinecap="round" />
      {/* Corner nodes */}
      <circle cx="8" cy="8" r="2.5" fill={INDIGO} />
      <circle cx="28" cy="8" r="2.5" fill={INDIGO} opacity={0.35} />
      <circle cx="8" cy="28" r="2.5" fill={SKY} opacity={0.35} />
      <circle cx="28" cy="28" r="2.5" fill={SKY} />
      {/* Center node (settlement) */}
      <circle cx="18" cy="18" r="3.5" fill={WHITE} />
    </Wrapper>
  );
}

/** #9: The Fulcrum — balance beam on triangular fulcrum */
export function FulcrumMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      {/* Horizontal beam */}
      <line x1="4" y1="14" x2="32" y2="14" stroke={INDIGO} strokeWidth={2.5} strokeLinecap="round" />
      {/* Fulcrum triangle */}
      <path d="M 18,14 L 11,29 L 25,29 Z" fill="none" stroke={SKY} strokeWidth={2.5} strokeLinejoin="round" />
      {/* Balance point */}
      <circle cx="18" cy="14" r="3" fill={WHITE} />
    </Wrapper>
  );
}

/** #10: The Signal — broadcast arcs from source node */
export function SignalMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      {/* Source node */}
      <circle cx="7" cy="18" r="3.5" fill={SKY} />
      {/* Arc 1 (closest) */}
      <path d="M 15,10 A 10,10 0 0,1 15,26" stroke={INDIGO} strokeWidth={2} fill="none" strokeLinecap="round" />
      {/* Arc 2 (middle) */}
      <path d="M 22,7 A 14,14 0 0,1 22,29" stroke={INDIGO} strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.55} />
      {/* Arc 3 (farthest) */}
      <path d="M 29,4 A 18,18 0 0,1 29,32" stroke={SKY} strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.3} />
    </Wrapper>
  );
}

/** #11: The Axis — multi-dimensional constraint space */
export function AxisMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      {/* X axis (right) */}
      <line x1="18" y1="18" x2="32" y2="18" stroke={SKY} strokeWidth={2.5} strokeLinecap="round" />
      {/* Y axis (up) */}
      <line x1="18" y1="18" x2="18" y2="4" stroke={INDIGO} strokeWidth={2.5} strokeLinecap="round" />
      {/* Z axis (lower-left, depth) */}
      <line x1="18" y1="18" x2="7" y2="29" stroke={INDIGO} strokeWidth={2.5} strokeLinecap="round" opacity={0.5} />
      {/* Endpoint marks */}
      <circle cx="32" cy="18" r="1.5" fill={SKY} />
      <circle cx="18" cy="4" r="1.5" fill={INDIGO} />
      <circle cx="7" cy="29" r="1.5" fill={INDIGO} opacity={0.5} />
      {/* Origin node */}
      <circle cx="18" cy="18" r="3.5" fill={WHITE} />
    </Wrapper>
  );
}

/** #12: The Compass — directional diamond with constraint ring */
export function CompassMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      {/* Upper half of needle */}
      <path d="M 5,18 L 18,10 L 31,18 Z" fill={INDIGO} />
      {/* Lower half of needle */}
      <path d="M 5,18 L 18,26 L 31,18 Z" fill={SKY} />
      {/* Center constraint ring */}
      <circle cx="18" cy="18" r="4" fill="none" stroke={WHITE} strokeWidth={1.5} />
      {/* Center pivot */}
      <circle cx="18" cy="18" r="1.5" fill={WHITE} />
    </Wrapper>
  );
}

/** Current mark for comparison */
export function CurrentMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      <g fill="none" strokeLinejoin="round" strokeLinecap="round">
        <path d="M6 8 L16 18 L6 28" stroke={SKY} strokeWidth={3} />
        <path d="M24 8 L24 28" stroke={INDIGO} strokeWidth={3} />
      </g>
    </Wrapper>
  );
}

/* ─── Midjourney-Inspired Concepts ────────────────────────────── */

/** MJ-1: D Monogram — letter D with vertical bar + curved arrow shape */
export function DMonogramMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      {/* Vertical bar (left stroke of the D) */}
      <rect x="7" y="5" width="5" height="26" rx="1" fill={WHITE} />
      {/* Upper D curve (indigo) */}
      <path d="M12,5 C23,5 29,10 29,18 L12,18 Z" fill={INDIGO} />
      {/* Lower D curve (sky blue) */}
      <path d="M12,18 L29,18 C29,26 23,31 12,31 Z" fill={SKY} />
    </Wrapper>
  );
}

/** MJ-2: Sentinel Woven — interweaving arcs with diamond pupil */
export function SentinelWovenMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      {/* Upper arc (indigo) — offset slightly down-left */}
      <path d="M6,20 Q18,3 30,20" stroke={INDIGO} strokeWidth={3.5} fill="none" strokeLinecap="round" />
      {/* Lower arc (sky) — offset slightly up-right */}
      <path d="M6,16 Q18,33 30,16" stroke={SKY} strokeWidth={3.5} fill="none" strokeLinecap="round" />
      {/* Diamond pupil */}
      <path d="M18,14.5 L21.5,18 L18,21.5 L14.5,18 Z" fill={WHITE} />
    </Wrapper>
  );
}

/** MJ-3: Quadrant Diamond — four-section rotated square */
export function QuadrantDiamondMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      {/* Top quadrant (dark) */}
      <path d="M18,4 L32,18 L18,18 Z" fill="#1e3a5f" />
      {/* Left quadrant (dark) */}
      <path d="M4,18 L18,4 L18,18 Z" fill="#1a3152" />
      {/* Bottom quadrant (sky blue) */}
      <path d="M18,32 L4,18 L18,18 Z" fill={SKY} />
      {/* Right quadrant (medium blue) */}
      <path d="M32,18 L18,32 L18,18 Z" fill="#38bdf8" />
    </Wrapper>
  );
}

/** MJ-4: Double Chevron — two stacked right-pointing filled arrows */
export function DoubleChevronMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      {/* Back chevron (indigo) */}
      <path d="M4,7 L17,18 L4,29 Z" fill={INDIGO} />
      {/* Front chevron (sky blue) */}
      <path d="M16,7 L29,18 L16,29 Z" fill={SKY} />
    </Wrapper>
  );
}

/** MJ-5: Equilibrium Bold — filled diamond-chevrons with center dot */
export function EquilibriumBoldMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      {/* Left diamond-chevron (indigo) */}
      <path d="M4,18 L15,7 L15,29 Z" fill={INDIGO} />
      {/* Right diamond-chevron (sky blue) */}
      <path d="M32,18 L21,7 L21,29 Z" fill={SKY} />
      {/* Center dot */}
      <circle cx="18" cy="18" r="3" fill={WHITE} />
    </Wrapper>
  );
}

/** MJ-6: Broadcast — circle with thick concentric arcs */
export function BroadcastMark(props: ConceptProps) {
  return (
    <Wrapper {...props}>
      {/* Source circle */}
      <circle cx="8" cy="18" r="4.5" fill={SKY} />
      {/* Arc 1 (closest, sky-teal) */}
      <path d="M16,10 A10,10 0 0,1 16,26" stroke="#0891b2" strokeWidth={3.5} fill="none" strokeLinecap="round" />
      {/* Arc 2 (middle, indigo-blue) */}
      <path d="M23,6 A14,14 0 0,1 23,30" stroke={INDIGO} strokeWidth={3.5} fill="none" strokeLinecap="round" />
      {/* Arc 3 (farthest, dark) */}
      <path d="M30,2 A18,18 0 0,1 30,34" stroke="#1e3a5f" strokeWidth={3.5} fill="none" strokeLinecap="round" />
    </Wrapper>
  );
}

/** AI-1: D Monogram Traced — Illustrator trace of Midjourney D letterform */
export function DMonogramTracedMark(props: ConceptProps) {
  return (
    <Wrapper {...props} viewBox="0 0 411.6 446.1">
      {/* Vertical bar */}
      <polygon points="105.5 445.12 105.48 446 0 446.1 0 .13 105.29 .15 105.5 445.12" fill="#e5e8ec" />
      {/* Lower D curve (sky) */}
      <path d="M105.48,446l.02-.88c.68-.39,1.78-1.14,2.7-2.07l110.1-110.61,15.59-15.76,90.58-91.02c1.37-1.51,2.2-2.81,2.74-4.24,2.86-1.6,5.24-3.72,7.91-6.4l64.26-64.55c5.93,22.62,11.7,45.66,12.17,69.86.56,28.8-4.32,56-14.29,82.95-19.91,53.8-59.13,98.45-111.34,122.77-28.36,13.21-53.68,20.05-85.67,20.02l-94.77-.07Z" fill="#01cbe7" />
      {/* Upper D curve (dark blue) */}
      <path d="M105.85.46l17.52-.46,77.95.27c51.09.17,98.81,21.03,136.61,54.53,8.01,7.1,15.23,14.59,21.99,22.86,12.65,15.47,32.54,46.44,37.36,64.8l2.1,8.02-64.26,64.55c-2.67,2.68-5.05,4.81-7.91,6.4-1-.77-1.92-1.56-3.31-2.95" fill="#0389c9" />
    </Wrapper>
  );
}

// All concepts for iteration
export const LOGO_CONCEPTS = [
  { id: "current", name: "Current", rank: "—", Component: CurrentMark, description: "Chevron + constraint bar" },
  { id: "resolver", name: "The Resolver", rank: "#1", Component: ResolverMark, description: "Three lines converging to a luminous point" },
  { id: "sentinel", name: "The Sentinel", rank: "#2", Component: SentinelMark, description: "Geometric eye with diamond pupil" },
  { id: "bound-arrow", name: "The Bound Arrow", rank: "#3", Component: BoundArrowMark, description: "Arrow passing through constraint bars" },
  { id: "equilibrium", name: "The Equilibrium", rank: "#4", Component: EquilibriumMark, description: "Opposing chevrons with center dot" },
  { id: "compass", name: "The Compass", rank: "#5", Component: CompassMark, description: "Directional diamond with constraint ring" },
  { id: "lattice", name: "The Lattice", rank: "#6", Component: LatticeMark, description: "Constraint network with resolve path" },
  { id: "glyph", name: "The Glyph", rank: "#7", Component: GlyphMark, description: "Refined chevron + notched bar" },
  { id: "diamond", name: "Constraint Diamond", rank: "#8", Component: DiamondMark, description: "Split rotated square" },
  { id: "fulcrum", name: "The Fulcrum", rank: "#9", Component: FulcrumMark, description: "Balance beam on triangular fulcrum" },
  { id: "signal", name: "The Signal", rank: "#10", Component: SignalMark, description: "Broadcast arcs from source node" },
  { id: "axis", name: "The Axis", rank: "#11", Component: AxisMark, description: "Multi-dimensional constraint space" },
  { id: "d-monogram", name: "D Monogram", rank: "MJ", Component: DMonogramMark, description: "Letter D with bar + curved arrow" },
  { id: "sentinel-woven", name: "Sentinel Woven", rank: "MJ", Component: SentinelWovenMark, description: "Interweaving arcs with diamond pupil" },
  { id: "quadrant-diamond", name: "Quadrant Diamond", rank: "MJ", Component: QuadrantDiamondMark, description: "Four-section rotated square" },
  { id: "double-chevron", name: "Double Chevron", rank: "MJ", Component: DoubleChevronMark, description: "Two stacked right-pointing arrows" },
  { id: "equilibrium-bold", name: "Equilibrium Bold", rank: "MJ", Component: EquilibriumBoldMark, description: "Filled diamond-chevrons with dot" },
  { id: "broadcast", name: "The Broadcast", rank: "MJ", Component: BroadcastMark, description: "Circle with thick concentric arcs" },
  { id: "d-monogram-traced", name: "D Monogram (AI)", rank: "AI", Component: DMonogramTracedMark, description: "Illustrator-traced D letterform" },
] as const;
