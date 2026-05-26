import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        paper:   { DEFAULT: '#f8f4ec', 2: '#f1ecdf', 3: '#e8e1cf' },
        ink:     { DEFAULT: '#1a1a17', 2: '#3a3935' },
        muted:   '#76726a',
        line:    { DEFAULT: '#e0d8c4', strong: '#c9bfa4' },
        accent:  { DEFAULT: '#ff6a4d', soft: '#ffe1d8', deep: '#d44a2f' },
        mint:    { DEFAULT: '#b8e3c8', deep: '#6fbe8a', bg: '#d8ecde' },
        amber:   { DEFAULT: '#f4c97c', bg: '#fbf0d4', deep: '#c89236' },
        rose:    { DEFAULT: '#f0a8a0', bg: '#fbe1dd' },
        slate:   { DEFAULT: '#a8b8c9', bg: '#dde6ee' },
      },
    },
  },
  plugins: [],
} satisfies Config
