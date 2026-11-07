/**
 * Captures the theme gallery.
 *
 * 1. builds the frontend (vite build, output in dist/)
 * 2. serves dist/ with `vite preview` on PORT (default 4173)
 * 3. screenshots every theme × page combination into docs/screenshots/themes
 *
 * The pages boot with `?preview=1`, which loads `scripts/preview-mock.js`
 * instead of the Go bindings, so no Redis server is needed.
 *
 * Usage: node scripts/shoot-themes.mjs [port]
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const port = process.argv[2] || "4173";
const base = `http://localhost:${port}/`;
const outDir = "docs/screenshots/themes";
mkdirSync(outDir, { recursive: true });

const SHOTS = [
  ["console", "dark", "overview"],
  ["console", "dark", "browser"],

  ["console", "dark", "monitor"],
  ["console", "light", "overview"],
  ["terminal", "dark", "overview"],
  ["terminal", "dark", "browser"],
  ["terminal", "dark", "cli", "window.__RM_PREVIEW_DEMO__(['INFO keyspace','HGETALL user:1002','KEYS user:100*','SCAN 0 MATCH user:100* COUNT 3'])"],
  ["console", "dark", "cli", "__RM_PREVIEW_DEMO__(['DBSIZE','INFO server','SCAN 0 MATCH user:100* COUNT 3','GET cache:home:feed'])"],
  ["craft", "light", "overview"],
  ["craft", "light", "browser"],
  ["craft", "dark", "cli", "__RM_PREVIEW_DEMO__(['INFO keyspace','HGETALL user:1002','TTL user:1002'])"],
  ["airy", "dark", "overview"],
  ["airy", "dark", "browser"],
  ["airy", "dark", "monitor"],
  ["craft", "light", "settings", "Array.from(document.querySelectorAll('[data-action=new-connection]'))[0].click()"],
  ["airy", "dark", "overview", "document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true}))"],
];

const run = (cmd, args, capture = false) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let out = "";
    child.stdout?.on("data", (chunk) => (out += chunk));
    child.stderr?.on("data", (chunk) => (out += chunk));
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`${cmd} exited ${code}\n${out.slice(-1500)}`));
      resolve(out);
    });
  });

await run("npx", ["vite", "build"]);
const server = spawn("npx", ["vite", "preview", "--port", port, "--strictPort"], { stdio: "ignore" });
try {
  await new Promise((r) => setTimeout(r, 2500));
  for (const [theme, scheme, page, action = "1"] of SHOTS) {
    // Overlays (a click that opens a dialog/palette) get a distinct file name.
    const suffix = action.includes(".click()") || action.includes("metaKey") ? "-dialog" : "";
    const name = `${theme}-${scheme}-${page}${suffix}.png`;
    const url = `${base}?preview=1&theme=${theme}&scheme=${scheme}&page=${page}`;
    try {
      const out = await run("node", ["scripts/cdp-shot.mjs", `${outDir}/${name}`, url, "1600", "1000", "4200", action], true);
      console.log(out.trim().split("\n").filter((line) => !line.startsWith("EVAL")).join(" · "));
    } catch (error) {
      console.error(`failed ${name}: ${error.message}`);
    }
  }
} finally {
  server.kill();
}
