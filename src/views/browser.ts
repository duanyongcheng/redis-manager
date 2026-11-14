import { icon } from "../core/icons";
import { bytes, clip, decodeJsonString, esc, htmlPreviewDocument, keyPrefix, markdownToHtml, num, safeJson, ttl, typeLabel } from "../core/format";
import type { RedisValue } from "../core/api";
import { currentConnection, currentDb, type ConnectionKey, type ValueViewMode, type ViewState } from "../core/store";
import { settings } from "../theme/settings";
import { emptyState, iconBtn, pill, segmented } from "../ui/kit";

const TYPES = ["all", "string", "hash", "list", "set", "zset", "stream"];

/**
 * Keys = the key space on the left, the selected value on the right. The left
 * column is the filtered packet list; the right column is the detail tree of
 * one key, with its metadata as fields rather than as floating badges.
 */
export function browserView(s: ViewState): string {
  const conn = currentConnection();
  if (!conn) return emptyState("还没有连接", "先保存一个连接，才能浏览键空间。", { label: "新建连接", action: "new-connection" });

  const counts = new Map<string, number>();
  for (const key of s.keys) counts.set(key.type, (counts.get(key.type) ?? 0) + 1);

  const chips = TYPES.map(
    (t) => `<button class="chip ${s.keyType === t ? "active" : ""}" data-key-type="${t}" aria-pressed="${s.keyType === t}">${t === "all" ? "全部" : typeLabel(t)}<span class="chip-count">${t === "all" ? s.keys.length : counts.get(t) ?? 0}</span></button>`,
  ).join("");

  return `<div class="filterbar">
    <div class="search-field mono wide">${icon("search", 12)}<input id="key-filter" value="${esc(s.keyQuery)}" placeholder="筛选已扫到的键名" spellcheck="false" aria-label="筛选键名" /></div>
    <div class="search-field mono narrow">${icon("filter", 12)}<input id="key-pattern" value="${esc(s.keyPattern)}" placeholder="SCAN MATCH，如 user:*" spellcheck="false" aria-label="SCAN 匹配模式" /></div>
    <button class="btn sm" data-action="scan-reset">${icon("refresh", 11)} SCAN</button>
    <button class="chip ${settings.get("keyGrouping") ? "active" : ""}" data-action="toggle-grouping" title="按前缀分组显示" aria-pressed="${settings.get("keyGrouping")}">${icon("folder", 11)} 前缀分组</button>
    <span class="filterbar-meta">db${currentDb(conn)} · ${num(s.keyScanned)} scanned · cursor ${s.keyCursor}</span>
  </div>
  <div class="browser">
    <section class="browser-keys" aria-label="键列表">
      <div class="key-filters">${chips}</div>
      <div class="key-list scroll">${keyList(s)}</div>
      <div class="browser-foot">
        <span class="mono">${num(s.keys.length)} keys${s.keyDone ? " · SCAN 结束" : " · 可继续扫描"}</span>
        <span class="spacer"></span>
        ${s.scanning ? `<span class="spinner"></span>` : ""}
        <button class="btn sm" data-action="scan-more" ${s.keyDone || s.scanning ? "disabled" : ""}>继续 SCAN ${icon("chevronRight", 10)}</button>
      </div>
    </section>
    <section class="browser-value" aria-label="键值">${valuePanel(s)}</section>
  </div>`;
}

function keyList(s: ViewState): string {
  const q = s.keyQuery.toLowerCase();
  const keys = s.keys.filter((k) => (s.keyType === "all" || k.type === s.keyType) && (!q || k.key.toLowerCase().includes(q)));
  if (!keys.length) {
    return `<div class="key-list-empty">${s.scanning ? `<span class="spinner"></span> 正在 SCAN…` : s.keys.length ? "没有匹配当前筛选的键" : "SCAN 没有返回键，试着放宽匹配模式"}</div>`;
  }
  const row = (k: ConnectionKey, indent = false) => keyRow(k, s.selectedKey === k.key, indent);

  if (!settings.get("keyGrouping")) return keys.map((k) => row(k)).join("");

  const groups = new Map<string, ConnectionKey[]>();
  const loose: ConnectionKey[] = [];
  for (const key of keys) {
    const p = keyPrefix(key.key);
    if (!p) {
      loose.push(key);
      continue;
    }
    const list = groups.get(p.prefix) ?? [];
    list.push(key);
    groups.set(p.prefix, list);
  }
  let html = "";
  const multiple = groups.size + (loose.length ? 1 : 0) > 1;
  for (const [prefix, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!multiple) {
      html += list.map((k) => row(k)).join("");
      continue;
    }
    const collapsed = s.collapsedGroups[prefix] ?? false;
    html += `<button class="key-group" data-group="${esc(prefix)}" aria-expanded="${!collapsed}">${icon(collapsed ? "chevronRight" : "chevronDown", 10)}<b>${esc(prefix)}</b><span class="spacer"></span><span class="count">${list.length}</span></button>`;
    if (!collapsed) html += list.map((k) => row(k, true)).join("");
  }
  html += loose.map((k) => row(k)).join("");
  return html;
}

