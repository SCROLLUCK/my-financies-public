import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Proxy API calls to the Django backend (service name in docker-compose).
      "/api": {
        target: "http://backend:8000",
        changeOrigin: true,
      },
      // Receipt images and other uploads served by Django.
      "/media": {
        target: "http://backend:8000",
        changeOrigin: true,
      },
    },
  },
});
