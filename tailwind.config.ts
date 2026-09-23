import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // 터치 기기에서 탭한 뒤 hover 색이 남아 '켜진 상태'로 읽히지 않게 — 눌림은 active:가 맡는다
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        foreground: "var(--foreground)",
      },
    },
  },
  plugins: [],
};
export default config;
