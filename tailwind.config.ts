import type { Config } from "tailwindcss";

// ---------------------------------------------------------------------------
// BRAND TOKENS — matched to purepickleball.com/academy.
//   • brand   = deep navy (backgrounds, nav, buttons, headings)
//   • accent  = bright lime / chartreuse (CTAs, italic display accents, labels)
//   • coral   = sparing secondary highlight (used like the site's "OPENING 2027")
// Every screen renders off these tokens; adjust here to fine-tune the palette.
// Fonts are defined in globals.css (serif display + sans body).
// ---------------------------------------------------------------------------

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef2f8",
          100: "#d5dfec",
          200: "#aebfd6",
          300: "#7d95b7",
          400: "#4c6791",
          500: "#2c4670",
          600: "#1c3357",
          700: "#152845",
          800: "#0e1d34",
          900: "#0a1626",
          950: "#060f1c",
        },
        accent: {
          50: "#f6fae7",
          100: "#eaf4c4",
          200: "#d9ea92",
          300: "#c4dd57",
          400: "#b6dd3f",
          500: "#a9d329",
          600: "#7f9c10",
          700: "#61760c",
          800: "#4a5a0a",
          900: "#3c4a0d",
        },
        coral: {
          400: "#e06a58",
          500: "#d1503f",
          600: "#b23f30",
        },
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-sans)"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(10,22,38,0.04), 0 1px 3px rgba(10,22,38,0.07)",
      },
    },
  },
  plugins: [],
} satisfies Config;
