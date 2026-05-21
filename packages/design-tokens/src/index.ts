// OfflineSMS Design Tokens
// Single source of truth for color, type, spacing, radius, shadow.
// Consumed by both the mobile (RN) app and the Next.js dashboard.

export const colors = {
  primary:        '#1F7BA8',
  primaryDark:    '#155E83',
  primaryHover:   '#186E97',
  primaryTint:    '#C9E0EC',
  primaryLight:   '#E6F1F7',
  primarySoft:    '#F4F9FC',
  primaryGrad:    'linear-gradient(135deg, #1F7BA8 0%, #155E83 100%)',

  ink:            '#0B1220',
  ink800:         '#16223A',
  ink700:         '#2A3650',
  ink600:         '#475067',
  ink500:         '#6B7488',
  ink400:         '#98A0B3',
  ink300:         '#C7CCD7',
  ink200:         '#E2E5EC',
  ink100:         '#EEF0F4',

  bgCanvas:       '#EEF1F6',
  surface:        '#FFFFFF',
  surface2:       '#F7F8FB',
  surface3:       '#EFF2F7',
  surfaceSunken:  '#F1F3F8',

  ok:             '#22C55E',
  warn:           '#F59E0B',
  err:            '#EF4444',
  online:         '#22C55E',

  // Dark mode
  darkBg:         '#0A0F1C',
  darkSurface:    '#131A2C',
  darkSurface2:   '#18203A',
  darkInk:        '#F2F4FA',
} as const;

export const typography = {
  fontFamily: {
    sans: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
    arabic: "'Noto Naskh Arabic', system-ui, sans-serif",
  },
  fontSize: {
    xs: 11,
    sm: 12.5,
    base: 14,
    md: 15,
    lg: 17,
    xl: 22,
    '2xl': 26,
    '3xl': 32,
    '4xl': 44,
  },
  fontWeight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },
} as const;

export const spacing = {
  '0.5': 2, '1': 4, '1.5': 6, '2': 8, '2.5': 10, '3': 12,
  '4': 16, '5': 20, '6': 24, '7': 28, '8': 32, '10': 40,
  '12': 48, '16': 64, '20': 80, '24': 96,
} as const;

export const radius = {
  none: 0, xs: 6, sm: 10, md: 14, lg: 18, xl: 22, '2xl': 28, pill: 999,
} as const;

export const shadows = {
  sh1: '0 1px 2px rgba(15,23,42,.04), 0 1px 1px rgba(15,23,42,.03)',
  sh2: '0 4px 14px rgba(15,23,42,.06), 0 2px 4px rgba(15,23,42,.04)',
  sh3: '0 12px 32px rgba(15,23,42,.08), 0 4px 12px rgba(15,23,42,.05)',
  shApp: '0 24px 80px -20px rgba(15,23,42,.18), 0 8px 24px -8px rgba(15,23,42,.08)',
} as const;

// Semantic, role-based tokens layered on top of the raw palette above.
// Existing imports (`colors`, `typography`, `radius`, `spacing`, `shadows`)
// remain untouched — semantic is additive.
export { semantic, lightSemantic, darkSemantic } from './semantic';
export type { SemanticTokens } from './semantic';

import { semantic as _semantic } from './semantic';

export const tokens = { colors, typography, spacing, radius, shadows, semantic: _semantic };
export default tokens;
