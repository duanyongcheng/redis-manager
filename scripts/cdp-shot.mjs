/**
 * Screenshot helper for development: drives headless Chrome over CDP so pages
 * can be captured after async data settles, with page errors surfaced.
 *
 * Usage: node scripts/cdp-shot.mjs <out.png> <url> [width] [height] [waitMs] [evalAfter]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [out, url, w = "1600", h = "1000", wait = "4000", evalAfter = ""] = process.argv.slice(2);
if (!out || !url) {
  console.error("usage: node scripts/cdp-shot.mjs <out.png> <url> [w] [h] [waitMs] [evalAfter]");
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "rm-chrome-"));
const port = 9200 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-crash-reporter",
  "--disable-breakpad",
  "--hide-scrollbars",
  `--window-size=${w},${h}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  throw new Error("chrome did not start");
}

const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.exceptionThrown") {
    logs.push(`EXCEPTION ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  } else if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
    logs.push(`${msg.params.type.toUpperCase()} ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const msgId = (id += 1);
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: Number(w), height: Number(h), deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
await sleep(Number(wait));
if (evalAfter) {
  const res = await send("Runtime.evaluate", { expression: evalAfter, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) logs.push(`EVAL ${res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text}`);
  else console.log("EVAL", JSON.stringify(res.result?.result?.value));
  await sleep(600);
}
if (evalAfter === "__debug") {
  const dbg = await send("Runtime.evaluate", {
    expression: "JSON.stringify({dbg: window.__RM_DEBUG__, svc: !!window.RedisService, state: window.__RM_STATE__ && {conns: window.__RM_STATE__.connections.length, avail: window.__RM_STATE__.serviceAvailable}})",
    returnByValue: true,
  });
  console.log("DEBUG", dbg.result?.result?.value);
}
// Force animations to their end state: backdrop-filter compositing is not
// flushed in headless captures, which would show overlays half-transparent.
await send("Runtime.evaluate", { expression: "document.querySelectorAll('.scrim,.dialog-scrim,.toast,.app').forEach((el) => { el.style.animation = 'none'; }); 1" });
await sleep(250);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
ws.close();
chrome.kill();
try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* chrome may still hold files */ }
if (logs.length) console.log(logs.slice(0, 8).join("\n"));
console.log(`saved ${out}`);
