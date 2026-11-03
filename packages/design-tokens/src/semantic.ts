// OfflineSMS semantic design tokens.
//
// Role-based tokens layered on top of the raw palette in `./index.ts`.
// UI code should prefer these names ("color.text.primary") over raw colors
// ("ink"), so theming (dark mode, brand variants) becomes a single-file change
// in a later phase. Raw exports remain in place — this layer is additive.

import { colors } from './colors';

export const lightSemantic = {
  color: {
    background: {
      app:     colors.surface,
      surface: colors.surface,
      subtle:  colors.surface2,
      sunken:  colors.surfaceSunken,
      raised:  colors.surface,
      inverse: colors.ink,
    },
    text: {
      primary:   colors.ink,
      secondary: colors.ink700,
      muted:     colors.ink500,
      disabled:  colors.ink400,
      inverse:   colors.surface,
      onPrimary: colors.surface,
      link:      colors.primary,
    },
    border: {
      subtle:  colors.ink100,
      default: colors.ink200,
      strong:  colors.ink300,
      focus:   colors.primary,
    },
    action: {
      primary:        colors.primary,
      primaryHover:   colors.primaryHover,
      primaryPressed: colors.primaryDark,
      primaryFg:      colors.surface,
      subtle:         colors.primarySoft,
      subtleFg:       colors.primaryDark,
    },
    state: {
      success: colors.ok,
      warning: colors.warn,
      error:   colors.err,
      errorText: '#B91C1C',
      info:    colors.primary,
    },
    // Paired foreground/background values for pinned messages and notices.
    // A light fixed surface must never inherit the dark theme's white text.
    notice: {
      background: '#F3F7FA',
      border: '#C5D6E0',
      title: '#155E83',
      text: '#243746',
    },
  },
} as const;

export const darkSemantic = {
  color: {
    background: {
      app:     colors.darkBg,
      surface: colors.darkSurface,
      subtle:  colors.darkSurface2,
      sunken:  colors.darkBg,
      raised:  colors.darkSurface2,
      inverse: colors.surface,
    },
    text: {
      primary:   colors.darkInk,
      secondary: colors.ink200,
      muted:     colors.ink400,
      disabled:  colors.ink600,
      inverse:   colors.ink,
      onPrimary: colors.surface,
      link:      colors.primaryTint,
    },
    border: {
      subtle:  colors.ink800,
      default: colors.ink700,
      strong:  colors.ink600,
      focus:   colors.primaryTint,
    },
    action: {
      primary:        colors.primary,
      primaryHover:   colors.primaryHover,
      primaryPressed: colors.primaryDark,
      primaryFg:      colors.surface,
      subtle:         colors.ink800,
      subtleFg:       colors.primaryTint,
    },
    state: {
      success: colors.ok,
      warning: colors.warn,
      error:   colors.err,
      errorText: '#FCA5A5',
      info:    colors.primaryTint,
    },
    notice: {
      background: '#1B2C3B',
      border: '#466174',
      title: '#B9DFF1',
      text: '#EDF4F8',
    },
  },
} as const;

// Default semantic export is the light variant. A theme provider added in a
// later phase will swap to `darkSemantic` based on user preference.
export const semantic = lightSemantic;

export type SemanticTokens = typeof lightSemantic;
