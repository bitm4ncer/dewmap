export const SITE_NAME = "dewmap";
export const SITE_TAGLINE = "Maps, trains and the real world.";
export const SITE_DESCRIPTION =
  "A client-side map for trains, trails and the real world: train-first public transport, hiking and walking routes, satellite basemaps and live environmental layers. No backend, no accounts, no tracking.";

/**
 * Canonical origin + base path, without a trailing slash. The GitHub Pages
 * workflow derives this from the repository name; override it with
 * NEXT_PUBLIC_SITE_URL for a custom domain.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://bitm4ncer.github.io/dewmap"
).replace(/\/+$/, "");
