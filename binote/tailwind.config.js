import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Manrope"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Noto Sans SC"',
          "system-ui",
          "sans-serif",
        ],
        display: [
          '"Newsreader"',
          '"Source Han Serif SC"',
          '"Noto Serif SC"',
          '"Songti SC"',
          '"STSong"',
          "serif",
        ],
      },
      colors: {
        primary: {
          50: "#f8eee8",
          100: "#f2e2d8",
          200: "#e6c7b4",
          300: "#d7a084",
          400: "#c97a58",
          500: "#b75d3e",
          600: "#9c4d33",
          700: "#7f3f2d",
          800: "#673326",
        },
        canvas: {
          50: "#fbf8f2",
          100: "#f5efe4",
          200: "#ece3d3",
          300: "#ddd0bd",
        },
        paper: {
          50: "#fffdf8",
          100: "#fbf7ef",
          200: "#f3ecdf",
        },
        ink: {
          50: "#f3efe7",
          100: "#e7dfd2",
          200: "#d0c3b3",
          300: "#b29f8a",
          400: "#8f7e6f",
          500: "#6d6257",
          600: "#574d45",
          700: "#413a34",
          800: "#2e2924",
          900: "#1f1b18",
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
        soft: "0 18px 40px -24px rgba(58, 44, 28, 0.28)",
        panel: "0 24px 60px -34px rgba(59, 44, 25, 0.32)",
        float: "0 28px 80px -38px rgba(75, 53, 27, 0.38)",
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.72)",
      },
      backgroundImage: {
        "paper-glow":
          "radial-gradient(circle at top left, rgba(255,255,255,0.7), transparent 42%), radial-gradient(circle at bottom right, rgba(183,93,62,0.12), transparent 36%)",
      },
    },
  },
  plugins: [typography],
};
