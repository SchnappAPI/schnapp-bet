import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        raised: 'var(--raised)',
        surface: { DEFAULT: 'var(--surface)', hover: 'var(--surface-hover)' },
        inset: 'var(--inset)',
        border: {
          subtle: 'var(--border-subtle)',
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        fg: {
          DEFAULT: 'var(--fg)',
          muted: 'var(--fg-muted)',
          subtle: 'var(--fg-subtle)',
          disabled: 'var(--fg-disabled)',
        },
        brand: {
          DEFAULT: 'var(--brand)',
          hover: 'var(--brand-hover)',
          muted: 'var(--brand-muted)',
        },
        pos: { DEFAULT: 'var(--pos)', muted: 'var(--pos-muted)' },
        neg: { DEFAULT: 'var(--neg)', muted: 'var(--neg-muted)' },
        warn: { DEFAULT: 'var(--warn)', muted: 'var(--warn-muted)' },
        info: { DEFAULT: 'var(--info)', muted: 'var(--info-muted)' },
        sport: {
          nba: 'var(--sport-nba)',
          mlb: 'var(--sport-mlb)',
          nfl: 'var(--sport-nfl)',
          lol: 'var(--sport-lol)',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        display: ['28px', { lineHeight: '32px', letterSpacing: '-0.02em', fontWeight: '600' }],
        h1: ['18px', { lineHeight: '24px', fontWeight: '600' }],
        h2: ['14px', { lineHeight: '20px', fontWeight: '600' }],
        body: ['13px', { lineHeight: '18px' }],
        micro: ['10px', { lineHeight: '14px', letterSpacing: '0.08em', fontWeight: '500' }],
        data: ['12px', { lineHeight: '16px', fontWeight: '500' }],
        'data-lg': ['18px', { lineHeight: '22px', fontWeight: '500' }],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
      },
      boxShadow: {
        pop: '0 8px 24px -4px rgba(0,0,0,0.5), 0 2px 6px -1px rgba(0,0,0,0.4)',
      },
      transitionTimingFunction: {
        precise: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: {
        fast: '120ms',
        DEFAULT: '160ms',
      },
    },
  },
  plugins: [],
};

export default config;
