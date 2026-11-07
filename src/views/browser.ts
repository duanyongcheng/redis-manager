import { icon } from "../core/icons";
import { bytes, clip, esc, isJson, keyPrefix, num, safeJson, ttl, typeLabel } from "../core/format";
import type { RedisValue } from "../core/api";
import { currentConnection, type ConnectionKey, type ViewState } from "../core/store";
import { settings } from "../theme/settings";
import { emptyState, iconBtn, pill } from "../ui/kit";

const TYPES = ["all", "string", "hash", "list", "set", "zset", "stream"];

export function browserView(s: ViewState): string {
  const conn = currentConnection();
  if (!conn) return emptyState("还没有连接", "先保存一个连接，才能浏览键空间。", { label: "新建连接", action: "new-connection" });

  const counts = new Map<string, number>();
  for (const key of s.keys) counts.set(key.type, (counts.get(key.type) ?? 0) + 1);

  const chips = TYPES.map(
    (t) => `<button class="chip ${s.keyType === t ? "active" : ""}" data-key-type="${t}">${t === "all" ? "全部" : typeLabel(t)}<span class="chip-count">${t === "all" ? s.keys.length : counts.get(t) ?? 0}</span></button>`,
  ).join("");

  return `<div class="browser">
    <section class="card browser-keys">
      <header class="card-head" style="gap:8px;flex-wrap:wrap">
        <div class="search-mini grow" style="max-width:260px">${icon("search", 13)}<input id="key-pattern" value="${esc(s.keyPattern)}" placeholder="SCAN MATCH（例如 user:*）" spellcheck="false" data-key-pattern /></div>
        <button class="btn sm" data-action="scan-reset">${icon("refresh", 12)} SCAN</button>
        <span class="spacer"></span>
        <span class="card-meta">${num(s.keyScanned)} scanned · cursor ${s.keyCursor}</span>
      </header>
      <div class="browser-chips">${chips}<span class="spacer"></span><button class="chip ${settings.get("keyGrouping") ? "active" : ""}" data-action="toggle-grouping" title="按前缀分组">${icon("folder", 11)} 分组</button></div>
      <div class="key-list scroll">${keyList(s)}</div>
      <div class="browser-foot">
        <span class="mono faint">${num(s.keyScanned)} keys · ${s.keyDone ? "SCAN 结束" : "可继续扫描"}</span>
        <span class="spacer"></span>
        ${s.scanning ? `<span class="spinner"></span>` : ""}
        <button class="btn sm" data-action="scan-more" ${s.keyDone || s.scanning ? "disabled" : ""}>继续 SCAN ${icon("chevronRight", 11)}</button>
      </div>
    </section>
    <section class="card browser-value">${valuePanel(s)}</section>
  </div>`;
}

function keyList(s: ViewState): string {
  const q = s.keyQuery.toLowerCase();
  let keys = s.keys.filter((k) => (s.keyType === "all" || k.type === s.keyType) && (!q || k.key.toLowerCase().includes(q)));
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
    html += `<button class="key-group" data-group="${esc(prefix)}">${icon(collapsed ? "chevronRight" : "chevronDown", 11)}<b>${esc(prefix)}</b><span class="faint">${list.length}</span></button>`;
    if (!collapsed) html += list.map((k) => row(k, true)).join("");
  }
  html += loose.map((k) => row(k)).join("");
  return html;
}

function keyRow(k: ConnectionKey, active: boolean, indent: boolean): string {
  const t = ttl(k.ttlMs);
  return `<button class="key-row ${active ? "active" : ""}" data-key="${esc(k.key)}" title="${esc(k.key)}">
    <span class="k mono ${indent ? "indented" : ""}">${esc(k.key)}</span>
    <span class="meta"><span class="ttl mono ${t.persistent ? "faint" : ""}">${esc(t.short)}</span>${pill(k.type, typeLabel(k.type))}</span>
  </button>`;
}

/* ------------------------------------------------------------------ */
/* Value panel                                                         */
/* ------------------------------------------------------------------ */

function valuePanel(s: ViewState): string {
  if (s.valueLoading && !s.value) return `<div class="value-loading"><span class="spinner"></span> 读取值…</div>`;
  if (s.valueError) return `<div class="card-body">${`<div class="notice err">${esc(s.valueError)}</div>`}</div>`;
  const v = s.value;
  if (!v) return `<div class="value-empty">${icon("key", 22)}<div>从左侧选择一个键查看内容</div></div>`;

  const t = ttl(v.ttlMs);
  const head = `<header class="value-head">
    <div class="value-title">
      ${pill(v.type, typeLabel(v.type))}
      <span class="mono ellipsis" style="font-size:13px">${esc(v.key)}</span>
    </div>
    <div class="value-meta">
      <span>T TL <b class="mono">${esc(t.short)}</b></span>
      <span>大小 <b class="mono">${bytes(v.sizeBytes)}</b></span>
      <span>编码 <b class="mono">${esc(v.encoding || "—")}</b></span>
    </div>
    <div class="row" style="margin-left:auto">
      ${iconBtn("copy", "copy-key", "复制键名")}
      ${iconBtn("refresh", "reload-value", "重新读取")}
      ${iconBtn("trash", "delete-key", "删除键", "danger")}
    </div>
  </header>`;

  return `${head}<div class="value-body scroll">${valueBody(v)}</div>${valueFoot(v)}`;
}

