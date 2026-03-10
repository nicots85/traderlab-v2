import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // En dev local, proxea /api/groq directamente a Groq
      // (en producción lo maneja la serverless function de Vercel)
      "/api/groq": {
        target: "https://api.groq.com",
        changeOrigin: true,
        rewrite: () => "/openai/v1/chat/completions",
      },
    },
  },
});
