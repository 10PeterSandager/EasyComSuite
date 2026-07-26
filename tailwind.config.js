/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./client/**/*.{ts,tsx}",
  ],
  safelist: [
    // Dynamic themeColor variants (orange | blue)
    { pattern: /^bg-(orange|blue)-(500|600|900|950)$/ },
    { pattern: /^text-(orange|blue)-(300|400|500|600)$/ },
    { pattern: /^border-(orange|blue)-(400|500|700)$/ },
    { pattern: /^ring-(orange|blue)-500$/ },
    { pattern: /^shadow-(orange|blue)-(900|950)$/ },
  ],
  theme: { extend: {} },
  plugins: [],
}
