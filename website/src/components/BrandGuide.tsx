"use client";

import { CaretDown } from "@phosphor-icons/react";
import clsx from "clsx";
import { useEffect, useState } from "react";

const GOOGLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Outfit:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Source+Sans+3:wght@400;500;600;700&family=Source+Code+Pro:wght@400;500&family=Bricolage+Grotesque:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap";

function useFontLoader() {
  useEffect(() => {
    if (document.querySelector("link[data-brand-fonts]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_URL;
    link.setAttribute("data-brand-fonts", "true");
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, []);
}

// ================================================================
// DATA
// ================================================================

const SHADES = [
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
] as const;

const SCALES: Record<string, Record<string, string>> = {
  blue: {
    "50": "#eff6ff",
    "100": "#dbeafe",
    "200": "#bfdbfe",
    "300": "#93c5fd",
    "400": "#60a5fa",
    "500": "#3b82f6",
    "600": "#2563eb",
    "700": "#1d4ed8",
    "800": "#1e40af",
    "900": "#1e3a8a",
    "950": "#172554",
  },
  indigo: {
    "50": "#eef2ff",
    "100": "#e0e7ff",
    "200": "#c7d2fe",
    "300": "#a5b4fc",
    "400": "#818cf8",
    "500": "#6366f1",
    "600": "#4f46e5",
    "700": "#4338ca",
    "800": "#3730a3",
    "900": "#312e81",
    "950": "#1e1b4b",
  },
  violet: {
    "50": "#f5f3ff",
    "100": "#ede9fe",
    "200": "#ddd6fe",
    "300": "#c4b5fd",
    "400": "#a78bfa",
    "500": "#8b5cf6",
    "600": "#7c3aed",
    "700": "#6d28d9",
    "800": "#5b21b6",
    "900": "#4c1d95",
    "950": "#2e1065",
  },
  teal: {
    "50": "#f0fdfa",
    "100": "#ccfbf1",
    "200": "#99f6e4",
    "300": "#5eead4",
    "400": "#2dd4bf",
    "500": "#14b8a6",
    "600": "#0d9488",
    "700": "#0f766e",
    "800": "#115e59",
    "900": "#134e4a",
    "950": "#042f2e",
  },
  emerald: {
    "50": "#ecfdf5",
    "100": "#d1fae5",
    "200": "#a7f3d0",
    "300": "#6ee7b7",
    "400": "#34d399",
    "500": "#10b981",
    "600": "#059669",
    "700": "#047857",
    "800": "#065f46",
    "900": "#064e3b",
    "950": "#022c22",
  },
  amber: {
    "50": "#fffbeb",
    "100": "#fef3c7",
    "200": "#fde68a",
    "300": "#fcd34d",
    "400": "#fbbf24",
    "500": "#f59e0b",
    "600": "#d97706",
    "700": "#b45309",
    "800": "#92400e",
    "900": "#78350f",
    "950": "#451a03",
  },
  sky: {
    "50": "#f0f9ff",
    "100": "#e0f2fe",
    "200": "#bae6fd",
    "300": "#7dd3fc",
    "400": "#38bdf8",
    "500": "#0ea5e9",
    "600": "#0284c7",
    "700": "#0369a1",
    "800": "#075985",
    "900": "#0c4a6e",
    "950": "#082f49",
  },
  slate: {
    "50": "#f8fafc",
    "100": "#f1f5f9",
    "200": "#e2e8f0",
    "300": "#cbd5e1",
    "400": "#94a3b8",
    "500": "#64748b",
    "600": "#475569",
    "700": "#334155",
    "800": "#1e293b",
    "900": "#0f172a",
    "950": "#020617",
  },
  rose: {
    "50": "#fff1f2",
    "100": "#ffe4e6",
    "200": "#fecdd3",
    "300": "#fda4af",
    "400": "#fb7185",
    "500": "#f43f5e",
    "600": "#e11d48",
    "700": "#be123c",
    "800": "#9f1239",
    "900": "#881337",
    "950": "#4c0519",
  },
  cyan: {
    "50": "#ecfeff",
    "100": "#cffafe",
    "200": "#a5f3fc",
    "300": "#67e8f9",
    "400": "#22d3ee",
    "500": "#06b6d4",
    "600": "#0891b2",
    "700": "#0e7490",
    "800": "#155e75",
    "900": "#164e63",
    "950": "#083344",
  },
  zinc: {
    "50": "#fafafa",
    "100": "#f4f4f5",
    "200": "#e4e4e7",
    "300": "#d4d4d8",
    "400": "#a1a1aa",
    "500": "#71717a",
    "600": "#52525b",
    "700": "#3f3f46",
    "800": "#27272a",
    "900": "#18181b",
    "950": "#09090b",
  },
  lime: {
    "50": "#f7fee7",
    "100": "#ecfccb",
    "200": "#d9f99d",
    "300": "#bef264",
    "400": "#a3e635",
    "500": "#84cc16",
    "600": "#65a30d",
    "700": "#4d7c0f",
    "800": "#3f6212",
    "900": "#365314",
    "950": "#1a2e05",
  },
  fuchsia: {
    "50": "#fdf4ff",
    "100": "#fae8ff",
    "200": "#f5d0fe",
    "300": "#f0abfc",
    "400": "#e879f9",
    "500": "#d946ef",
    "600": "#c026d3",
    "700": "#a21caf",
    "800": "#86198f",
    "900": "#701a75",
    "950": "#4a044e",
  },
  orange: {
    "50": "#fff7ed",
    "100": "#ffedd5",
    "200": "#fed7aa",
    "300": "#fdba74",
    "400": "#fb923c",
    "500": "#f97316",
    "600": "#ea580c",
    "700": "#c2410c",
    "800": "#9a3412",
    "900": "#7c2d12",
    "950": "#431407",
  },
};

const COLOR_CANDIDATES = [
  {
    name: "Blue",
    key: "blue",
    hex: "#3B82F6",
    source: "User pick",
    notes: "Cool, confident, infrastructure-grade",
  },
  {
    name: "Indigo",
    key: "indigo",
    hex: "#6366F1",
    source: "User pick",
    notes: "Blue-purple bridge, dev tooling sweet spot",
  },
  {
    name: "Purple",
    key: "violet",
    hex: "#7C3AED",
    source: "User pick",
    notes: "Intelligent, authoritative",
  },
  {
    name: "Electric Teal",
    key: "teal",
    hex: "#14B8A6",
    source: "AI pick",
    notes: "Fresh, distinctive, breaks from blue ecosystem",
  },
  {
    name: "Emerald",
    key: "emerald",
    hex: "#10B981",
    source: "AI pick",
    notes: '"Resolved, handled"  -- aligns with product promise',
  },
  {
    name: "Amber/Gold",
    key: "amber",
    hex: "#F59E0B",
    source: "AI pick",
    notes: "Bold, uncommon in dev tools",
  },
  {
    name: "Sky Blue",
    key: "sky",
    hex: "#0EA5E9",
    source: "Current",
    notes: "Reference only  -- very common in TS ecosystem",
  },
  {
    name: "Rose",
    key: "rose",
    hex: "#F43F5E",
    source: "AI pick",
    notes: "Warm energy, bold and distinctive",
  },
  {
    name: "Cyan",
    key: "cyan",
    hex: "#06B6D4",
    source: "AI pick",
    notes: "Cool precision, strong dark-mode contrast",
  },
  {
    name: "Zinc",
    key: "zinc",
    hex: "#71717A",
    source: "AI pick",
    notes: "Muted authority, pairs with bright accents",
  },
  {
    name: "Lime",
    key: "lime",
    hex: "#84CC16",
    source: "AI pick",
    notes: "High-energy accent, terminal green vibes",
  },
  {
    name: "Fuchsia",
    key: "fuchsia",
    hex: "#D946EF",
    source: "AI pick",
    notes: "Vibrant, creative, maximum energy",
  },
  {
    name: "Orange",
    key: "orange",
    hex: "#F97316",
    source: "AI pick",
    notes: "Urgent energy, uncommon in dev tools",
  },
];

const COMBOS = [
  {
    id: "A",
    primary: { name: "Purple", hex: "#7C3AED", key: "violet" },
    accent: { name: "Emerald", hex: "#10B981", key: "emerald" },
    gradient: { from: "#ddd6fe", via: "#34d399", to: "#ddd6fe" },
    verdict: 'Product & Strategy favorite  -- "intelligence that delivers"',
  },
  {
    id: "B",
    primary: { name: "Teal", hex: "#14B8A6", key: "teal" },
    accent: { name: "Purple", hex: "#7C3AED", key: "violet" },
    gradient: { from: "#99f6e4", via: "#a78bfa", to: "#99f6e4" },
    verdict: "UX & Marketing favorite  -- best accessibility, fresh",
  },
  {
    id: "C",
    primary: { name: "Indigo", hex: "#6366F1", key: "indigo" },
    accent: { name: "Emerald", hex: "#10B981", key: "emerald" },
    gradient: { from: "#c7d2fe", via: "#34d399", to: "#c7d2fe" },
    verdict: "Technical precision + resolution",
  },
  {
    id: "D",
    primary: { name: "Purple", hex: "#7C3AED", key: "violet" },
    accent: { name: "Amber", hex: "#F59E0B", key: "amber" },
    gradient: { from: "#ddd6fe", via: "#fbbf24", to: "#ddd6fe" },
    verdict: "Authority + bold command",
  },
  {
    id: "E",
    primary: { name: "Blue", hex: "#3B82F6", key: "blue" },
    accent: { name: "Teal", hex: "#14B8A6", key: "teal" },
    gradient: { from: "#bfdbfe", via: "#2dd4bf", to: "#bfdbfe" },
    verdict: "Trusted + modern",
  },
  {
    id: "F",
    primary: { name: "Indigo", hex: "#6366F1", key: "indigo" },
    accent: { name: "Amber", hex: "#F59E0B", key: "amber" },
    gradient: { from: "#c7d2fe", via: "#fbbf24", to: "#c7d2fe" },
    verdict: "Precision + authority",
  },
  {
    id: "G",
    primary: { name: "Purple", hex: "#7C3AED", key: "violet" },
    accent: { name: "Teal", hex: "#14B8A6", key: "teal" },
    gradient: { from: "#ddd6fe", via: "#2dd4bf", to: "#ddd6fe" },
    verdict: "Authority + energy",
  },
  {
    id: "H",
    primary: { name: "Blue", hex: "#3B82F6", key: "blue" },
    accent: { name: "Purple", hex: "#7C3AED", key: "violet" },
    gradient: { from: "#bfdbfe", via: "#a78bfa", to: "#bfdbfe" },
    verdict: "Trusted foundation + intelligent depth",
  },
  {
    id: "I",
    primary: { name: "Teal", hex: "#14B8A6", key: "teal" },
    accent: { name: "Amber", hex: "#F59E0B", key: "amber" },
    gradient: { from: "#99f6e4", via: "#fbbf24", to: "#99f6e4" },
    verdict: "Highest-contrast complementary pair, visually arresting",
  },
  {
    id: "J",
    primary: { name: "Indigo", hex: "#6366F1", key: "indigo" },
    accent: { name: "Teal", hex: "#14B8A6", key: "teal" },
    gradient: { from: "#c7d2fe", via: "#2dd4bf", to: "#c7d2fe" },
    verdict: "Cool-spectrum with excellent contrast ratios",
  },
  {
    id: "K",
    primary: { name: "Emerald", hex: "#10B981", key: "emerald" },
    accent: { name: "Purple", hex: "#7C3AED", key: "violet" },
    gradient: { from: "#a7f3d0", via: "#a78bfa", to: "#a7f3d0" },
    verdict: "Flipped A — green-primary, high trademark distinctiveness",
  },
  {
    id: "L",
    primary: { name: "Rose", hex: "#F43F5E", key: "rose" },
    accent: { name: "Cyan", hex: "#06B6D4", key: "cyan" },
    gradient: { from: "#fecdd3", via: "#22d3ee", to: "#fecdd3" },
    verdict: "Bold warmth balanced by cool precision",
  },
  {
    id: "M",
    primary: { name: "Zinc", hex: "#71717A", key: "zinc" },
    accent: { name: "Lime", hex: "#84CC16", key: "lime" },
    gradient: { from: "#d4d4d8", via: "#a3e635", to: "#d4d4d8" },
    verdict: "Understated base with high-energy accent",
  },
  {
    id: "N",
    primary: { name: "Fuchsia", hex: "#D946EF", key: "fuchsia" },
    accent: { name: "Teal", hex: "#14B8A6", key: "teal" },
    gradient: { from: "#f5d0fe", via: "#2dd4bf", to: "#f5d0fe" },
    verdict: "Vibrant energy with grounded cool accent",
  },
  {
    id: "O",
    primary: { name: "Slate", hex: "#64748B", key: "slate" },
    accent: { name: "Violet", hex: "#7C3AED", key: "violet" },
    gradient: { from: "#cbd5e1", via: "#a78bfa", to: "#cbd5e1" },
    verdict: "Professional restraint with intelligent accent",
  },
  {
    id: "P",
    primary: { name: "Orange", hex: "#F97316", key: "orange" },
    accent: { name: "Indigo", hex: "#6366F1", key: "indigo" },
    gradient: { from: "#fed7aa", via: "#818cf8", to: "#fed7aa" },
    verdict: "High-energy primary with deep precision accent",
  },
];

const FONT_PAIRINGS = [
  {
    id: 1,
    display: {
      name: "Space Grotesk",
      family: '"Space Grotesk", system-ui, sans-serif',
    },
    body: {
      name: "IBM Plex Sans",
      family: '"IBM Plex Sans", system-ui, sans-serif',
    },
    code: { name: "IBM Plex Mono", family: '"IBM Plex Mono", monospace' },
    notes:
      "Top pick (3/4 AEs) -- Technical authority, differentiated from ecosystem",
    topPick: true,
  },
  {
    id: 2,
    display: {
      name: "Space Grotesk",
      family: '"Space Grotesk", system-ui, sans-serif',
    },
    body: {
      name: "Geist Sans",
      family: '"Geist", system-ui, -apple-system, sans-serif',
    },
    code: {
      name: "Geist Mono",
      family: '"Geist Mono", ui-monospace, monospace',
    },
    notes:
      'Modern "Vercel aesthetic", infrastructure-grade feel. Geist fonts require separate installation.',
    topPick: false,
  },
  {
    id: 3,
    display: { name: "Manrope", family: '"Manrope", system-ui, sans-serif' },
    body: { name: "Inter", family: '"Inter", system-ui, sans-serif' },
    code: { name: "JetBrains Mono", family: '"JetBrains Mono", monospace' },
    notes: "Safe + one twist. Inter already cached on most devices",
    topPick: false,
  },
  {
    id: 4,
    display: { name: "Outfit", family: '"Outfit", system-ui, sans-serif' },
    body: {
      name: "IBM Plex Sans",
      family: '"IBM Plex Sans", system-ui, sans-serif',
    },
    code: { name: "IBM Plex Mono", family: '"IBM Plex Mono", monospace' },
    notes: "Strong hierarchy, purpose-built for technical docs",
    topPick: false,
  },
  {
    id: 5,
    display: {
      name: "Satoshi",
      family: '"Satoshi", system-ui, -apple-system, sans-serif',
    },
    body: { name: "DM Sans", family: '"DM Sans", system-ui, sans-serif' },
    code: { name: "JetBrains Mono", family: '"JetBrains Mono", monospace' },
    notes:
      "Editorial credibility, premium but approachable. Satoshi requires Fontshare CDN.",
    topPick: false,
  },
  {
    id: 6,
    display: {
      name: "Plus Jakarta Sans",
      family: '"Plus Jakarta Sans", system-ui, sans-serif',
    },
    body: {
      name: "Source Sans 3",
      family: '"Source Sans 3", system-ui, sans-serif',
    },
    code: { name: "Source Code Pro", family: '"Source Code Pro", monospace' },
    notes: "Clean geometric display with neutral professional body",
    topPick: false,
  },
  {
    id: 7,
    display: {
      name: "Bricolage Grotesque",
      family: '"Bricolage Grotesque", system-ui, sans-serif',
    },
    body: {
      name: "Geist Sans",
      family: '"Geist", system-ui, -apple-system, sans-serif',
    },
    code: { name: "Fira Code", family: '"Fira Code", monospace' },
    notes: "Eclectic display with modern body and ligature-rich code font",
    topPick: false,
  },
  {
    id: 8,
    display: {
      name: "General Sans",
      family: '"General Sans", system-ui, sans-serif',
    },
    body: { name: "Inter", family: '"Inter", system-ui, sans-serif' },
    code: {
      name: "Berkeley Mono",
      family: '"Berkeley Mono", ui-monospace, monospace',
    },
    notes: "Premium geometric display with trusted body and luxury code font",
    topPick: false,
  },
];

const SEMANTIC_COLORS = [
  {
    name: "Success",
    hex: "#059669",
    label: "Emerald-600",
    usage: "Positive outcomes, confirmations",
  },
  {
    name: "Warning",
    hex: "#D97706",
    label: "Amber-600",
    usage: "Caution states, non-blocking alerts",
  },
  {
    name: "Error",
    hex: "#DC2626",
    label: "Red-600",
    usage: "Failures, blocking issues",
  },
  {
    name: "Info",
    hex: "#0284C7",
    label: "Sky-600",
    usage: "Informational, neutral highlights",
  },
];

const NEUTRAL_LABELS: Record<string, string> = {
  "50": "Light background",
  "100": "Alt background",
  "200": "Border, divider",
  "300": "Disabled border",
  "400": "Placeholder text",
  "500": "Secondary text",
  "600": "Body text (light mode)",
  "700": "Strong text (light mode)",
  "800": "Surface (dark mode)",
  "900": "Background (dark mode)",
  "950": "Deep background",
};

const CODE_SAMPLE = `const system = createSystem({
  module: trafficLight,
  plugins: [loggingPlugin()],
});

// Constraints resolve automatically
system.facts.phase = "red";
await system.settle();`;

const BODY_SAMPLE =
  "Directive is a constraint-driven runtime for TypeScript. Declare requirements, let resolvers fulfill them, and inspect everything through a unified reactive system with built-in time-travel debugging.";

// ================================================================
// SHARED COMPONENTS
// ================================================================

type PreviewMode = "light" | "dark" | "both";

function ModeToggle({
  mode,
  onChange,
}: {
  mode: PreviewMode;
  onChange: (m: PreviewMode) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
      {(["light", "dark", "both"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={clsx(
            "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
            mode === m
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400",
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function PreviewPanel({
  mode,
  children,
}: {
  mode: PreviewMode;
  children: (dark: boolean) => React.ReactNode;
}) {
  if (mode === "both") {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl bg-[#F8FAFC] p-6 ring-1 ring-slate-200">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Light
          </p>
          {children(false)}
        </div>
        <div className="overflow-hidden rounded-xl bg-[#0F172A] p-6 ring-1 ring-slate-700">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Dark
          </p>
          {children(true)}
        </div>
      </div>
    );
  }
  const isDark = mode === "dark";
  return (
    <div
      className={clsx(
        "overflow-hidden rounded-xl p-6 ring-1",
        isDark ? "bg-[#0F172A] ring-slate-700" : "bg-[#F8FAFC] ring-slate-200",
      )}
    >
      {children(isDark)}
    </div>
  );
}

function SectionHeader({
  title,
  description,
  mode,
  onModeChange,
}: {
  title: string;
  description: string;
  mode: PreviewMode;
  onModeChange: (m: PreviewMode) => void;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {description}
        </p>
      </div>
      <ModeToggle mode={mode} onChange={onModeChange} />
    </div>
  );
}

function isLightText(shade: string): boolean {
  return Number.parseInt(shade) >= 500;
}

function sourceBadgeClasses(source: string, dark: boolean): string {
  if (source === "Current")
    return dark ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-600";
  if (source === "AI pick")
    return dark
      ? "bg-violet-900/30 text-violet-300"
      : "bg-violet-50 text-violet-700";
  return dark ? "bg-sky-900/30 text-sky-300" : "bg-sky-50 text-sky-700";
}

// ================================================================
// SECTION 1: COLOR PALETTE
// ================================================================

function ColorScaleRow({
  name,
  scaleKey,
  hex,
  source,
  notes,
  dark,
}: {
  name: string;
  scaleKey: string;
  hex: string;
  source: string;
  notes: string;
  dark: boolean;
}) {
  const scale = SCALES[scaleKey];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3
          className={clsx(
            "text-lg font-semibold",
            dark ? "text-white" : "text-slate-900",
          )}
        >
          {name}
        </h3>
        <code
          className={clsx(
            "text-xs",
            dark ? "text-slate-400" : "text-slate-500",
          )}
        >
          {hex}
        </code>
        <span
          className={clsx(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            sourceBadgeClasses(source, dark),
          )}
        >
          {source}
        </span>
      </div>
      <p
        className={clsx("text-xs", dark ? "text-slate-400" : "text-slate-500")}
      >
        {notes}
      </p>
      <div className="flex gap-0.5 sm:gap-1">
        {SHADES.map((shade) => (
          <div
            key={shade}
            className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-md p-1 sm:gap-1 sm:p-1.5"
            style={{ backgroundColor: scale[shade] }}
          >
            <span
              className={clsx(
                "text-[9px] font-medium sm:text-[10px]",
                isLightText(shade) ? "text-white/80" : "text-black/60",
              )}
            >
              {shade}
            </span>
            <span
              className={clsx(
                "hidden font-mono text-[7px] sm:inline sm:text-[8px]",
                isLightText(shade) ? "text-white/50" : "text-black/35",
              )}
            >
              {scale[shade]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ColorPaletteSection() {
  const [mode, setMode] = useState<PreviewMode>("both");
  return (
    <section>
      <SectionHeader
        title="1. Brand Color Options"
        description="13 primary color candidates with full 50-950 scales"
        mode={mode}
        onModeChange={setMode}
      />
      <PreviewPanel mode={mode}>
        {(dark) => (
          <div className="space-y-8">
            {COLOR_CANDIDATES.map((color) => (
              <ColorScaleRow
                key={color.key}
                name={color.name}
                scaleKey={color.key}
                hex={color.hex}
                source={color.source}
                notes={color.notes}
                dark={dark}
              />
            ))}
          </div>
        )}
      </PreviewPanel>
    </section>
  );
}

// ================================================================
// SECTION 2: COMBO PAIRINGS
// ================================================================

function LogoMockup({
  primaryHex,
  accentHex,
  dark,
}: {
  primaryHex: string;
  accentHex: string;
  dark: boolean;
}) {
  return (
    <svg viewBox="0 0 150 36" fill="none" className="h-9 w-auto">
      <g strokeLinejoin="round" strokeLinecap="round">
        <path d="M6 8 L16 18 L6 28" stroke={primaryHex} strokeWidth={3} />
        <path d="M24 8 L24 28" stroke={accentHex} strokeWidth={3} />
      </g>
      <text
        x="38"
        y="25"
        fill={dark ? "#f8fafc" : "#0f172a"}
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

function HeroMockup({
  gradient,
}: {
  gradient: { from: string; via: string; to: string };
}) {
  return (
    <p
      className="text-2xl font-bold tracking-tight sm:text-3xl"
      style={{
        backgroundImage: `linear-gradient(to right, ${gradient.from}, ${gradient.via}, ${gradient.to})`,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
        fontFamily: "var(--font-lexend), system-ui, sans-serif",
      }}
    >
      State that resolves itself.
    </p>
  );
}

function UIElements({
  primaryHex,
  accentHex,
  primaryKey,
  dark,
}: {
  primaryHex: string;
  accentHex: string;
  primaryKey: string;
  dark: boolean;
}) {
  const scale = SCALES[primaryKey];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-full px-4 py-2 text-sm font-semibold text-white"
          style={{ backgroundColor: primaryHex }}
        >
          Get Started
        </button>
        <button
          className="rounded-full border-2 px-4 py-2 text-sm font-semibold"
          style={{ borderColor: accentHex, color: accentHex }}
        >
          View on GitHub
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          style={{ color: primaryHex }}
          className="text-sm font-medium underline underline-offset-2"
        >
          Documentation link
        </a>
        <code
          className="rounded px-2 py-1 font-mono text-xs"
          style={{
            backgroundColor: dark
              ? scale?.["900"] || "#1e1b4b"
              : scale?.["50"] || "#f5f3ff",
            color: dark
              ? scale?.["300"] || "#c4b5fd"
              : scale?.["700"] || "#6d28d9",
          }}
        >
          createModule()
        </code>
      </div>
      <div
        className="rounded-lg border-l-4 p-4"
        style={{
          borderLeftColor: primaryHex,
          backgroundColor: dark ? `${primaryHex}10` : `${primaryHex}08`,
        }}
      >
        <p className="text-sm" style={{ color: dark ? "#cbd5e1" : "#334155" }}>
          Constraints are evaluated reactively. When facts change, relevant
          constraints re-evaluate automatically.
        </p>
      </div>
    </div>
  );
}

function ComboCard({
  combo,
  dark,
}: {
  combo: (typeof COMBOS)[0];
  dark: boolean;
}) {
  return (
    <div
      className={clsx(
        "space-y-5 rounded-xl p-6 ring-1",
        dark ? "bg-slate-800/50 ring-slate-700" : "bg-white ring-slate-200",
      )}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h3
            className={clsx(
              "text-lg font-bold",
              dark ? "text-white" : "text-slate-900",
            )}
          >
            Option {combo.id}
          </h3>
          <span
            className="inline-flex items-center gap-1.5 text-sm"
            style={{ color: combo.primary.hex }}
          >
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: combo.primary.hex }}
            />
            {combo.primary.name}
          </span>
          <span
            className={clsx(
              "text-xs",
              dark ? "text-slate-500" : "text-slate-400",
            )}
          >
            +
          </span>
          <span
            className="inline-flex items-center gap-1.5 text-sm"
            style={{ color: combo.accent.hex }}
          >
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: combo.accent.hex }}
            />
            {combo.accent.name}
          </span>
        </div>
        <p
          className={clsx(
            "text-xs italic",
            dark ? "text-slate-400" : "text-slate-500",
          )}
        >
          AE Verdict: {combo.verdict}
        </p>
      </div>

      <div className="space-y-4">
        <LogoMockup
          primaryHex={combo.primary.hex}
          accentHex={combo.accent.hex}
          dark={dark}
        />
        <HeroMockup gradient={combo.gradient} />
        <UIElements
          primaryHex={combo.primary.hex}
          accentHex={combo.accent.hex}
          primaryKey={combo.primary.key}
          dark={dark}
        />
      </div>
    </div>
  );
}

function ComboPairingsSection() {
  const [mode, setMode] = useState<PreviewMode>("both");
  return (
    <section>
      <SectionHeader
        title="2. Color Combo Pairings"
        description="16 primary + accent combos with logo, hero, and UI mockups"
        mode={mode}
        onModeChange={setMode}
      />
      <PreviewPanel mode={mode}>
        {(dark) => (
          <div className="space-y-6">
            {COMBOS.map((combo) => (
              <ComboCard key={combo.id} combo={combo} dark={dark} />
            ))}
          </div>
        )}
      </PreviewPanel>
    </section>
  );
}

// ================================================================
// SECTION 3: TYPOGRAPHY
// ================================================================

function TypographyPreview({
  pairing,
  dark,
}: {
  pairing: (typeof FONT_PAIRINGS)[0];
  dark: boolean;
}) {
  const textColor = dark ? "#f8fafc" : "#0f172a";
  const mutedColor = dark ? "#94a3b8" : "#64748b";

  return (
    <div
      className={clsx(
        "space-y-6 rounded-xl p-6 ring-1",
        dark ? "bg-slate-800/50 ring-slate-700" : "bg-white ring-slate-200",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            className={clsx(
              "text-lg font-bold",
              dark ? "text-white" : "text-slate-900",
            )}
          >
            Option {pairing.id}
          </h3>
          <p
            className={clsx(
              "mt-0.5 text-sm",
              dark ? "text-slate-400" : "text-slate-500",
            )}
          >
            {pairing.display.name} &middot; {pairing.body.name} &middot;{" "}
            {pairing.code.name}
          </p>
        </div>
        {pairing.topPick && (
          <span
            className={clsx(
              "rounded-full px-3 py-1 text-[10px] font-semibold",
              dark
                ? "bg-emerald-900/30 text-emerald-300"
                : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
            )}
          >
            Top Pick (3/4 AEs)
          </span>
        )}
      </div>
      <p
        className={clsx("text-xs", dark ? "text-slate-400" : "text-slate-500")}
      >
        {pairing.notes}
      </p>

      {/* Heading scale */}
      <div className="space-y-2">
        <p
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: mutedColor }}
        >
          Headings -- {pairing.display.name}
        </p>
        {[
          { size: "48px", label: "H1", weight: 700 },
          { size: "36px", label: "H2", weight: 700 },
          { size: "24px", label: "H3", weight: 600 },
          { size: "18px", label: "H4", weight: 600 },
        ].map(({ size, label, weight }) => (
          <p
            key={label}
            style={{
              fontFamily: pairing.display.family,
              fontSize: size,
              fontWeight: weight,
              color: textColor,
              lineHeight: 1.2,
            }}
          >
            {label} -- State that resolves itself
          </p>
        ))}
      </div>

      {/* Body text */}
      <div className="space-y-3">
        <p
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: mutedColor }}
        >
          Body -- {pairing.body.name}
        </p>
        {["16px", "14px", "12px"].map((size) => (
          <div key={size} className="space-y-1">
            <p className="text-[10px] font-mono" style={{ color: mutedColor }}>
              {size}
            </p>
            <p
              style={{
                fontFamily: pairing.body.family,
                fontSize: size,
                color: textColor,
                lineHeight: 1.6,
              }}
            >
              {BODY_SAMPLE}
            </p>
          </div>
        ))}
      </div>

      {/* Code block */}
      <div className="space-y-2">
        <p
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: mutedColor }}
        >
          Code -- {pairing.code.name}
        </p>
        <pre
          className="overflow-x-auto rounded-lg p-4 text-sm"
          style={{
            fontFamily: pairing.code.family,
            backgroundColor: dark ? "#0f172a" : "#f1f5f9",
            color: dark ? "#e2e8f0" : "#334155",
            lineHeight: 1.6,
          }}
        >
          {CODE_SAMPLE}
        </pre>
      </div>
    </div>
  );
}

function TypographySection() {
  const [mode, setMode] = useState<PreviewMode>("both");
  return (
    <section>
      <SectionHeader
        title="3. Typography Options"
        description="8 font pairings  -- Display + Body + Code"
        mode={mode}
        onModeChange={setMode}
      />
      <PreviewPanel mode={mode}>
        {(dark) => (
          <div className="space-y-6">
            {FONT_PAIRINGS.map((pairing) => (
              <TypographyPreview
                key={pairing.id}
                pairing={pairing}
                dark={dark}
              />
            ))}
          </div>
        )}
      </PreviewPanel>
    </section>
  );
}

// ================================================================
// SECTION 4: SEMANTIC COLORS
// ================================================================

function SemanticColorsSection() {
  return (
    <section>
      <h2 className="mb-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
        4. Semantic Colors
      </h2>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        Shared across all options -- consistent meaning regardless of brand
        choice
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SEMANTIC_COLORS.map((color) => (
          <div
            key={color.name}
            className="overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-slate-700"
          >
            <div className="h-20" style={{ backgroundColor: color.hex }} />
            <div className="p-4">
              <h3 className="font-semibold text-slate-900 dark:text-white">
                {color.name}
              </h3>
              <p className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                {color.label} &middot; {color.hex}
              </p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {color.usage}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ================================================================
// SECTION 5: NEUTRAL SCALE
// ================================================================

function NeutralScaleSection() {
  const [mode, setMode] = useState<PreviewMode>("both");
  const scale = SCALES.slate;
  return (
    <section>
      <SectionHeader
        title="5. Neutral Scale"
        description="Full Slate scale with usage labels"
        mode={mode}
        onModeChange={setMode}
      />
      <PreviewPanel mode={mode}>
        {(dark) => (
          <div className="space-y-1">
            {SHADES.map((shade) => (
              <div
                key={shade}
                className="flex items-center gap-4 rounded-lg p-3"
                style={{ backgroundColor: scale[shade] }}
              >
                <span
                  className={clsx(
                    "w-10 text-sm font-bold",
                    isLightText(shade) ? "text-white/80" : "text-black/60",
                  )}
                >
                  {shade}
                </span>
                <span
                  className={clsx(
                    "font-mono text-xs",
                    isLightText(shade) ? "text-white/60" : "text-black/40",
                  )}
                >
                  {scale[shade]}
                </span>
                <span
                  className={clsx(
                    "text-xs",
                    isLightText(shade) ? "text-white/70" : "text-black/50",
                  )}
                >
                  {NEUTRAL_LABELS[shade]}
                </span>
              </div>
            ))}
          </div>
        )}
      </PreviewPanel>
    </section>
  );
}

// ================================================================
// SECTION 6: AE TEAM REVIEW & VOTING
// ================================================================

interface AgentVote {
  name: string;
  role: string;
  team: string;
  comboPick: string;
  comboReason: string;
  comboSecondary: string;
  comboSecondaryReason: string;
  typoPick: number;
  typoReason: string;
  typoSecondary: number;
  typoSecondaryReason: string;
  proposal: { type: string; description: string; rationale: string } | null;
}

const AE_VOTES: AgentVote[] = [
  // Product & Growth Team
  {
    name: "Casey Marketing",
    role: "CMO",
    team: "Product & Growth",
    comboPick: "D",
    comboReason:
      'Purple + Amber is the most scroll-stopping combination in the dev-tools space — it breaks from the sea of blue/teal branding and signals bold authority, aligning with "Declare requirements" as a command-oriented product.',
    comboSecondary: "F",
    comboSecondaryReason:
      "Indigo + Amber carries similar boldness with a slightly more technical read; it differentiates well on Product Hunt and in conference decks where competitors blend into cool-spectrum monotony.",
    typoPick: 1,
    typoReason:
      "Space Grotesk as display font is immediately distinctive in developer marketing — it reads as technical without being sterile, and paired with IBM Plex it signals serious infrastructure-grade tooling.",
    typoSecondary: 5,
    typoSecondaryReason:
      "Satoshi + DM Sans has a premium editorial quality that could elevate Directive above typical open-source branding.",
    proposal: null,
  },
  {
    name: "Avery Social",
    role: "Community & Social Media",
    team: "Product & Growth",
    comboPick: "I",
    comboReason:
      "Teal + Amber is the highest-contrast complementary pair — it pops on dark-mode Twitter feeds, renders beautifully as a GitHub badge, and would make genuinely sticker-worthy swag.",
    comboSecondary: "K",
    comboSecondaryReason:
      "Emerald + Purple is unusual enough to stop scrolling and has strong meme potential; the green-primary approach is rare meaning instant visual recognition in Discord avatars or social cards.",
    typoPick: 2,
    typoReason:
      'The Geist family is beloved in the developer community thanks to Vercel — using it signals "we speak your language" and renders crisply at every size from og:image cards to tiny badges.',
    typoSecondary: 5,
    typoSecondaryReason:
      "Satoshi has strong personality at larger sizes, excellent for social media headers and announcement graphics where you need premium quality in a single glance.",
    proposal: {
      type: "social-kit",
      description:
        "Create a simplified logomark variant optimized for 32x32 and 16x16 rendering for GitHub org avatars, npm badges, and Discord server icons.",
      rationale:
        "The full wordmark becomes unreadable at small sizes used across most developer social touchpoints.",
    },
  },
  {
    name: "Sam Content",
    role: "Content Writer + SEO",
    team: "Product & Growth",
    comboPick: "C",
    comboReason:
      "Indigo + Emerald tells a clear narrative — indigo conveys the precision of declaring constraints while emerald represents successful resolution, giving a natural two-color storytelling framework for docs and tutorials.",
    comboSecondary: "J",
    comboSecondaryReason:
      "Indigo + Teal is a cool-spectrum pair with excellent contrast that stays readable in long-form documentation without creating visual fatigue during extended reading sessions.",
    typoPick: 4,
    typoReason:
      "Outfit creates strong heading hierarchy essential for scannable documentation — developers skim before they read, and paired with IBM Plex for body text you get ideal balance guiding readers through technical content.",
    typoSecondary: 1,
    typoSecondaryReason:
      'Space Grotesk + IBM Plex Sans is the strongest "technical authority" pairing — IBM Plex Mono for code blocks is battle-tested in documentation contexts.',
    proposal: null,
  },
  {
    name: "Taylor Product",
    role: "Product Manager",
    team: "Product & Growth",
    comboPick: "H",
    comboReason:
      "Blue + Purple hits the sweet spot between developer trust (blue is dominant in tools developers already rely on — VS Code, TypeScript, Docker) and intelligent depth (purple signals architecturally novel).",
    comboSecondary: "C",
    comboSecondaryReason:
      'Indigo + Emerald is a pragmatic alternative that still feels technical; the emerald accent maps to "success/resolved" states, creating coherence between brand and product experience.',
    typoPick: 3,
    typoReason:
      "Manrope + Inter + JetBrains Mono is the lowest-risk, highest-familiarity stack — developers already read Inter and JetBrains Mono daily, while Manrope adds just enough personality.",
    typoSecondary: 1,
    typoSecondaryReason:
      "Space Grotesk + IBM Plex is a strong differentiation play; it trades some familiarity for memorability which could be worth it if adoption depends on standing out.",
    proposal: {
      type: "testing",
      description:
        "Run a quick A/B preference test in a developer Discord or Twitter poll with the top 2-3 color combos shown on a mock npm README card.",
      rationale:
        "Actual developer reactions will validate or override our assumptions about what reads as trustworthy vs. novel.",
    },
  },
  {
    name: "Blake UX",
    role: "UX/UI Designer",
    team: "Product & Growth",
    comboPick: "J",
    comboReason:
      "Indigo + Teal delivers a 4.8:1+ contrast ratio on white backgrounds for both colors, passes WCAG AA for normal text, and the cool-spectrum pairing remains distinguishable under the most common color vision deficiencies.",
    comboSecondary: "I",
    comboSecondaryReason:
      "Teal + Amber is the highest-contrast complementary pair with excellent differentiation across all CVD types; the warm/cool split creates clear visual hierarchy without relying on hue alone.",
    typoPick: 1,
    typoReason:
      "Space Grotesk has distinct letterforms that improve readability in technical contexts, and IBM Plex Mono is one of few monospace fonts designed with x-height consistency for stable inline code alongside body text.",
    typoSecondary: 4,
    typoSecondaryReason:
      "Outfit has excellent weight distribution across its variable font range for precise visual hierarchy control in a design system.",
    proposal: {
      type: "accessibility",
      description:
        "Generate a full accessibility matrix: contrast ratios for every foreground/background combination at AA and AAA levels, plus simulated renders under protanopia, deuteranopia, and tritanopia.",
      rationale:
        "This becomes part of the brand guidelines to prevent downstream accessibility regressions in docs and marketing.",
    },
  },
  {
    name: "Quinn QA-Security",
    role: "QA + Security",
    team: "Product & Growth",
    comboPick: "I",
    comboReason:
      "Teal/Amber is the highest-contrast complementary pair, which directly translates to WCAG AAA compliance at more size thresholds and better readability in security audit reports.",
    comboSecondary: "F",
    comboSecondaryReason:
      "Indigo/Amber provides strong warm-cool contrast separation, making it easy to distinguish warning states from informational states without relying on iconography.",
    typoPick: 1,
    typoReason:
      "IBM Plex Mono has the best character disambiguation — zero vs capital O, one vs lowercase L vs pipe — critical for security code samples where a single misread character can mask a vulnerability.",
    typoSecondary: 4,
    typoSecondaryReason:
      "Outfit + IBM Plex Mono retains the code font advantage while Outfit's strong weight range creates clearer visual hierarchy in dense compliance documentation.",
    proposal: {
      type: "compliance",
      description:
        "Run a WCAG 2.2 contrast audit on the final palette at 14px body text and 12px code text sizes before shipping.",
      rationale:
        "Contrast ratios that pass at 16px often fail at sizes actually used in docs and terminal output.",
    },
  },
  {
    name: "Sage Intelligence",
    role: "AI/ML Engineer",
    team: "Product & Growth",
    comboPick: "C",
    comboReason:
      'Indigo maps semantically to formal constraint specification (the "declare" phase) while emerald maps to satisfiability and resolution (the "resolve" phase) — encoding the two-phase constraint-satisfaction paradigm into the brand.',
    comboSecondary: "A",
    comboSecondaryReason:
      "Purple/Emerald carries a similar declarative-to-resolved semantic arc; purple suggests the intelligence layer, emerald the successful resolution, mirroring SAT-solver visualizations.",
    typoPick: 5,
    typoReason:
      "Satoshi's geometric precision evokes formal systems and type theory aesthetics without feeling sterile, and JetBrains Mono is the de facto standard in ML engineering toolchains.",
    typoSecondary: 1,
    typoSecondaryReason:
      "Space Grotesk has a mathematical quality that resonates with constraint-programming documentation, and IBM Plex Mono's clarity is well-suited for type signatures and inference rules.",
    proposal: null,
  },
  {
    name: "River Streaming",
    role: "Streaming Engineer",
    team: "Product & Growth",
    comboPick: "J",
    comboReason:
      "Cool-spectrum palettes compress better in SVG and PNG, and indigo/teal animate smoothly across hue interpolation without muddy intermediate tones — important for streaming-state transition animations.",
    comboSecondary: "E",
    comboSecondaryReason:
      "Blue/Teal has minimal hue distance meaning fewer repaint artifacts during CSS transitions and excellent performance in GPU-composited layer animations.",
    typoPick: 2,
    typoReason:
      "Geist Sans and Geist Mono are system-optimized variable fonts with small file sizes and fast parsing — fewer layout shifts during streaming font loads.",
    typoSecondary: 3,
    typoSecondaryReason:
      "Inter is one of the most aggressively cached Google Fonts so it's often a zero-byte download for returning users, and JetBrains Mono is already cached on most developer machines.",
    proposal: {
      type: "performance",
      description:
        "Ship fonts as woff2 subsets with unicode-range splitting and use font-display: optional for code fonts to prevent layout jank.",
      rationale:
        "Streaming UI can never show layout shifts from late-loading monospace metrics.",
    },
  },
  {
    name: "Robin Execution",
    role: "Product Operations Lead",
    team: "Product & Growth",
    comboPick: "E",
    comboReason:
      "Blue/Teal is the fastest to ship because both colors have proven, well-documented accessible pairings across dark/light modes — less iteration on edge cases and fewer design debt tickets.",
    comboSecondary: "H",
    comboSecondaryReason:
      "Blue/Purple is similarly low-risk and familiar to developers from VS Code and Discord — we won't burn cycles explaining an unconventional palette.",
    typoPick: 3,
    typoReason:
      "Inter and JetBrains Mono are free, permissively licensed, already bundled in Next.js's font optimization, and are the most battle-tested fonts in OSS branding — zero integration surprises.",
    typoSecondary: 2,
    typoSecondaryReason:
      "Geist is MIT-licensed and ships natively with Next.js via next/font — literally zero setup cost and signals modern tooling alignment.",
    proposal: null,
  },
  {
    name: "Val Analytics",
    role: "Data Analytics + Revenue",
    team: "Product & Growth",
    comboPick: "D",
    comboReason:
      "Purple/Amber creates the strongest visual hierarchy for CTAs — amber buttons on a purple-branded page produce the highest figure-ground contrast, which conversion data consistently shows outperforms monochromatic schemes.",
    comboSecondary: "F",
    comboSecondaryReason:
      "Indigo/Amber retains the warm accent CTA advantage while indigo reads slightly more technical, which may test better with the senior-engineer segment.",
    typoPick: 4,
    typoReason:
      "Outfit creates the strongest size-contrast hierarchy between headlines and body text, improving scanability metrics — users who scan faster reach CTAs sooner, reducing bounce rate.",
    typoSecondary: 5,
    typoSecondaryReason:
      "Satoshi/DM Sans has an editorial premium feel that performs well in tests for perceived product quality, correlating with higher trial-to-adoption conversion.",
    proposal: {
      type: "testing",
      description:
        "Set up a simple split test on the landing page hero with the top two combos measuring scroll depth and CTA click-through before locking the palette.",
      rationale:
        "A 48-hour test with even moderate traffic gives directional signal and removes subjectivity.",
    },
  },
  // Executive Team
  {
    name: "Alex Strategic",
    role: "CEO",
    team: "Executive",
    comboPick: "C",
    comboReason:
      "Indigo/Emerald projects technical precision without feeling startup-trendy; it scales from docs site to enterprise sales deck to conference stage over a 5-year horizon without needing a rebrand.",
    comboSecondary: "H",
    comboSecondaryReason:
      "Blue/Purple reads as trusted-yet-intelligent, positioning well against incumbent state management libraries and signaling enterprise readiness.",
    typoPick: 1,
    typoReason:
      "Space Grotesk + IBM Plex gives us a distinctive technical identity that separates us from the Vercel/Next ecosystem while signaling serious infrastructure-grade tooling.",
    typoSecondary: 4,
    typoSecondaryReason:
      "Outfit creates strong visual hierarchy for documentation-heavy marketing, which is where developer tools win or lose adoption battles.",
    proposal: null,
  },
  {
    name: "Morgan Finance",
    role: "CFO",
    team: "Executive",
    comboPick: "J",
    comboReason:
      "Indigo/Teal is a cool-spectrum pair that reproduces well in both digital and print without spot-color budgets; high contrast ratio reduces the need for multiple color treatments across collateral.",
    comboSecondary: "E",
    comboSecondaryReason:
      "Blue/Teal is the lowest-risk palette — universally readable, no accessibility remediation costs, zero chance of clashing with co-marketing partner brands.",
    typoPick: 2,
    typoReason:
      "Geist Sans and Geist Mono are free, maintained by Vercel with zero licensing risk, and the single-ecosystem font stack minimizes long-term maintenance and hosting costs.",
    typoSecondary: 3,
    typoSecondaryReason:
      "Inter and JetBrains Mono are both open-source workhorses with massive community maintenance — near-zero risk of abandonment or licensing changes.",
    proposal: {
      type: "licensing",
      description:
        "Confirm all finalist fonts are SIL Open Font License or equivalent with no per-seat or commercial-use licensing exposure as adoption scales.",
      rationale:
        "Zero per-seat or redistribution restrictions eliminates future cost surprises.",
    },
  },
  {
    name: "Jordan Legal",
    role: "Chief Legal Officer",
    team: "Executive",
    comboPick: "F",
    comboReason:
      "Indigo/Amber is a distinctive pairing rarely used in developer tooling, strengthening trade dress arguments; high contrast ratio well above WCAG AA reduces ADA/Section 508 exposure.",
    comboSecondary: "I",
    comboSecondaryReason:
      "Teal/Amber as a complementary pair delivers highest contrast making WCAG AAA compliance achievable on most surfaces, reducing accessibility litigation risk.",
    typoPick: 1,
    typoReason:
      "Space Grotesk + IBM Plex are all SIL Open Font Licensed with clear commercial-use grants; IBM Plex has corporate-grade licensing documentation eliminating ambiguity.",
    typoSecondary: 5,
    typoSecondaryReason:
      "Satoshi (OFL) and DM Sans (OFL) have clean licensing, and the editorial pairing creates distinctive enough visual identity to support trade dress registration.",
    proposal: {
      type: "compliance",
      description:
        "Run a WCAG 2.2 AA audit against the winning combo — specifically test primary color on both white and dark backgrounds at body-text size to confirm 4.5:1 contrast ratios hold.",
      rationale:
        "Documented compliance reduces legal exposure and signals engineering quality to enterprise buyers.",
    },
  },
  {
    name: "Nova Ventures",
    role: "Chief Innovation Officer",
    team: "Executive",
    comboPick: "K",
    comboReason:
      'Emerald-primary with purple accent is genuinely category-creating — no major TypeScript library leads with green, and it viscerally signals "resolution achieved" mapping directly to the product promise.',
    comboSecondary: "D",
    comboSecondaryReason:
      "Purple/Amber is bold and commanding; it tells a venture-stage story of authority and ambition that stands out in pitch decks against the sea of blue developer tools.",
    typoPick: 5,
    typoReason:
      "Satoshi is the most ownable display font on this list — it reads as premium editorial design, not another developer tool, which is exactly the positioning for creating a new category.",
    typoSecondary: 1,
    typoSecondaryReason:
      "Space Grotesk has enough geometric personality to feel differentiated from the Inter/Geist monoculture while still reading as technical.",
    proposal: {
      type: "brand-element",
      description:
        'Pair the winning combo with a simple geometric logomark based on the "constraint resolution" concept — a shape that transforms or completes.',
      rationale:
        "Builds ownable visual IP beyond just color and type, creating a memorable symbol for the category.",
    },
  },
  {
    name: "Morgan HR",
    role: "CHRO",
    team: "Executive",
    comboPick: "B",
    comboReason:
      "Teal-primary with purple accent feels approachable and modern — it reads as welcoming to new contributors while the purple depth signals the project is serious and worth investing time in.",
    comboSecondary: "G",
    comboSecondaryReason:
      "Purple/Teal has good energy for community swag and contributor badges — the two colors reproduce well on t-shirts, stickers, and dark-mode GitHub profile elements.",
    typoPick: 3,
    typoReason:
      "Inter is the most universally readable body font for international contributors, Manrope adds warmth for headings, and JetBrains Mono is already familiar to most developers.",
    typoSecondary: 2,
    typoSecondaryReason:
      "Geist Sans has excellent readability across screen sizes and the modern aesthetic appeals to the younger developer demographic we want contributing.",
    proposal: {
      type: "community",
      description:
        'Define a "community" color variant — slightly warmer or lighter — for contributor-facing materials like onboarding docs, Discord branding, and welcome emails.',
      rationale:
        "The brand should feel human alongside the technical precision in contributor-facing contexts.",
    },
  },
  // Engineering Team
  {
    name: "Sam Technical",
    role: "CTO",
    team: "Engineering",
    comboPick: "H",
    comboReason:
      'Blue primary signals enterprise trust and production stability — the same reason AWS, Azure, and Terraform use blue. Purple accent adds intelligent depth without undermining "boring infrastructure" credibility.',
    comboSecondary: "E",
    comboSecondaryReason:
      "Blue-teal is the safest enterprise-grade palette; it reads as mature tooling rather than a startup experiment, which matters when engineering leads evaluate dependencies.",
    typoPick: 1,
    typoReason:
      "Space Grotesk for display conveys technical authority without pretension, and IBM Plex Sans/Mono carries the weight of enterprise documentation — engineers associate Plex with serious infrastructure.",
    typoSecondary: 4,
    typoSecondaryReason:
      "Outfit provides strong visual hierarchy for technical docs and pairs well with IBM Plex for dense API reference pages that signal maturity.",
    proposal: null,
  },
  {
    name: "Riley Systems",
    role: "Architecture + Performance",
    team: "Engineering",
    comboPick: "J",
    comboReason:
      "Indigo-teal is a cool-spectrum pair with excellent WCAG contrast ratios against both light and dark backgrounds; narrow hue distance reduces visual fatigue during extended reading across differently calibrated monitors.",
    comboSecondary: "I",
    comboSecondaryReason:
      "Teal-amber guarantees legibility on low-quality displays and under f.lux/Night Shift color shifts — important for developers working late.",
    typoPick: 2,
    typoReason:
      "Geist Sans and Geist Mono are variable fonts with small file footprints (~30KB combined), optimized for screen rendering, with hinting tuned for both Retina and standard DPI displays.",
    typoSecondary: 1,
    typoSecondaryReason:
      "IBM Plex Mono has exceptional glyph differentiation (0/O, 1/l/I) reducing misreading in code samples, though the full Plex family has larger total download weight.",
    proposal: {
      type: "verification",
      description:
        "Run a Lighthouse audit on font loading strategy — subset to Latin, use font-display: swap, preload only display weight. Budget: zero CLS, total payload under 80KB.",
      rationale:
        "Font performance is a proxy for engineering credibility in a developer library.",
    },
  },
  {
    name: "Charlie Backend",
    role: "Backend Engineer",
    team: "Engineering",
    comboPick: "C",
    comboReason:
      'Indigo reads as precise and systematic — the tone API documentation needs — while emerald on "resolved" states creates an intuitive visual language for constraint satisfaction outcomes in code examples.',
    comboSecondary: "F",
    comboSecondaryReason:
      "Indigo-amber gives sharp visual separation for inline code highlights and warning/deprecation callouts in API docs, making scanning long reference pages faster.",
    typoPick: 1,
    typoReason:
      "IBM Plex Mono is the gold standard for code sample readability — its operator ligatures are optional, character disambiguation is excellent, and it renders consistently at 13-15px doc code block sizes.",
    typoSecondary: 5,
    typoSecondaryReason:
      "JetBrains Mono with Satoshi body creates a clear visual break between prose and code, and JetBrains Mono has the best ligature control for TypeScript-heavy documentation.",
    proposal: null,
  },
  {
    name: "Dana Frontend",
    role: "Frontend Engineer",
    team: "Engineering",
    comboPick: "A",
    comboReason:
      "Purple-emerald provides the widest design system flexibility — purple scales beautifully across 50-950 shades for component surfaces, and emerald gives a semantically meaningful accent for success/resolution states.",
    comboSecondary: "G",
    comboSecondaryReason:
      "Purple-teal maintains the purple primary for component theming while teal gives a more energetic, modern accent that works well for interactive states and hover effects in dark mode.",
    typoPick: 2,
    typoReason:
      "Geist is a variable font from the ground up — one file handles all weights, simplifying CSS @font-face declarations, reducing bundle size, and giving smooth font-weight transitions for interactive states.",
    typoSecondary: 3,
    typoSecondaryReason:
      "Inter is the most battle-tested body font for web component systems with proven cross-browser rendering, and Manrope provides display personality without implementation risk.",
    proposal: {
      type: "implementation",
      description:
        "Define CSS custom properties for the full color scale from day one (--directive-primary-50 through --directive-primary-950) supporting dark mode, high contrast, and component variants.",
      rationale:
        "Avoids ad-hoc hex values and prevents tech debt in the design system.",
    },
  },
  {
    name: "Harper Infrastructure",
    role: "DevOps Engineer",
    team: "Engineering",
    comboPick: "I",
    comboReason:
      "Teal-amber maps directly to operational semantics — teal for healthy/nominal status, amber for warnings and attention-needed states. Works natively on CLI dashboards and status pages without a separate ops color scheme.",
    comboSecondary: "J",
    comboSecondaryReason:
      "Indigo-teal renders cleanly in terminal emulators and web dashboards, maintaining distinction even in 256-color terminal fallback modes.",
    typoPick: 1,
    typoReason:
      "IBM Plex Mono is installed by default on many corporate Linux systems and renders identically across macOS, Windows, and Ubuntu — critical when dashboards are viewed across a heterogeneous fleet.",
    typoSecondary: 2,
    typoSecondaryReason:
      "Geist Mono renders cleanly at small sizes in terminal contexts and its monospace metrics are well-calibrated for log output and structured CLI tables.",
    proposal: {
      type: "verification",
      description:
        "Document named ANSI terminal equivalents for brand colors (e.g., teal maps to ANSI cyan, amber to ANSI yellow) so CLI tools use on-brand colors without custom 24-bit escape sequences.",
      rationale:
        "Makes brand consistency achievable even in constrained terminal color environments.",
    },
  },
];

const COMBO_IDS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
] as const;
const TYPO_IDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function tallyVotes<T extends string | number>(
  votes: AgentVote[],
  getter: (v: AgentVote) => T,
  allKeys: readonly T[],
) {
  const counts = new Map<T, { count: number; voters: string[] }>();
  for (const k of allKeys) counts.set(k, { count: 0, voters: [] });
  for (const v of votes) {
    const key = getter(v);
    const entry = counts.get(key)!;
    entry.count++;
    entry.voters.push(v.name.split(" ")[0]);
  }
  return [...counts.entries()]
    .map(([key, val]) => ({ key, ...val }))
    .sort((a, b) => b.count - a.count);
}

const COMBO_TALLIES = tallyVotes(AE_VOTES, (v) => v.comboPick, COMBO_IDS);
const COMBO_SECONDARY_TALLIES = tallyVotes(
  AE_VOTES,
  (v) => v.comboSecondary,
  COMBO_IDS,
);
const TYPO_TALLIES = tallyVotes(AE_VOTES, (v) => v.typoPick, TYPO_IDS);
const TYPO_SECONDARY_TALLIES = tallyVotes(
  AE_VOTES,
  (v) => v.typoSecondary,
  TYPO_IDS,
);
const AE_PROPOSALS = AE_VOTES.filter((v) => v.proposal !== null);

const DISPLAY_TEAMS = ["Executive", "Engineering", "Product & Growth"] as const;

function RankingTable({
  title,
  primaryTallies,
  secondaryTallies,
  renderLabel,
  renderDots,
}: {
  title: string;
  primaryTallies: { key: string | number; count: number; voters: string[] }[];
  secondaryTallies: { key: string | number; count: number; voters: string[] }[];
  renderLabel: (key: string | number) => React.ReactNode;
  renderDots?: (key: string | number) => React.ReactNode;
}) {
  const winner = primaryTallies[0];
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-slate-800/50 dark:ring-slate-700">
      <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {title}
      </h4>
      <div className="mb-2 flex gap-16 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        <span className="w-5" />
        {renderDots && <span className="w-8" />}
        <span className="w-8" />
        <span>1st</span>
        <span>2nd</span>
      </div>
      <div className="space-y-1.5">
        {primaryTallies.map((t, i) => {
          const isWinner = t.key === winner.key;
          const secondary = secondaryTallies.find((s) => s.key === t.key);
          return (
            <div
              key={String(t.key)}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2",
                isWinner
                  ? "bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:ring-emerald-800"
                  : "bg-slate-50 dark:bg-slate-800",
              )}
            >
              <span className="w-5 text-xs font-bold text-slate-400">
                #{i + 1}
              </span>
              {renderDots?.(t.key)}
              <span className="w-8 text-sm font-semibold text-slate-700 dark:text-slate-200">
                {renderLabel(t.key)}
              </span>
              <span className="w-10 text-xs font-semibold text-slate-600 dark:text-slate-300">
                {t.count}/20
              </span>
              <span className="w-10 text-xs text-slate-400 dark:text-slate-500">
                {secondary?.count || 0}/20
              </span>
              {isWinner && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  Winner
                </span>
              )}
              <span className="ml-auto hidden text-[10px] text-slate-400 sm:inline dark:text-slate-500">
                {t.voters.join(", ")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VoteSummary() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <RankingTable
        title="Color Combo Rankings"
        primaryTallies={COMBO_TALLIES}
        secondaryTallies={COMBO_SECONDARY_TALLIES}
        renderLabel={(key) => String(key)}
        renderDots={(key) => {
          const combo = COMBOS.find((c) => c.id === key);
          return (
            <div className="flex w-8 items-center gap-1">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: combo?.primary.hex }}
              />
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: combo?.accent.hex }}
              />
            </div>
          );
        }}
      />
      <RankingTable
        title="Typography Rankings"
        primaryTallies={TYPO_TALLIES}
        secondaryTallies={TYPO_SECONDARY_TALLIES}
        renderLabel={(key) => {
          const p = FONT_PAIRINGS.find((f) => f.id === key);
          return (
            <span>
              {key}{" "}
              <span className="hidden text-[10px] font-normal text-slate-400 lg:inline">
                {p?.display.name}
              </span>
            </span>
          );
        }}
      />
    </div>
  );
}

function ProposalsSection() {
  if (AE_PROPOSALS.length === 0) return null;
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Proposals & Recommendations
      </h4>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {AE_PROPOSALS.map((v) => {
          const p = v.proposal!;
          return (
            <div
              key={v.name}
              className="rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-800/50 dark:ring-slate-700"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                  {p.type}
                </span>
              </div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                {p.description}
              </p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {p.rationale}
              </p>
              <p className="mt-3 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                Proposed by {v.name} &mdash; {v.role}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentReviewCard({ vote }: { vote: AgentVote }) {
  const combo = COMBOS.find((c) => c.id === vote.comboPick);
  const combo2 = COMBOS.find((c) => c.id === vote.comboSecondary);
  return (
    <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-800/50 dark:ring-slate-700">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          {vote.name}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-400">
          {vote.role}
        </span>
      </div>
      <div className="space-y-2">
        <div>
          <div className="mb-0.5 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Color
            </span>
            <div className="flex items-center gap-1">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: combo?.primary.hex }}
              />
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: combo?.accent.hex }}
              />
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {vote.comboPick}
              </span>
            </div>
            <span className="text-[10px] text-slate-300 dark:text-slate-600">
              |
            </span>
            <span className="text-[10px] text-slate-400">2nd:</span>
            <div className="flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: combo2?.primary.hex }}
              />
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: combo2?.accent.hex }}
              />
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {vote.comboSecondary}
              </span>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {vote.comboReason}
          </p>
        </div>
        <div>
          <div className="mb-0.5 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Type
            </span>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Option {vote.typoPick}
            </span>
            <span className="text-[10px] text-slate-300 dark:text-slate-600">
              |
            </span>
            <span className="text-[10px] text-slate-400">2nd:</span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              Option {vote.typoSecondary}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {vote.typoReason}
          </p>
        </div>
      </div>
    </div>
  );
}

function IndividualReviews() {
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Individual Reviews
      </h4>
      {DISPLAY_TEAMS.map((team) => {
        const teamVotes = AE_VOTES.filter((v) => v.team === team);
        const isOpen = openTeam === team;
        return (
          <div
            key={team}
            className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700"
          >
            <button
              onClick={() => setOpenTeam(isOpen ? null : team)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {team}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                  {teamVotes.length} agents
                </span>
              </div>
              <CaretDown
                className={clsx(
                  "h-4 w-4 text-slate-400 transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </button>
            {isOpen && (
              <div className="grid grid-cols-1 gap-3 px-4 pb-4 md:grid-cols-2">
                {teamVotes.map((v) => (
                  <AgentReviewCard key={v.name} vote={v} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AEReviewSection() {
  return (
    <section>
      <h2 className="mb-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
        6. AE Team Brand Review
      </h2>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        All 20 AE agents voted on color combos (A-K) and typography (1-5).
        Rankings show primary and secondary (2nd choice) vote counts.
      </p>
      <div className="space-y-8">
        <VoteSummary />
        <ProposalsSection />
        <IndividualReviews />
      </div>
    </section>
  );
}

// ================================================================
// MAIN EXPORT
// ================================================================

export function BrandGuide() {
  useFontLoader();

  return (
    <div className="space-y-16">
      <ColorPaletteSection />
      <hr className="border-slate-200 dark:border-slate-700" />
      <ComboPairingsSection />
      <hr className="border-slate-200 dark:border-slate-700" />
      <TypographySection />
      <hr className="border-slate-200 dark:border-slate-700" />
      <SemanticColorsSection />
      <hr className="border-slate-200 dark:border-slate-700" />
      <NeutralScaleSection />
      <hr className="border-slate-200 dark:border-slate-700" />
      <AEReviewSection />
    </div>
  );
}
