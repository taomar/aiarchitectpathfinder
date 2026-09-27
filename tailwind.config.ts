import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ms: {
          blue: "#0078D4",
          blueDark: "#106EBE",
          blueDeep: "#0A4C8F",
          ink: "#13243B",
          accent: "#3CC1FF",
          bg: "#F5F8FC",
          surface: "#FFFFFF",
          surfaceMuted: "#F2F7FC",
          panel: "#FFFFFF",
          border: "#E3E9F2",
          text: "#1B2638",
          muted: "#5A6675"
        }
      },
      fontFamily: {
        sans: ["'Segoe UI'", "system-ui", "-apple-system", "sans-serif"]
      },
      backgroundImage: {
        "brand-hero": "linear-gradient(135deg, #0B5CAD 0%, #0A4C8F 52%, #13243B 100%)",
        "brand-soft": "linear-gradient(180deg, #F4F8FC 0%, #FAFCFE 46%, #FFFFFF 100%)"
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.04), 0 8px 22px rgba(16,24,40,0.06)",
        cardLg: "0 2px 8px rgba(16,24,40,0.06), 0 24px 48px rgba(16,24,40,0.12)",
        brand: "0 22px 55px rgba(10,76,143,0.30)"
      }
    }
  },
  plugins: []
};
export default config;
