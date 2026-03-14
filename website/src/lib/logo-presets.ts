// Logo Preset System — Swappable Logo Identity
// Mirrors the brand-presets.ts pattern for colors/typography.

import { STORAGE_KEYS, safeGetItem, safeSetItem } from "./storage-keys";

export interface LogoPath {
  tag: "polygon" | "path" | "rect" | "circle" | "line";
  attrs: Record<string, string>;
  colorRole: "primary" | "accent" | "bar";
}

export interface LogoPreset {
  id: string;
  name: string;
  description: string;
  viewBox: string;
  paths: LogoPath[];
  lockupTextX: number;
}

// ── D Monogram Traced (default — the Illustrator-traced D) ────────────
const D_MONOGRAM_TRACED: LogoPreset = {
  id: "d-monogram-traced",
  name: "D Monogram (AI)",
  description: "Illustrator-traced D letterform",
  viewBox: "-17.25 0 446.1 446.1",
  lockupTextX: 480,
  paths: [
    {
      tag: "polygon",
      attrs: {
        points:
          "105.5 445.12 105.48 446 0 446.1 0 .13 105.29 .15 105.5 445.12",
      },
      colorRole: "bar",
    },
    {
      tag: "path",
      attrs: {
        d: "M105.48,446l.02-.88c.68-.39,1.78-1.14,2.7-2.07l110.1-110.61,15.59-15.76,90.58-91.02c1.37-1.51,2.2-2.81,2.74-4.24,2.86-1.6,5.24-3.72,7.91-6.4l64.26-64.55c5.93,22.62,11.7,45.66,12.17,69.86.56,28.8-4.32,56-14.29,82.95-19.91,53.8-59.13,98.45-111.34,122.77-28.36,13.21-53.68,20.05-85.67,20.02l-94.77-.07Z",
      },
      colorRole: "primary",
    },
    {
      tag: "path",
      attrs: {
        d: "M105.85.46l17.52-.46,77.95.27c51.09.17,98.81,21.03,136.61,54.53,8.01,7.1,15.23,14.59,21.99,22.86,12.65,15.47,32.54,46.44,37.36,64.8l2.1,8.02-64.26,64.55c-2.67,2.68-5.05,4.81-7.91,6.4-1-.77-1.92-1.56-3.31-2.95",
      },
      colorRole: "accent",
    },
  ],
};

