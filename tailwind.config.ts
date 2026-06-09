import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      animation: {
        "pulse-slow": "pulse-slow 2s ease-in-out infinite",
        "slide-up": "slide-up 0.3s ease-out",
        "price-drop": "price-drop 0.3s ease-out",
      },
      keyframes: {
        "pulse-slow": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.85", transform: "scale(1.03)" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "price-drop": {
          "0%": { color: "#f97316", transform: "scale(1.05)" },
          "100%": { color: "inherit", transform: "scale(1)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
