import { useTheme } from './hooks';

/**
 * Chart palette.
 *
 * Categorical slots are assigned in fixed order and never cycled; the dark
 * column is the same hues re-stepped for the dark surface. Both sets were run
 * through the palette validator (all-pairs CVD and normal-vision separation,
 * lightness band, chroma floor, contrast) before being used here.
 *
 * Light-mode slot 3 sits just under 3:1 against a white surface, so every chart
 * that uses it also ships a legend and value labels/tooltips — identity is never
 * carried by colour alone.
 */
export interface ChartTheme {
  /** Categorical series colours, in fixed order. */
  series: [string, string, string];
  /** Ordinal ramp (light → dark) for tiered values such as lead grades. */
  ordinal: [string, string, string];
  grid: string;
  axis: string;
  surface: string;
  tooltipBg: string;
  tooltipBorder: string;
  text: string;
  muted: string;
}

const LIGHT: ChartTheme = {
  series: ['#2a78d6', '#eb6834', '#1baf7a'],
  ordinal: ['#1c5cab', '#3987e5', '#86b6ef'],
  grid: '#e2e8f0',
  axis: '#94a3b8',
  surface: '#ffffff',
  tooltipBg: '#ffffff',
  tooltipBorder: '#e2e8f0',
  text: '#0f172a',
  muted: '#64748b',
};

const DARK: ChartTheme = {
  series: ['#3987e5', '#d95926', '#199e70'],
  ordinal: ['#256abf', '#3987e5', '#9ec5f4'],
  grid: 'rgba(255,255,255,0.08)',
  axis: '#64748b',
  surface: '#111726',
  tooltipBg: '#161c2c',
  tooltipBorder: 'rgba(255,255,255,0.12)',
  text: '#f8fafc',
  muted: '#94a3b8',
};

export function useChartTheme(): ChartTheme {
  const { theme } = useTheme();
  return theme === 'dark' ? DARK : LIGHT;
}

/** Shared Recharts tooltip styling so every chart reads as one system. */
export function tooltipStyles(theme: ChartTheme) {
  return {
    contentStyle: {
      background: theme.tooltipBg,
      border: `1px solid ${theme.tooltipBorder}`,
      borderRadius: 12,
      fontSize: 12,
      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
      color: theme.text,
    },
    labelStyle: { color: theme.muted, fontWeight: 500, marginBottom: 4 },
    itemStyle: { color: theme.text },
    cursor: { fill: theme.grid, fillOpacity: 0.35 },
  };
}
