// Tailwind preset — keeps the dashboard token-locked.
//
// Two layers:
//  - Raw palette (kept as-is for back-compat: `bg-canvas`, `text-ink-500`, etc.)
//  - Semantic role tokens (new: `bg-bg-app`, `text-text-primary`, `border-border-default`,
//    `bg-action-primary`, `text-state-error`, …)
//
// Mirrors `packages/design-tokens/src/semantic.ts`. If you add a key there,
// add it here.

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        // ── raw palette (unchanged) ─────────────────────────────────────
        primary: {
          DEFAULT: '#1F7BA8',
          dark:    '#155E83',
          hover:   '#186E97',
          tint:    '#C9E0EC',
          light:   '#E6F1F7',
          soft:    '#F4F9FC',
        },
        ink: {
          DEFAULT: '#0B1220',
          800: '#16223A', 700: '#2A3650', 600: '#475067', 500: '#6B7488',
          400: '#98A0B3', 300: '#C7CCD7', 200: '#E2E5EC', 100: '#EEF0F4',
        },
        canvas:   '#EEF1F6',
        surface:  '#FFFFFF',
        surface2: '#F7F8FB',
        surface3: '#EFF2F7',

        // ── semantic role tokens (new) ──────────────────────────────────
        bg: {
          app:     '#EEF1F6',
          surface: '#FFFFFF',
          subtle:  '#F7F8FB',
          sunken:  '#F1F3F8',
          raised:  '#FFFFFF',
          inverse: '#0B1220',
        },
        text: {
          primary:   '#0B1220',
          secondary: '#2A3650',
          muted:     '#6B7488',
          disabled:  '#98A0B3',
          inverse:   '#FFFFFF',
          link:      '#1F7BA8',
        },
        border: {
          subtle:  '#EEF0F4',
          DEFAULT: '#E2E5EC',
          strong:  '#C7CCD7',
          focus:   '#1F7BA8',
        },
        action: {
          primary:        '#1F7BA8',
          primaryHover:   '#186E97',
          primaryPressed: '#155E83',
          primaryFg:      '#FFFFFF',
          subtle:         '#F4F9FC',
          subtleFg:       '#155E83',
        },
        state: {
          success: '#22C55E',
          warning: '#F59E0B',
          error:   '#EF4444',
          info:    '#1F7BA8',
        },
      },
      fontFamily: {
        sans:   ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono:   ['"JetBrains Mono"', 'monospace'],
        arabic: ['"Noto Naskh Arabic"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '10px', md: '14px', lg: '18px', xl: '22px', '2xl': '28px',
      },
      boxShadow: {
        sh1: '0 1px 2px rgba(15,23,42,.04), 0 1px 1px rgba(15,23,42,.03)',
        sh2: '0 4px 14px rgba(15,23,42,.06), 0 2px 4px rgba(15,23,42,.04)',
        sh3: '0 12px 32px rgba(15,23,42,.08), 0 4px 12px rgba(15,23,42,.05)',
      },
    }
  }
};
