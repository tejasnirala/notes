module.exports = {
  plugins: {
    // Tailwind v4. Handles vendor prefixing itself (via Lightning CSS), so
    // autoprefixer is not listed here — Tailwind v4 explicitly recommends
    // against it, and Docusaurus separately runs postcss-preset-env
    // (which includes autoprefixer) over all CSS.
    '@tailwindcss/postcss': {},
  },
};
