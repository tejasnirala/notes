/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './docs/**/*.{md,mdx}',
    './blog/**/*.{md,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
  corePlugins: {
    preflight: false, // proper for Docusaurus to avoid style conflicts
  },
  darkMode: ['class', '[data-theme="dark"]'], // hooks into Docusaurus dark mode
};