function valueBody(v: RedisValue): string {
  const maxBytes = settings.get("maxValueBytes");
  switch (v.type) {
    case "string":
      return stringBody(v, maxBytes);
    case "hash": {
      const entries = Object.entries(v.hash ?? {});
      const rows = entries
        .map(([field, value]) => `<tr><td class="key-cell">${esc(field)}</td><td class="mono">${esc(clip(value, 400).text)}${value.length > 400 ? " …" : ""}</td></tr>`)
        .join("");
      return `<table class="tbl"><thead><tr><th style="width:32%">field</th><th>value</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="2">空 Hash</td></tr>`}</tbody></table>
        <form class="hash-add" id="hash-form">
          <input class="input mono" name="field" placeholder="field" autocomplete="off" required />
          <input class="input mono grow" name="value" placeholder="value" autocomplete="off" />
          <button class="btn primary" type="submit">${icon("plus", 13)} 写入字段</button>
        </form>`;
    }
    case "list": {
      const rows = (v.list ?? []).map((item, i) => `<tr><td class="num-cell faint" style="width:70px">${i}</td><td class="mono">${esc(clip(item, 800).text)}</td></tr>`).join("");
      return `<table class="tbl"><thead><tr><th>index</th><th>value</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="2">空 List</td></tr>`}</tbody></table>`;
    }
    case "set": {
      const rows = (v.set ?? []).map((m) => `<tr><td class="mono">${esc(m)}</td></tr>`).join("");
      return `<table class="tbl"><thead><tr><th>member</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td>空 Set</td></tr>`}</tbody></table>`;
    }
    case "zset": {
      const rows = (v.zset ?? []).map((e, i) => `<tr><td class="num-cell" style="width:64px">${i + 1}</td><td class="mono">${esc(e.member)}</td><td class="num-cell">${e.score}</td></tr>`).join("");
      return `<table class="tbl"><thead><tr><th>#</th><th>member</th><th style="text-align:right">score</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="3">空 ZSet</td></tr>`}</tbody></table>`;
    }
    case "stream": {
      const rows = (v.stream ?? [])
        .map((entry) => `<tr><td class="mono faint" style="width:190px">${esc(entry.id)}</td><td><pre class="mono pre-inline">${esc(JSON.stringify(entry.values, null, 2))}</pre></td></tr>`)
        .join("");
      return `<table class="tbl"><thead><tr><th>id</th><th>fields</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="2">空 Stream</td></tr>`}</tbody></table>`;
    }
    default:
      return `<div class="value-empty">不支持的类型：${esc(v.type)}</div>`;
  }
}

function stringBody(v: RedisValue, maxBytes: number): string {
  const raw = String(v.stringValue ?? "");
  const tooBig = v.sizeBytes > maxBytes;
  const shown = clip(raw, tooBig ? Math.min(maxBytes, 200_000) : 200_000);
  const json = isJson(raw);
  const tabs = `<div class="segmented" style="margin-bottom:10px">
    <button class="active" data-seg-action="view-mode" data-seg-value="raw">原始</button>
    <button data-seg-action="view-mode" data-seg-value="json" ${json ? "" : "disabled"}>JSON</button>
    <button data-seg-action="view-mode" data-seg-value="hex">Hex</button>
  </div>`;
  const body = `<pre class="code-box mono" data-view="raw">${esc(shown.text)}</pre>
    <pre class="code-box mono hidden" data-view="json">${esc(json ? safeJson(raw).ok && (safeJson(raw) as { pretty: string }).pretty : "")}</pre>
    <pre class="code-box mono hidden" data-view="hex">${esc(hexDump(shown.text))}</pre>
    ${shown.truncated ? `<div class="notice info" style="margin-top:8px">值较大（${bytes(v.sizeBytes)}），只渲染了前 ${bytes(shown.text.length)}。可在设置中调整单次载入上限。</div>` : ""}`;
  return tabs + body;
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
  if (v.type !== "hash") {
    return `<footer class="value-foot"><span class="mono faint">${ttl(v.ttlMs).label} · ${bytes(v.sizeBytes)} · ${esc(v.encoding || "—")}</span><span class="spacer"></span><span class="faint" style="font-size:11px">当前版本只读浏览该类型</span></footer>`;
  }
  return `<footer class="value-foot"><span class="mono faint">${Object.keys(v.hash ?? {}).length} fields · ${bytes(v.sizeBytes)}</span><span class="spacer"></span><span class="faint" style="font-size:11px">写入会立即生效</span></footer>`;
}

