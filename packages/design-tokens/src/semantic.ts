// OfflineSMS semantic design tokens.
//
// Role-based tokens layered on top of the raw palette in `./index.ts`.
// UI code should prefer these names ("color.text.primary") over raw colors
// ("ink"), so theming (dark mode, brand variants) becomes a single-file change
// in a later phase. Raw exports remain in place — this layer is additive.

import { colors } from './index';

export const lightSemantic = {
  color: {
    background: {
      app:     colors.bgCanvas,
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
      info:    colors.primary,
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
      info:    colors.primaryTint,
    },
  },
} as const;

// Default semantic export is the light variant. A theme provider added in a
// later phase will swap to `darkSemantic` based on user preference.
export const semantic = lightSemantic;

export type SemanticTokens = typeof lightSemantic;
