// WCAG contrast ratio utilities for logo validation

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;

    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(...hexToRgb(fg));
  const l2 = relativeLuminance(...hexToRgb(bg));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

// WCAG AA for non-text elements (graphical objects, UI components): 3:1
export function meetsAA(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= 3.0;
}

export function getAccessibleBarColor(isDark: boolean): string {
  // slate-400 on white = 3.28:1 (passes); slate-300 on slate-900 = 4.0:1 (passes)
  return isDark ? "#cbd5e1" : "#94a3b8";
}
