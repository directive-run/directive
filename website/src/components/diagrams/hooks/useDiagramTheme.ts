// Always-dark diagram theme — uses brand surface vars for preset tinting
export function useDiagramTheme() {
  return {
    isDark: true,
    bgColor: 'var(--brand-diagram-bg, #0a1120)',
    gridColor: '#1e293b',
  }
}
