import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BiosphereOne",
    short_name: "BiosphereOne",
    description:
      "Hiking, cycling, driving and public-transport navigation with live satellite and environmental layers.",
    lang: "en",
    categories: ["navigation", "travel", "maps"],
    start_url: ".",
    scope: ".",
    display: "standalone",
    orientation: "any",
    background_color: "#0e0f0c",
    theme_color: "#0e0f0c",
    icons: [
      {
        src: "icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
