import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        nhra: {
          red: "#C8102E",
          blue: "#003DA5",
          dark: "#1a1a2e",
          darker: "#12121f",
          card: "#1e1e32",
          border: "#2a2a44",
        },
      },
    },
  },
  plugins: [],
};
export default config;
