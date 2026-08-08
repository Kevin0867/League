import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff", 100: "#d9eaff", 200: "#bcdbff", 300: "#8ec4ff",
          400: "#59a3ff", 500: "#337fff", 600: "#1b5ff5", 700: "#164ae1",
          800: "#193db6", 900: "#1a388f", 950: "#152357",
        },
        accent: {
          500: "#00b894", 600: "#00a383",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
