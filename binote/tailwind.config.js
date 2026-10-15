import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Segoe UI"',
          '"Microsoft YaHei"',
          '"PingFang SC"',
          "system-ui",
          "sans-serif",
        ],
        display: [
          '"Segoe UI"',
          '"Microsoft YaHei"',
          '"PingFang SC"',
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        primary: {
          50: "#f1f8eb",
          100: "#eaf3df",
          200: "#d4e6bd",
          300: "#aac87c",
          400: "#83a35e",
          500: "#4f7c42",
          600: "#38613b",
          700: "#2f5336",
          800: "#23442d",
        },
        canvas: {
          50: "#f3f6f2",
          100: "#edf2e9",
          200: "#e1e7df",
          300: "#d4dece",
        },
        paper: {
          50: "#ffffff",
          100: "#f8faf5",
          200: "#eef3e9",
        },
        ink: {
          50: "#f1f5ed",
          100: "#e1e7df",
          200: "#ccd7cd",
          300: "#9aaa9c",
          400: "#829184",
          500: "#66756b",
          600: "#4d6354",
          700: "#395444",
          800: "#233e2e",
          900: "#15271d",
        },
        sage: {
          100: "#e8ebe1",
          200: "#d5d9c8",
          300: "#bcc3aa",
          500: "#78806f",
          700: "#5f6657",
        },
        gold: {
          100: "#f2e7d6",
          300: "#ddbe92",
          500: "#b88a53",
        },
      },
      boxShadow: {
        soft: "0 12px 32px -18px rgba(22, 44, 27, 0.22)",
        panel: "0 20px 48px -28px rgba(22, 44, 27, 0.26)",
        float: "0 24px 64px -30px rgba(22, 44, 27, 0.32)",
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.72)",
      },
    },
  },
  plugins: [typography],
};
