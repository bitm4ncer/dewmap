# Handoff — Dark Matter map style (vector basemap tint)

**Scope:** this is the *only* thing carried over from the abandoned
`feat/neon-redesign` worktree. Do not port the rest of that redesign
(panel layout, badges, detail card, route treatment, palette).

**Target:** the current build on `feat/navigation-overhaul`
(`src/components/Map.tsx`, MapLibre 5, CARTO `dark-matter-gl-style`).

---

## What it does

The CARTO Dark Matter style is already close to "Dark Matter", but it has
a blue cast in the water and landuse, near-black landuse holes, blue-grey
road casing, and labels that are too small to read at 1440px. This pass
re-tints the vector style after it loads:

- neutral graphite land + roads (`#2C2D31` / `#4A4B50`), no blue or green areas
- parks/landuse/landcover flattened to one step above land
- water desaturated to `#26272B`
- buildings slightly lifted (`#303136`)
- a real label ramp: cities bright, districts mid, street names quiet
- district labels 2–3px larger with a little tracking, street names 1px larger

It is a **paint pass only** — no new sources, glyphs or layer ids, and it
does not touch raster/photo basemaps.

Reference screenshot: `docs/handoff/dark-map-style-reference.png`.

---

## Drop-in code

Paste near the other style helpers in `src/components/Map.tsx`
(e.g. next to `applyBasemap`). `MLMap` is the already-imported
`maplibregl.Map` type alias in that file.

```ts
/**
 * "Dark Matter" re-tint for the CARTO vector basemap: neutral graphite
 * land, lighter soft roads, desaturated water and parks, grey labels.
 * No colour competes with the app's accent, pins or route.
 */
function applyDarkMatterTint(map: MLMap) {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    const id = layer.id.toLowerCase();
    try {
      if (layer.type === "background") {
        map.setPaintProperty(layer.id, "background-color", "#2c2d31");
        continue;
      }
      if (layer.type === "fill") {
        let color = "#2c2d31";
        if (id.includes("water")) color = "#26272b";
        else if (id.includes("building")) color = "#303136";
        else if (
          id.includes("landuse") ||
          id.includes("landcover") ||
          id.includes("park") ||
          id.includes("wood") ||
          id.includes("grass") ||
          id.includes("golf") ||
          id.includes("cemetery") ||
          id.includes("sand") ||
          id.includes("ice")
        ) {
          color = "#292a2e";
        }
        map.setPaintProperty(layer.id, "fill-color", color);
        if (typeof map.getPaintProperty(layer.id, "fill-outline-color") !== "undefined") {
          map.setPaintProperty(layer.id, "fill-outline-color", color);
        }
        continue;
      }
      if (layer.type === "line") {
        let color = "#4a4b50";
        if (id.includes("waterway")) color = "#3a3e44";
        else if (id.includes("boundary") || id.includes("admin")) color = "#515258";
        else if (id.includes("aeroway")) color = "#46474d";
        else if (id.startsWith("tunnel")) color = "#3b3c41";
        else if (id.includes("rail")) color = "#3c3d42";
        else if (id.includes("_case")) color = "#35363b";
        map.setPaintProperty(layer.id, "line-color", color);
        continue;
      }
      if (layer.type === "symbol") {
        // Keep the style's own label hierarchy, nudged into the neutral
        // palette: cities brightest, districts mid, street names quiet.
        let color = "#9ca3af";
        if (id.startsWith("place_city") || id === "place_town") {
          color = "#d7dade";
        } else if (id.startsWith("place_")) {
          color = "#a9aeb7";
        } else if (
          id.startsWith("roadname") ||
          id.startsWith("watername") ||
          id.startsWith("poi_")
        ) {
          color = "#8f939b";
        }
        map.setPaintProperty(layer.id, "text-color", color);
        map.setPaintProperty(layer.id, "text-halo-color", "#26272b");

        // The Dark Matter style renders these tiers too small at 1440px.
        if (
          id.startsWith("place_suburbs") ||
          id.startsWith("place_villages") ||
          id.startsWith("place_hamlet") ||
          id === "place_town"
        ) {
          map.setLayoutProperty(layer.id, "text-size", [
            "interpolate", ["linear"], ["zoom"],
            10, 10,
            13, 11.5,
            16, 13,
          ]);
          map.setLayoutProperty(layer.id, "text-letter-spacing", 0.04);
        }
        if (id.startsWith("roadname")) {
          map.setLayoutProperty(layer.id, "text-size", [
            "interpolate", ["linear"], ["zoom"],
            12, 9,
            16, 11,
            18, 12,
          ]);
          map.setPaintProperty(layer.id, "text-halo-width", 1);
        }
        continue;
      }
      if (layer.type === "circle") {
        map.setPaintProperty(layer.id, "circle-color", "#9ca3af");
      }
    } catch {
      // Not every layer exposes every paint property — best effort.
    }
  }
}
```

