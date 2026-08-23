import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0A0A0A",
        panel: "#121210",
        panel2: "#1A1A17",
        line: "#242422",
        gold: "#F0A83A",
        golddeep: "#B57F26",
        cream: "#EDEDE8",
        muted: "#98988D",
        good: "#4ADE80",
        bad: "#F87171",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      animation: {
        "pulse-gold": "pulseGold 2s ease-in-out infinite",
        "pulse-dot": "pulseDot 2s ease-in-out infinite",
      },
      keyframes: {
        pulseGold: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(240,168,58,0.5)" },
          "50%": { boxShadow: "0 0 0 8px rgba(240,168,58,0)" },
        },
        pulseDot: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.45", transform: "scale(0.82)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