function keyRow(k: ConnectionKey, active: boolean, indent: boolean): string {
  const t = ttl(k.ttlMs);
  return `<button class="key-row ${active ? "active" : ""}" data-key="${esc(k.key)}" tabindex="${active ? "0" : "-1"}" title="${esc(k.key)} · ${typeLabel(k.type)} · ${t.short}" aria-current="${active}">
    <span class="k ${indent ? "indented" : ""}">${esc(k.key)}</span>
    <span class="meta"><span class="ttl ${t.persistent ? "faint" : ""}">${esc(t.short)}</span>${pill(k.type, typeLabel(k.type))}</span>
  </button>`;
}

/* ------------------------------------------------------------------ */
/* Value panel                                                         */
/* ------------------------------------------------------------------ */

function valuePanel(s: ViewState): string {
  if (s.valueLoading && !s.value) return `<div class="value-loading"><span class="spinner"></span> 读取值…</div>`;
  if (s.valueError) return `<div class="pad-inline"><div class="notice err">${icon("xCircle", 14)}<div class="notice-body"><b>读取失败</b><span>${esc(s.valueError)}</span></div></div></div>`;
  const v = s.value;
  if (!v) return `<div class="value-empty">${icon("key", 20)}<div>从左侧选择一个键查看内容</div></div>`;

  const t = ttl(v.ttlMs);
  const head = `<div class="value-head">
    <div class="value-title">${pill(v.type, typeLabel(v.type))}<span class="key-name" title="${esc(v.key)}">${esc(v.key)}</span></div>
    <div class="value-meta">
      <span>ttl <b>${esc(t.short)}</b></span>
      <span>size <b>${bytes(v.sizeBytes)}</b></span>
      <span>encoding <b>${esc(v.encoding || "—")}</b></span>
    </div>
    <div class="value-actions">
      ${iconBtn("copy", "copy-key", "复制键名")}
      ${iconBtn("refresh", "reload-value", "重新读取")}
      ${iconBtn("trash", "delete-key", "删除键", "danger")}
    </div>
  </div>`;

  const stringTools = v.type === "string" ? valueTools(s) : "";
  return `${head}${stringTools}<div class="value-body ${v.type === "string" ? "value-body-string" : "scroll"}">${valueBody(v, s.valueMode)}</div>${valueFoot(v)}`;
}

function valueTools(s: ViewState): string {
  const raw = String(s.value?.stringValue ?? "");
  const json = safeJson(raw);
  const items: { id: ValueViewMode; label: string }[] = [
    { id: "raw", label: "原始" },
    { id: "json", label: "JSON" },
    { id: "hex", label: "Hex" },
    { id: "html", label: "HTML 预览" },
    { id: "markdown", label: "MD 预览" },
  ].filter((i) => i.id !== "json" || json.ok) as { id: ValueViewMode; label: string }[];
  const active = s.valueMode === "json" && !json.ok ? "raw" : s.valueMode;
  return `<div class="value-tools"><span class="mlabel">格式</span>${segmented(items, active, "view-mode")}</div>`;
}

