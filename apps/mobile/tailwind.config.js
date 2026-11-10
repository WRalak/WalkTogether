/** Mirrors the web design tokens (packages/configuration/tailwind) with concrete colours for native. */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './features/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#127a50', foreground: '#ffffff', soft: '#e3f3ec' },
        accent: { DEFAULT: '#f97316', foreground: '#ffffff' },
        ink: { DEFAULT: '#14211c', muted: '#5b6b64' },
        surface: { DEFAULT: '#ffffff', muted: '#f4f7f5' },
        line: '#dbe5e0',
        danger: '#c42727',
        success: '#16803d',
      },
    },
  },
  plugins: [],
};