---

## Wiring

Call it whenever the Dark Matter style has loaded, and again after every
`setStyle` (basemap switches wipe paint properties). `mapInstance` and
`active` already exist in the current `LiveMap` component; `active` is the
resolved basemap id.

```tsx
// Re-tint the Dark Matter vector style.
useEffect(() => {
  const map = mapInstance;
  if (!map || active !== "streets-dark") return;

  const apply = () => {
    try {
      applyDarkMatterTint(map);
    } catch (err) {
      console.warn("[dark-matter] tint failed", err);
    }
  };

  if (map.isStyleLoaded()) apply();
  else map.once("style.load", apply);

  return () => {
    map.off("style.load", apply);
  };
}, [active, mapInstance]);
```

If the current build already runs a `map.on("style.load", …)` hook for
other layers, just call `applyDarkMatterTint(map)` inside it instead of
adding a second effect.

**Do not** apply it to raster/photo basemaps (Esri, GIBS, Sentinel-2,
night), to the OHM historical style, or to user-provided styles.

---

## Colour reference

| Element | Colour |
|---|---|
| land / background | `#2C2D31` |
| water fill | `#26272B` |
| landuse / landcover / parks / wood / grass / golf / cemetery / sand / ice | `#292A2E` |
| buildings | `#303136` |
| roads (all line layers except the special cases) | `#4A4B50` |
| road casing (`*_case`) | `#35363B` |
| waterway line | `#3A3E44` |
| boundary / admin | `#515258` |
| aeroway | `#46474D` |
| tunnels | `#3B3C41` |
| rail | `#3C3D42` |
| labels: city / town | `#D7DADE` |
| labels: other `place_*` | `#A9AEB7` |
| labels: road / water / poi | `#8F939B` |
| label halo | `#26272B` |

Verified against CARTO Dark Matter `style.json` (`v20261026-01`). The
keyword matching degrades gracefully if layer ids change.

---

## Gotchas

1. **`text-size` and `text-letter-spacing` are layout properties** — use
   `setLayoutProperty`, not `setPaintProperty`.
2. **Re-apply after every `style.load`.** `setStyle` discards paint/layout
   overrides. Switching to satellite and back must re-tint.
3. **One-shot pass.** Layers added later (rails, overlays, routes, pins)
   keep their own colours; that is intended.
4. **`setPaintProperty` throws** when a layer does not define the property
   (`fill-outline-color` is the common case). The per-layer `try/catch`
   handles it; keep it.
5. **Token independence.** The hex values are literal on purpose: the map
   should read the same regardless of the app's surface tokens.
6. **Default view.** The current default is still the photo basemap. The
   tint only shows on Streets · dark. If you want new users to land on it,
   change the default `basemapMode` to `"vector"` in `src/lib/settings.ts`
   (and bump the persist version if existing users should migrate) —
   otherwise leave the user's basemap choice alone.

## Verification checklist

1. Select **Streets · dark** (View → Mode → Vector).
2. Sample the rendered canvas: land ≈ `#2C2D31`, roads ≈ `#4A4B50`,
   water ≈ `#26272B`; no blue/green areas.
3. In devtools:
   ```js
   window.__biosphereMap?.getPaintProperty("landuse", "fill-color"); // "#292a2e"
   window.__biosphereMap?.getPaintProperty("road_pri_fill_noramp", "line-color"); // "#4a4b50"
   ```
   (`window.__biosphereMap` exists only if the current build exposes the
   debug handle; otherwise read the values in MapLibre devtools or add a
   temporary log.)
4. Switch to Satellite and back → tint re-applies.
5. Zoom 12–14: district labels readable, street names subordinate to them.
6. No console errors.
