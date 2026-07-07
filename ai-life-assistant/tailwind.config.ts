import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17202a",
        calm: "#f5f7f4",
        mist: "#dce7e3",
        tide: "#287c7b",
        ember: "#c76d49",
        plum: "#6f5b7c"
      },
      boxShadow: {
        soft: "0 16px 40px rgba(23, 32, 42, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
