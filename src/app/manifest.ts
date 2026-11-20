import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import { THEME } from "@/lib/theme";

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
    // Keep both in the page surface colour: iOS samples them for the strip it
    // keeps below the layout viewport and for the launch screen.
    background_color: THEME.surface0,
    theme_color: THEME.surface0,
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
