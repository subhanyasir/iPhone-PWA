import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "icons/icon-192.svg",
        "icons/icon-512.svg",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/apple-touch-icon.png"
      ],
      manifest: {
        name: "Generatore di numeri italiani",
        short_name: "Numeri italiani",
        description: "Genera numeri di prova in formato italiano, in modo privato e direttamente sul dispositivo.",
        theme_color: "#0b0d0c",
        background_color: "#0b0d0c",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: "index.html"
      }
    })
  ],
  build: { target: "es2022" }
});
