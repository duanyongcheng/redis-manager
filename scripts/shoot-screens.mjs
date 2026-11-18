/**
 * Captures the interface screenshots.
 *
 * 1. builds the frontend (vite build, output in dist/)
 * 2. serves dist/ with `vite preview` on PORT (default 4173)
 * 3. screenshots every view in both colour schemes into docs/screenshots
 *
 * The pages boot with `?preview=1`, which loads `scripts/preview-mock.js`
 * instead of the Go bindings, so no Redis server is needed.
 *
 * Usage: node scripts/shoot-screens.mjs [port]
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const port = process.argv[2] || "4173";
const filter = process.argv[3] || "";
const base = `http://localhost:${port}/`;
const outDir = "docs/screenshots";
mkdirSync(outDir, { recursive: true });

const demoCli = "window.__RM_PREVIEW_DEMO__(['INFO keyspace','HGETALL user:1002','KEYS user:100*','SCAN 0 MATCH user:100* COUNT 3'])";

const htmlPreviewAction = "(async()=>{document.querySelector('[data-key=\"cache:home:feed\"]')?.click();for(let i=0;i<40&&!document.querySelector('[data-seg-value=html]');i++)await new Promise(r=>setTimeout(r,50));document.querySelector('[data-seg-value=html]')?.click();await new Promise(r=>setTimeout(r,1500));})()";

// [scheme, view, extra evaluation, file suffix]
const SHOTS = [
  // Light is the default scheme, so it is captured first.
  ["light", "overview", "", ""],
  ["light", "browser", "", ""],
  ["light", "browser", htmlPreviewAction, "-value-preview"],
  ["light", "cli", demoCli, ""],
  ["light", "monitor", "", ""],
  ["light", "connections", "", ""],
  ["light", "settings", "", ""],
  ["light", "overview", "document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true}))", "-palette"],
  ["light", "connections", "document.querySelector('[data-action=new-connection]').click()", "-new-connection"],
  ["dark", "overview", "", ""],
  ["dark", "browser", "", ""],
  ["dark", "cli", demoCli, ""],
  ["dark", "monitor", "", ""],
  ["dark", "connections", "", ""],
  ["dark", "settings", "", ""],
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
  for (const [scheme, page, action = "", suffix = ""] of SHOTS) {
    const name = `${page}${suffix}-${scheme}.png`;
    if (filter && !name.includes(filter)) continue;
    const url = `${base}?preview=1&scheme=${scheme}&page=${page}`;
    try {
      const out = await run("node", ["scripts/cdp-shot.mjs", `${outDir}/${name}`, url, "1440", "900", "7000", action || "1"], true);
      console.log(out.trim().split("\n").filter((line) => !line.startsWith("EVAL")).join(" · "));
    } catch (error) {
      console.error(`failed ${name}: ${error.message}`);
    }
  }
} finally {
  server.kill();
}
