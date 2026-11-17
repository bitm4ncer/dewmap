import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname;
const EXT = /\.(ts|tsx|css)$/;
// Deliberately narrow: pictographic emoji and variation selectors. Arrows,
// dashes and mathematical symbols in comments are not emoji.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (EXT.test(entry.name)) {
      yield path;
    }
  }
}

let failed = false;
for await (const file of walk(ROOT)) {
  const text = await readFile(file, "utf8");
  if (!EMOJI.test(text)) continue;
  text.split("\n").forEach((line, index) => {
    if (EMOJI.test(line)) {
      failed = true;
      console.error(`${relative(process.cwd(), file)}:${index + 1}: emoji found`);
    }
  });
}

if (failed) {
  console.error("\nEmoji are not allowed in source. Use an SVG icon or text.");
  process.exit(1);
}
console.log("No emoji found in src/.");
