import type { MetadataRoute } from "next";
import th from "@/messages/th.json";

// Per docs/brand.md. The installed app opens in Thai; the language can be switched inside.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: th.app.pwaName,
    short_name: "Jaga",
    description: th.app.description,
    lang: "th",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F0F2EE",
    theme_color: "#1D3B53",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
