// Raw colour palette — split out so semantic.ts can import it without
// creating a circular dependency with index.ts (index re-exports semantic).
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

  darkBg:         '#0A0F1C',
  darkSurface:    '#131A2C',
  darkSurface2:   '#18203A',
  darkInk:        '#F2F4FA',
} as const;
