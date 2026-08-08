import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    // shadcn-generated components import each other as "@/components/...",
    // so the alias is not a convenience here — without it those files do not
    // resolve at all. TypeScript is told the same thing in tsconfig.app.json;
    // both are needed, because Vite resolves at build time and tsc only
    // type-checks.
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },

  server: {
    // Second Brain's ``agui_allowed_origins`` names this exact origin, and CORS
    // compares origins verbatim — a different port is a different origin. Vite
    // would otherwise take the next free port when 5173 is busy, which turns a
    // second dev server into a CORS failure that says nothing about ports.
    // strictPort makes it refuse to start instead, which is the legible failure.
    port: 5173,
    strictPort: true,
  },
});
