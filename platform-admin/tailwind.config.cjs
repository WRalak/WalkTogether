/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@walktogether/configuration/tailwind')],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './features/**/*.{ts,tsx}', '../packages/ui/src/**/*.{ts,tsx}'],
};
