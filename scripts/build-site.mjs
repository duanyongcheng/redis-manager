#!/usr/bin/env node
// Assembles the static homepage into _site/: site/ plus the screenshots and
// app icon the page references. No bundler and no dependencies.

import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
const out = join(root, "_site");

// `site/assets/overview-analyser-*.png` are tight crops of
// docs/screenshots/overview-{light,dark}.png; regenerate them when the
// overview UI changes.
const screenshots = [
  "overview-light.png",
  "overview-dark.png",
  "browser-light.png",
  "browser-dark.png",
  "cli-light.png",
  "cli-dark.png",
  "monitor-light.png",
  "monitor-dark.png",
  "connections-light.png",
  "connections-dark.png",
];

await rm(out, { recursive: true, force: true });
await cp(site, out, { recursive: true });

await mkdir(join(out, "screenshots"), { recursive: true });
for (const name of screenshots) {
  await copyFile(join(root, "docs", "screenshots", name), join(out, "screenshots", name));
}

await mkdir(join(out, "assets"), { recursive: true });
await copyFile(join(root, "resources", "icon.png"), join(out, "assets", "icon.png"));

console.log(`Built homepage to ${out}`);