function valueBody(v: RedisValue, viewMode: ValueViewMode): string {
  const maxBytes = settings.get("maxValueBytes");
  switch (v.type) {
    case "string":
      return stringBody(v, maxBytes, viewMode);
    case "hash": {
      const entries = Object.entries(v.hash ?? {});
      const total = entries.length;
      const rows = entries
        .map(([field, value]) => `<tr><td class="key-cell">${esc(field)}</td><td class="key-cell">${esc(clip(value, 400).text)}${value.length > 400 ? " …" : ""}</td></tr>`)
        .join("");
      return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:32%">field<span class="mlabel" style="margin-left:6px">${num(total)}</span></th><th>value</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="2">空 Hash</td></tr>`}</tbody></table></div>
        <form class="hash-add" id="hash-form" data-key="${esc(v.key)}">
          <input class="input mono" name="field" placeholder="field" autocomplete="off" required aria-label="字段名" />
          <input class="input mono grow" name="value" placeholder="value" autocomplete="off" aria-label="字段值" />
          <button class="btn primary" type="submit">${icon("plus", 12)} 写入字段</button>
        </form>`;
    }
    case "list": {
      const rows = (v.list ?? []).map((item, i) => `<tr><td class="num-cell faint" style="width:64px">${i}</td><td class="key-cell">${esc(clip(item, 800).text)}</td></tr>`).join("");
      return `<table class="tbl"><thead><tr><th>index</th><th>value</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="2">空 List</td></tr>`}</tbody></table>`;
    }
    case "set": {
      const rows = (v.set ?? []).map((m) => `<tr><td class="key-cell">${esc(m)}</td></tr>`).join("");
      return `<table class="tbl"><thead><tr><th>member</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td>空 Set</td></tr>`}</tbody></table>`;
    }
    case "zset": {
      const rows = (v.zset ?? []).map((e, i) => `<tr><td class="num-cell faint" style="width:56px">${i + 1}</td><td class="key-cell">${esc(e.member)}</td><td class="num-cell">${e.score}</td></tr>`).join("");
      return `<table class="tbl"><thead><tr><th>#</th><th>member</th><th style="text-align:right">score</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="3">空 ZSet</td></tr>`}</tbody></table>`;
    }
    case "stream": {
      const rows = (v.stream ?? [])
        .map((entry) => `<tr><td class="key-cell faint" style="width:180px">${esc(entry.id)}</td><td><pre class="mono pre-inline">${esc(JSON.stringify(entry.values, null, 2))}</pre></td></tr>`)
        .join("");
      return `<table class="tbl"><thead><tr><th>id</th><th>fields</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="2">空 Stream</td></tr>`}</tbody></table>`;
    }
    default:
      return `<div class="value-empty">不支持的类型：${esc(v.type)}</div>`;
  }
}

function stringBody(v: RedisValue, maxBytes: number, viewMode: ValueViewMode): string {
  const raw = String(v.stringValue ?? "");
  const tooBig = v.sizeBytes > maxBytes;
  const limit = Math.min(maxBytes, 200_000);
  const json = safeJson(raw);
  const activeMode = viewMode === "json" && !json.ok ? "raw" : viewMode;
  const previewMode = activeMode === "html" || activeMode === "markdown";
  const shown = clip(previewMode ? decodeJsonString(raw).text : raw, limit);
  let body: string;
  switch (activeMode) {
    case "html":
      body = `<iframe class="html-preview" data-view="html" title="HTML 预览" sandbox="" referrerpolicy="no-referrer" srcdoc="${esc(htmlPreviewDocument(shown.text))}"></iframe>`;
      break;
    case "markdown":
      body = `<article class="markdown-preview" data-view="markdown">${markdownToHtml(shown.text)}</article>`;
      break;
    case "json":
      body = `<pre class="code-box mono" data-view="json">${esc(json.ok ? json.pretty : raw)}</pre>`;
      break;
    case "hex":
      body = `<pre class="code-box mono" data-view="hex">${esc(hexDump(shown.text))}</pre>`;
      break;
    default:
      body = `<pre class="code-box mono" data-view="raw">${esc(shown.text)}</pre>`;
  }
  const notice = shown.truncated ? `<div class="pad-inline pad-bottom"><div class="notice warn">${icon("alert", 13)}<div class="notice-body"><b>只渲染了前 ${bytes(shown.text.length)}</b><span>该值共 ${bytes(v.sizeBytes)}，可在设置中调整单次载入上限。</span></div></div></div>` : "";
  return body + notice;
}

function hexDump(text: string): string {
  const bytesArr = new TextEncoder().encode(text.slice(0, 4096));
  const lines: string[] = [];
  for (let i = 0; i < bytesArr.length; i += 16) {
    const chunk = Array.from(bytesArr.slice(i, i + 16));
    const hex = chunk.map((b) => b.toString(16).padStart(2, "0")).join(" ").padEnd(47, " ");
    const ascii = chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${i.toString(16).padStart(8, "0")}  ${hex}  ${ascii}`);
  }
  return lines.join("\n");
}

function valueFoot(v: RedisValue): string {
  const count =
    v.type === "hash" ? `${Object.keys(v.hash ?? {}).length} fields` : v.type === "list" ? `${(v.list ?? []).length} items` : v.type === "set" ? `${(v.set ?? []).length} members` : v.type === "zset" ? `${(v.zset ?? []).length} members` : v.type === "stream" ? `${(v.stream ?? []).length} entries` : `${bytes(v.sizeBytes)}`;
  const writable = v.type === "hash";
  return `<div class="value-foot"><span>${esc(count)}</span><span>·</span><span>${esc(ttl(v.ttlMs).label)}</span><span>·</span><span>${esc(v.encoding || "—")}</span><span class="spacer"></span><span>${writable ? "写入字段会立即生效" : "该类型当前只读，可在命令行写入"}</span></div>`;
}
