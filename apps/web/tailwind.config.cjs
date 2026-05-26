module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        glass: "0 18px 60px rgba(0,0,0,0.55)",
        glassSm: "0 10px 30px rgba(0,0,0,0.45)",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          '"Noto Sans"',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
        ],
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.16, 1, 0.3, 1)",
        springSoft: "cubic-bezier(0.2, 0.9, 0.2, 1)",
      },
      keyframes: {
        "island-in": {
          "0%": { opacity: "0", transform: "translateY(-14px) scale(0.92)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "island-out": {
          "0%": { opacity: "1", transform: "translateY(0) scale(1)" },
          "100%": { opacity: "0", transform: "translateY(-10px) scale(0.96)" },
        },
        "press-in": {
          "0%": { transform: "scale(1)" },
          "100%": { transform: "scale(0.965)" },
        },
        "pop": {
          "0%": { transform: "scale(0.94)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(99,102,241,0.0)" },
          "35%": { boxShadow: "0 0 0 8px rgba(99,102,241,0.16)" },
          "100%": { boxShadow: "0 0 0 14px rgba(99,102,241,0.0)" },
        },
      },
      animation: {
        "island-in": "island-in 260ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "island-out": "island-out 200ms cubic-bezier(0.16, 1, 0.3, 1) both",
        pop: "pop 180ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "press-in": "press-in 110ms cubic-bezier(0.2, 0.9, 0.2, 1) both",
        "pulse-ring": "pulse-ring 900ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
