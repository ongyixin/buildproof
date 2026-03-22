import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './types/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono:            ['JetBrains Mono', 'Fira Mono', 'monospace'],
        sans:            ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        serif:           ['Playfair Display', 'Georgia', 'serif'],
        editorial:       ['Source Sans 3', 'system-ui', 'sans-serif'],
        instrument:      ['Barlow', 'system-ui', 'sans-serif'],
        'instrument-mono': ['Share Tech Mono', 'JetBrains Mono', 'monospace'],
        geo:             ['DM Sans', 'system-ui', 'sans-serif'],
        typewriter:      ['Courier Prime', 'Courier', 'monospace'],
        'legal-body':    ['Literata', 'Georgia', 'serif'],
      },
      colors: {
        // ── Core surfaces ──────────────────────────────────────────
        bp: {
          bg:           '#0D0F14',
          surface:      '#13161E',
          'surface-2':  '#1A1E28',
          border:       '#252A36',
          'border-hover': '#3A4054',

          // Accents
          gold:         '#F5A623',
          'gold-dim':   '#B87A18',
          'gold-glow':  'rgba(245, 166, 35, 0.12)',

          teal:         '#00C9A7',
          'teal-dim':   '#008F76',
          'teal-glow':  'rgba(0, 201, 167, 0.12)',
          purple:       '#8B7FE8',
          red:          '#E05252',
          'red-dim':    'rgba(224, 82, 82, 0.15)',
          'red-warm':   '#C75B39',
          'red-warm-dim': 'rgba(199, 91, 57, 0.15)',

          // Text
          primary:      '#E8E6DF',
          muted:        '#6B7280',
          dim:          '#3D4352',
        },
        // Legacy aliases (used during migration, cleaned up in Phase 4)
        ink: {
          DEFAULT: '#0D0F14',
          '50':    '#13161E',
          '100':   '#1A1E28',
          '200':   '#252A36',
          '300':   '#3A4054',
        },
        wire: {
          DEFAULT: '#252A36',
          bright:  '#3A4054',
        },
        ivory: {
          DEFAULT: '#E8E6DF',
          dim:     '#9AAAC0',
          muted:   '#6B7280',
        },
        amber: {
          DEFAULT: '#F5A623',
          bright:  '#F7B84B',
          dim:     '#B87A18',
          ghost:   'rgba(245,166,35,0.12)',
        },
        teal: {
          DEFAULT: '#00C9A7',
          dim:     '#006651',
          ghost:   'rgba(0,201,167,0.08)',
        },
        scarlet: {
          DEFAULT: '#E05252',
          dim:     '#5A1010',
          ghost:   'rgba(224,82,82,0.08)',
        },
        jade: {
          DEFAULT: '#22C55E',
          dim:     '#0A4020',
          ghost:   'rgba(34,197,94,0.08)',
        },
        violet: {
          DEFAULT: '#8B7FE8',
          dim:     '#2E2860',
          ghost:   'rgba(139,127,232,0.08)',
        },
      },
      animation: {
        'pulse-gold':     'pulseGold 2s ease-in-out infinite',
        'pulse-green':    'pulseGreen 2s ease-in-out infinite',
        'pulse-amber':    'pulseGold 2s ease-in-out infinite',  // legacy alias
        'slide-in-right': 'slideInRight 0.2s ease-out forwards',
        'slide-out-right':'slideOutRight 0.15s ease-in forwards',
        'slide-in-left':  'slideInLeft 0.2s ease-out forwards',
        'slide-in-up':    'slideInUp 0.5s ease-out forwards',
        'fade-in':        'fadeIn 0.2s ease-out forwards',
        'shimmer':        'shimmer 1.5s ease-in-out infinite',
        'stroke-reveal':  'strokeReveal 0.6s ease-out forwards',
      },
      keyframes: {
        pulseGold: {
          '0%, 100%': { opacity: '1' },
          '50%':       { opacity: '0.4' },
        },
        pulseGreen: {
          '0%, 100%': { opacity: '1' },
          '50%':       { opacity: '0.6' },
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(100%)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        slideOutRight: {
          from: { opacity: '1', transform: 'translateX(0)' },
          to:   { opacity: '0', transform: 'translateX(100%)' },
        },
        slideInLeft: {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to:   { opacity: '1', transform: 'none' },
        },
        slideInUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to:   { backgroundPosition: '-200% 0' },
        },
        strokeReveal: {
          from: { strokeDashoffset: '100' },
          to:   { strokeDashoffset: '0' },
        },
      },
      transitionDuration: {
        '150': '150ms',
      },
      borderRadius: {
        'sm': '2px',
        DEFAULT: '4px',
      },
    },
  },
  plugins: [],
}

export default config
