import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const repoPagesBase = "/McAllenISDBookRepository/";

export default defineConfig({
  plugins: [react()],
  // Project Pages URL: https://annvega-spec.github.io/McAllenISDBookRepository/
  // Local `npm run dev` keeps the default "./" unless VITE_BASE is set.
  base: process.env.VITE_BASE || (process.env.CI ? repoPagesBase : "./"),
  test: {
    environment: "node",
  },
});
