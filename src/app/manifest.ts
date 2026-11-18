import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    id: ".",
    lang: "en",
    categories: ["navigation", "travel", "maps", "utilities"],
    start_url: ".",
    scope: ".",
    display: "standalone",
    orientation: "any",
    background_color: "#121619",
    theme_color: "#121619",
    icons: [
      {
        src: "icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