// ── Current (chevron + bar) ───────────────────────────────────────────
const CURRENT: LogoPreset = {
  id: "current",
  name: "Current",
  description: "Chevron + constraint bar",
  viewBox: "0 0 36 36",
  lockupTextX: 44,
  paths: [
    {
      tag: "path",
      attrs: {
        d: "M6 8 L16 18 L6 28",
        fill: "none",
        strokeWidth: "3",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
      colorRole: "primary",
    },
    {
      tag: "path",
      attrs: {
        d: "M24 8 L24 28",
        fill: "none",
        strokeWidth: "3",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
      colorRole: "accent",
    },
  ],
};

// ── The Resolver ──────────────────────────────────────────────────────
const RESOLVER: LogoPreset = {
  id: "resolver",
  name: "The Resolver",
  description: "Three lines converging to a luminous point",
  viewBox: "0 0 36 36",
  lockupTextX: 44,
  paths: [
    {
      tag: "line",
      attrs: {
        x1: "4",
        y1: "7",
        x2: "27",
        y2: "18",
        strokeWidth: "2.5",
        strokeLinecap: "round",
      },
      colorRole: "accent",
    },
    {
      tag: "line",
      attrs: {
        x1: "4",
        y1: "18",
        x2: "27",
        y2: "18",
        strokeWidth: "2.5",
        strokeLinecap: "round",
      },
      colorRole: "bar",
    },
    {
      tag: "line",
      attrs: {
        x1: "4",
        y1: "29",
        x2: "27",
        y2: "18",
        strokeWidth: "2.5",
        strokeLinecap: "round",
      },
      colorRole: "primary",
    },
    {
      tag: "circle",
      attrs: { cx: "29", cy: "18", r: "3.5", opacity: "0.85" },
      colorRole: "primary",
    },
  ],
};

// ── The Sentinel ──────────────────────────────────────────────────────
const SENTINEL: LogoPreset = {
  id: "sentinel",
  name: "The Sentinel",
  description: "Geometric eye with diamond pupil",
  viewBox: "0 0 36 36",
  lockupTextX: 44,
  paths: [
    {
      tag: "path",
      attrs: {
        d: "M 4,18 C 4,6 32,6 32,18",
        fill: "none",
        strokeWidth: "2.5",
        strokeLinecap: "round",
      },
      colorRole: "accent",
    },
    {
      tag: "path",
      attrs: {
        d: "M 4,18 C 4,30 32,30 32,18",
        fill: "none",
        strokeWidth: "2.5",
        strokeLinecap: "round",
      },
      colorRole: "primary",
    },
    {
      tag: "path",
      attrs: { d: "M 18,13 L 23,18 L 18,23 L 13,18 Z" },
      colorRole: "bar",
    },
  ],
};

// ── Double Chevron ────────────────────────────────────────────────────
const DOUBLE_CHEVRON: LogoPreset = {
  id: "double-chevron",
  name: "Double Chevron",
  description: "Two stacked right-pointing arrows",
  viewBox: "0 0 36 36",
  lockupTextX: 44,
  paths: [
    {
      tag: "path",
      attrs: { d: "M4,7 L17,18 L4,29 Z" },
      colorRole: "accent",
    },
    {
      tag: "path",
      attrs: { d: "M16,7 L29,18 L16,29 Z" },
      colorRole: "primary",
    },
  ],
};

// ── D Monogram (simplified) ───────────────────────────────────────────
const D_MONOGRAM: LogoPreset = {
  id: "d-monogram",
  name: "D Monogram",
  description: "Letter D with bar + curved arrow",
  viewBox: "0 0 36 36",
  lockupTextX: 44,
  paths: [
    {
      tag: "rect",
      attrs: { x: "7", y: "5", width: "5", height: "26", rx: "1" },
      colorRole: "bar",
    },
    {
      tag: "path",
      attrs: { d: "M12,5 C23,5 29,10 29,18 L12,18 Z" },
      colorRole: "accent",
    },
    {
      tag: "path",
      attrs: { d: "M12,18 L29,18 C29,26 23,31 12,31 Z" },
      colorRole: "primary",
    },
  ],
};

// ── Compass ───────────────────────────────────────────────────────────
const COMPASS: LogoPreset = {
  id: "compass",
  name: "The Compass",
  description: "Directional diamond with constraint ring",
  viewBox: "0 0 36 36",
  lockupTextX: 44,
  paths: [
    {
      tag: "path",
      attrs: { d: "M 5,18 L 18,10 L 31,18 Z" },
      colorRole: "accent",
    },
    {
      tag: "path",
      attrs: { d: "M 5,18 L 18,26 L 31,18 Z" },
      colorRole: "primary",
    },
    {
      tag: "circle",
      attrs: {
        cx: "18",
        cy: "18",
        r: "4",
        fill: "none",
        strokeWidth: "1.5",
      },
      colorRole: "bar",
    },
    {
      tag: "circle",
      attrs: { cx: "18", cy: "18", r: "1.5" },
      colorRole: "bar",
    },
  ],
};

// ── Equilibrium Bold ──────────────────────────────────────────────────
const EQUILIBRIUM_BOLD: LogoPreset = {
  id: "equilibrium-bold",
  name: "Equilibrium Bold",
  description: "Filled diamond-chevrons with dot",
  viewBox: "0 0 36 36",
  lockupTextX: 44,
  paths: [
    {
      tag: "path",
      attrs: { d: "M4,18 L15,7 L15,29 Z" },
      colorRole: "accent",
    },
    {
      tag: "path",
      attrs: { d: "M32,18 L21,7 L21,29 Z" },
      colorRole: "primary",
    },
    {
      tag: "circle",
      attrs: { cx: "18", cy: "18", r: "3" },
      colorRole: "bar",
    },
  ],
};

// ── Diamond ───────────────────────────────────────────────────────────
const DIAMOND: LogoPreset = {
  id: "diamond",
  name: "Constraint Diamond",
  description: "Split rotated square",
  viewBox: "0 0 36 36",
  lockupTextX: 44,
  paths: [
    {
      tag: "path",
      attrs: { d: "M 18,4 L 32,17.25 L 4,17.25 Z" },
      colorRole: "accent",
    },
    {
      tag: "path",
      attrs: { d: "M 4,18.75 L 32,18.75 L 18,32 Z" },
      colorRole: "primary",
    },
  ],
};

// ── All presets ───────────────────────────────────────────────────────
export const DEFAULT_LOGO_PRESET = D_MONOGRAM_TRACED;

export const LOGO_PRESETS: LogoPreset[] = [
  D_MONOGRAM_TRACED,
  CURRENT,
  RESOLVER,
  SENTINEL,
  DOUBLE_CHEVRON,
  D_MONOGRAM,
  COMPASS,
  EQUILIBRIUM_BOLD,
  DIAMOND,
];

export function findLogoPreset(id: string): LogoPreset | undefined {
  return LOGO_PRESETS.find((p) => p.id === id);
}

export function getStoredLogoPresetId(): string {
  return safeGetItem(STORAGE_KEYS.LOGO) ?? DEFAULT_LOGO_PRESET.id;
}

export function storeLogoPresetId(id: string): void {
  safeSetItem(STORAGE_KEYS.LOGO, id);
}

// Map a colorRole to a hex value for static contexts (favicon, OG image)
export function resolveColor(
  colorRole: "primary" | "accent" | "bar",
  mode: "light" | "dark",
): string {
  if (colorRole === "bar") {
    return mode === "dark" ? "#cbd5e1" : "#94a3b8";
  }
  if (colorRole === "primary") {
    return "#0ea5e9"; // sky-500
  }

  return "#6366f1"; // indigo-500
}
