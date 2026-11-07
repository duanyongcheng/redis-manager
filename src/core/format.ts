/** Formatting helpers shared by every theme. Pure functions, no DOM. */

export const esc = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);

export const num = (value: number | null | undefined): string =>
  Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US") : "—";

export function compact(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e4) return `${trim(n / 1e3)}k`;
  return num(n);
}

const trim = (n: number): string => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2));

export function bytes(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return n === 0 ? "0 B" : "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(2)} ${units[i]}`;
}

/** Splits a byte count into value + unit so themes can typeset them apart. */
export function bytesParts(value: number | null | undefined): { value: string; unit: string } {
  const text = bytes(value);
  const idx = text.lastIndexOf(" ");
  if (idx < 0) return { value: text, unit: "" };
  return { value: text.slice(0, idx), unit: text.slice(idx + 1) };
}

export function pct(part: number | null | undefined, whole: number | null | undefined): number {
  const w = Number(whole);
  const p = Number(part);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(100, (p / w) * 100));
}

export function ms(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(2)} s`;
  if (n >= 10) return `${n.toFixed(1)} ms`;
  if (n >= 1) return `${n.toFixed(2)} ms`;
  return `${(n * 1000).toFixed(0)} µs`;
}

/** Relative TTL, the way Redis tools show key expiry. */
export function ttl(ttlMs: number | null | undefined): { short: string; label: string; persistent: boolean } {
  const n = Number(ttlMs);
  if (!Number.isFinite(n) || n < 0) return { short: "∞", label: "持久", persistent: true };
  if (n === 0) return { short: "0s", label: "即将过期", persistent: false };
  const s = Math.floor(n / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return { short: `${d}d ${h}h`, label: `${d} 天 ${h} 小时`, persistent: false };
  if (h > 0) return { short: `${h}h ${m}m`, label: `${h} 小时 ${m} 分`, persistent: false };
  if (m > 0) return { short: `${m}m ${sec}s`, label: `${m} 分 ${sec} 秒`, persistent: false };
  return { short: `${sec}s`, label: `${sec} 秒`, persistent: false };
}

export function duration(seconds: number | null | undefined): string {
  const s = Math.floor(Number(seconds) || 0);
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

export function timeAgo(unixSeconds: number | null | undefined): string {
  const s = Math.max(0, Date.now() / 1000 - Number(unixSeconds || 0));
  if (s < 60) return `${Math.floor(s)}s 前`;
  if (s < 3600) return `${Math.floor(s / 60)}m 前`;
  if (s < 86400) return `${Math.floor(s / 3600)}h 前`;
  return `${Math.floor(s / 86400)}d 前`;
}

export function clock(msEpoch: number | null | undefined): string {
  if (!msEpoch) return "—";
  const date = new Date(msEpoch);
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

export function dateTime(msEpoch: number | null | undefined): string {
  if (!msEpoch) return "—";
  return new Date(msEpoch).toLocaleString("zh-CN", { hour12: false });
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

export const TYPE_LABEL: Record<string, string> = {
  string: "String",
  hash: "Hash",
  list: "List",
  set: "Set",
  zset: "ZSet",
  stream: "Stream",
  none: "—",
};

export function typeLabel(type: string | null | undefined): string {
  const key = String(type || "").toLowerCase();
  return TYPE_LABEL[key] ?? (type ? String(type) : "—");
}

export const MODE_LABEL: Record<string, string> = {
  standalone: "Standalone",
  sentinel: "Sentinel",
  cluster: "Cluster",
};

export function modeLabel(mode: string | null | undefined): string {
  const key = String(mode || "").toLowerCase();
  return MODE_LABEL[key] ?? (mode ? String(mode) : "Standalone");
}

export function connAddress(conn: { host?: string; port?: number } | null | undefined): string {
  if (!conn) return "—";
  return `${conn.host || "127.0.0.1"}:${conn.port || 6379}`;
}

export function connLabel(conn: { host?: string; port?: number; db?: number } | null | undefined): string {
  if (!conn) return "—";
  return `${connAddress(conn)}/db${conn.db ?? 0}`;
}

export function shortId(id: string | null | undefined): string {
  const value = String(id || "");
  return value.length > 10 ? `${value.slice(0, 3)}${value.slice(-4)}` : value;
}

/** Glob style prefix extraction used by the key tree. */
export function keyPrefix(key: string): { prefix: string; rest: string } | null {
  const idx = key.search(/[:/.]/);
  if (idx <= 0 || idx === key.length - 1) return null;
  return { prefix: key.slice(0, idx + 1), rest: key.slice(idx + 1) };
}

export function safeJson(value: string | null | undefined): { ok: true; pretty: string } | { ok: false; error: string } {
  try {
    return { ok: true, pretty: JSON.stringify(JSON.parse(String(value ?? "")), null, 2) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isJson(value: string | null | undefined): boolean {
  return safeJson(value).ok;
}

/** Decodes a Redis string that was stored as a JSON-quoted string. */
export function decodeJsonString(value: string): { text: string; encoded: boolean } {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? { text: parsed, encoded: true } : { text: value, encoded: false };
  } catch {
    return { text: value, encoded: false };
  }
}

/** Truncates large payloads for the DOM; the full value stays in state. */
export function clip(value: string, max = 4000): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  return { text: value.slice(0, max), truncated: true };
}

/**
 * Renders the common Markdown blocks used in stored notes and documents.
 * The source is escaped before adding the small set of generated tags, so
 * Markdown values cannot inject markup into the host application.
 */
export function markdownToHtml(value: string | null | undefined): string {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let quote: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${paragraph.map(markdownInline).join("<br />")}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    output.push(`<blockquote>${quote.map(markdownInline).join("<br />")}</blockquote>`);
    quote = [];
  };
  const flushBlocks = () => {
    flushParagraph();
    closeList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fence = line.match(/^\s*```\s*([\w-]*)\s*$/);
    if (fence) {
      if (code) {
        const language = fence[1] ? ` class="language-${esc(fence[1])}"` : "";
        output.push(`<pre><code${language}>${esc(code.join("\n"))}</code></pre>`);
        code = null;
      } else {
        flushBlocks();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      flushBlocks();
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushBlocks();
      const level = heading[1]!.length;
      output.push(`<h${level}>${markdownInline(heading[2]!)}</h${level}>`);
      continue;
    }
    if (/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      flushBlocks();
      output.push("<hr />");
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isMarkdownTableDivider(lines[i + 1] ?? "")) {
      flushBlocks();
      const headers = markdownTableCells(line);
      const rows: string[][] = [];
      i += 1;
      while (i + 1 < lines.length && isMarkdownTableRow(lines[i + 1] ?? "") && !isMarkdownTableDivider(lines[i + 1] ?? "")) {
        i += 1;
        rows.push(markdownTableCells(lines[i] ?? ""));
      }
      output.push(`<table><thead><tr>${headers.map((cell) => `<th>${markdownInline(cell)}</th>`).join("")}</tr></thead><tbody>${rows
        .map((row) => `<tr>${headers.map((_, index) => `<td>${markdownInline(row[index] ?? "")}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`);
      continue;
    }

    const quoteLine = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quoteLine) {
      flushParagraph();
      closeList();
      quote.push(quoteLine[1] ?? "");
      continue;
    }
    flushQuote();

    const unordered = line.match(/^\s{0,3}[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s{0,3}\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextType: "ul" | "ol" = unordered ? "ul" : "ol";
      if (listType !== nextType) {
        closeList();
        listType = nextType;
        output.push(`<${listType}>`);
      }
      output.push(`<li>${markdownInline((unordered ?? ordered)![1]!)}</li>`);
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  if (code) output.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  flushBlocks();
  return output.join("") || `<p class="markdown-empty">（空内容）</p>`;
}

function isMarkdownTableRow(value: string): boolean {
  return /^\s*\|?.+\|.+\|?\s*$/.test(value);
}

function isMarkdownTableDivider(value: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(value);
}

function markdownTableCells(value: string): string[] {
  const trimmed = value.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function markdownInline(value: string): string {
  let html = esc(value);
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|#)[^\s)]+)\)/gi, (_match, label: string, href: string) => `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`);
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");
  html = html.replace(/(\*\*|__)(.+?)\1/g, "<strong>$2</strong>");
  html = html.replace(/(\*|_)([^*_\n]+?)\1/g, "<em>$2</em>");
  return html;
}

/** Builds a document for a script-disabled, opaque-origin preview iframe. */
export function htmlPreviewDocument(value: string | null | undefined): string {
  const safe = String(value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<\/?(script|iframe|frame|frameset|object|embed|base|meta|link|form)\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(?:href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi, "");
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'">`;
  const source = safe.trim();
  const fullDocument = /<(?:html|head|body)\b/i.test(source) || /^<!doctype\s+html\b/i.test(source);
  // Put the policy before any source markup. The HTML parser merges the
  // source's html/head/body into the document, retaining attributes and CSS.
  // Full documents keep their own typography, table spacing and borders.
  const prefix = `<!doctype html><meta charset="utf-8">${csp}<style>:root { color-scheme: light; }</style>`;
  if (fullDocument) return prefix + source;

  const fragmentStyle = `<style>
    :root { color-scheme: light; }
    :where(body) { margin: 24px; color: #20242b; background: #fff; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow-wrap: break-word; }
    :where(img) { max-width: 100%; height: auto; }
    :where(pre) { padding: 12px; overflow: auto; background: #f3f4f6; border-radius: 8px; }
    :where(code) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    :where(table) { border-collapse: collapse; }
    :where(th:not([align]), td:not([align])) { text-align: left; }
    :where(a) { color: #d54b3e; }
  </style>`;
  return `<!doctype html><html><head><meta charset="utf-8">${csp}${fragmentStyle}</head><body>${safe}</body></html>`;
}

export const writeCommands = new Set([
  "append", "auth", "bgrewriteaof", "bgsave", "config", "del", "flushall", "flushdb", "hdel", "hset", "hmset",
  "incr", "incrby", "lpop", "lpush", "lrem", "lset", "ltrim", "mset", "persist", "pexpire", "rename", "rpop",
  "rpush", "sadd", "set", "setex", "srem", "sunionstore", "unlink", "xadd", "xdel", "xtrim", "zadd", "zrem",
]);

export const BLOCKING_COMMANDS = new Set(["keys", "monitor", "debug", "script"]);

export const COMMAND_SUGGESTIONS = [
  "GET", "SET", "DEL", "EXISTS", "EXPIRE", "TTL", "TYPE", "SCAN", "KEYS", "HGET", "HGETALL", "HSET", "HDEL",
  "HLEN", "LRANGE", "LPUSH", "RPUSH", "LLEN", "SMEMBERS", "SADD", "SREM", "SCARD", "ZRANGE", "ZADD", "ZCARD",
  "XADD", "XRANGE", "XLEN", "INFO", "DBSIZE", "CLIENT", "SLOWLOG", "MEMORY", "OBJECT", "PING", "SCARD", "SELECT",
  "COMMAND", "CONFIG", "FLUSHDB", "FLUSHALL", "SCAN", "SORT", "STRLEN", "PTTL",
];

export function splitCommandLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quote) {
      if (ch === "\\" && i + 1 < line.length) {
        cur += line[i + 1];
        i += 1;
      } else if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has) {
        out.push(cur);
        cur = "";
        has = false;
      }
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has) out.push(cur);
  return out;
}

export function prettyCommand(args: string[]): string {
  return args
    .map((arg) => (/^[^\s"'\\]*$/.test(arg) ? arg : JSON.stringify(arg)))
    .join(" ");
}
