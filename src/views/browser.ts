import { icon } from "../core/icons";
import { bytes, clip, decodeJsonString, esc, htmlPreviewDocument, keyPrefix, markdownToHtml, num, safeJson, ttl, typeLabel } from "../core/format";
import type { RedisValue } from "../core/api";
import { currentConnection, currentDb, type ConnectionKey, type ValueViewMode, type ViewState } from "../core/store";
import { settings } from "../theme/settings";
import { emptyState, iconBtn, pill, segmented } from "../ui/kit";

const TYPES = ["all", "string", "hash", "list", "set", "zset", "stream"];
const JSON_PARSE_LIMIT = 2 * 1024 * 1024;
const HASH_CELL_CLIP = 400;
const LIST_CELL_CLIP = 800;

export interface NewKeyDraft {
  key: string;
  type: "string" | "hash";
  field: string;
  value: string;
  ttl: string;
}

let ttlEditingKeyId: string | null = null;
let stringEditingKeyId: string | null = null;
let stringDraftValue = "";
const expandedCells = new Set<string>();

export function currentBrowserKeyId(s: ViewState): string {
  const conn = currentConnection();
  const db = conn ? currentDb(conn) : 0;
  const key = s.value?.key ?? s.selectedKey ?? "";
  return key ? `${s.connId ?? ""}:${db}:${key}` : "";
}

export function isTtlEditing(keyId?: string): boolean {
  return keyId !== undefined ? Boolean(keyId && ttlEditingKeyId === keyId) : ttlEditingKeyId !== null;
}

export function setTtlEditing(open: boolean, keyId = ""): void {
  ttlEditingKeyId = open && keyId ? keyId : null;
}

export function isStringEditing(keyId?: string): boolean {
  return keyId !== undefined ? Boolean(keyId && stringEditingKeyId === keyId) : stringEditingKeyId !== null;
}

export function openStringEditor(keyId: string, initialValue: string): void {
  if (!keyId) return;
  stringEditingKeyId = keyId;
  stringDraftValue = initialValue;
}

export function closeStringEditor(): void {
  stringEditingKeyId = null;
  stringDraftValue = "";
}

export function updateStringDraft(value: string): void {
  stringDraftValue = value;
}

export function toggleExpandedCell(cellId: string): void {
  if (!cellId) return;
  if (expandedCells.has(cellId)) {
    expandedCells.delete(cellId);
    return;
  }
  if (expandedCells.size > 300) expandedCells.clear();
  expandedCells.add(cellId);
}

/**
 * Keys = the key space on the left, the selected value on the right. The left
 * column is the filtered packet list; the right column is the detail tree of
 * one key, with its metadata as fields rather than as floating badges.
 */
export function browserView(s: ViewState): string {
  const conn = currentConnection();
  if (!conn) return emptyState("还没有连接", "先保存一个连接，才能浏览键空间。", { label: "新建连接", action: "new-connection" });

  const readOnly = Boolean(conn.readOnly);
  const counts = new Map<string, number>();
  for (const key of s.keys) counts.set(key.type, (counts.get(key.type) ?? 0) + 1);

  const chips = TYPES.map(
    (t) => `<button class="chip ${s.keyType === t ? "active" : ""}" data-key-type="${t}" aria-pressed="${s.keyType === t}">${t === "all" ? "全部" : typeLabel(t)}<span class="chip-count">${t === "all" ? s.keys.length : counts.get(t) ?? 0}</span></button>`,
  ).join("");

  return `<div class="filterbar">
    <div class="search-field mono wide">${icon("search", 12)}<input id="key-filter" value="${esc(s.keyQuery)}" placeholder="筛选已扫到的键名" spellcheck="false" aria-label="筛选键名" /></div>
    <div class="search-field mono narrow">${icon("filter", 12)}<input id="key-pattern" value="${esc(s.keyPattern)}" placeholder="SCAN MATCH，如 user:*" spellcheck="false" aria-label="SCAN 匹配模式" /></div>
    <button class="btn sm" data-action="scan-reset">${icon("refresh", 11)} SCAN</button>
    ${!readOnly ? `<button class="btn sm" data-action="new-key">${icon("plus", 11)} 新建键</button>` : ""}
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
    <section class="browser-value" aria-label="键值">${valuePanel(s, readOnly)}</section>
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

function valuePanel(s: ViewState, readOnly: boolean): string {
  if (s.valueLoading && !s.value) {
    ttlEditingKeyId = null;
    closeStringEditor();
    return `<div class="value-loading"><span class="spinner"></span> 读取值…</div>`;
  }
  if (s.valueError) {
    ttlEditingKeyId = null;
    closeStringEditor();
    return `<div class="pad-inline"><div class="notice err">${icon("xCircle", 14)}<div class="notice-body"><b>读取失败</b><span>${esc(s.valueError)}</span></div></div></div>`;
  }
  const v = s.value;
  if (!v) {
    ttlEditingKeyId = null;
    closeStringEditor();
    return `<div class="value-empty">${icon("key", 20)}<div>从左侧选择一个键查看内容</div></div>`;
  }

  const keyId = currentBrowserKeyId(s);
  if (readOnly || (ttlEditingKeyId && ttlEditingKeyId !== keyId)) ttlEditingKeyId = null;
  if (readOnly || v.type !== "string" || v.truncated || (stringEditingKeyId && stringEditingKeyId !== keyId)) closeStringEditor();

  const editingTtl = !readOnly && isTtlEditing(keyId);
  const editingString = v.type === "string" && !readOnly && !v.truncated && isStringEditing(keyId);
  const t = ttl(v.ttlMs);

  const ttlMeta = editingTtl
    ? `<form class="ttl-inline-form" id="ttl-form" data-key="${esc(v.key)}">
        <span>ttl</span>
        <input class="input sm mono" id="ttl-input" name="ttl" type="number" min="-1" step="1" value="${v.ttlMs > 0 ? Math.max(1, Math.ceil(v.ttlMs / 1000)) : -1}" placeholder="秒 (-1 持久)" aria-label="TTL 秒数" />
        <button class="btn sm primary" type="submit">保存</button>
        ${v.ttlMs > 0 ? `<button class="btn sm ghost" type="button" data-action="persist-ttl" title="移除过期时间 (PERSIST)">持久</button>` : ""}
        <button class="btn sm ghost" type="button" data-action="cancel-ttl">取消</button>
      </form>`
    : readOnly
      ? `<span>ttl <b>${esc(t.short)}</b></span>`
      : `<span>ttl <b>${esc(t.short)}</b> <button type="button" class="icon-btn" data-action="edit-ttl" title="修改过期时间 (TTL)" aria-label="修改过期时间" style="width:18px;height:18px;vertical-align:middle">${icon("edit", 11)}</button></span>`;

  const head = `<div class="value-head">
    <div class="value-title">${pill(v.type, typeLabel(v.type))}<span class="key-name" title="${esc(v.key)}">${esc(v.key)}</span></div>
    <div class="value-meta">
      ${ttlMeta}
      <span>size <b>${bytes(v.sizeBytes)}</b></span>
      <span>encoding <b>${esc(v.encoding || "—")}</b></span>
    </div>
    <div class="value-actions">
      ${iconBtn("copy", "copy-key", "复制键名")}
      ${iconBtn("file", "copy-value", "复制键值")}
      ${iconBtn("refresh", "reload-value", "重新读取")}
      ${
        readOnly
          ? `<button class="icon-btn danger" data-action="delete-key" disabled title="只读连接不可删除键" aria-label="只读连接不可删除键">${icon("trash", 13)}</button>`
          : iconBtn("trash", "delete-key", "删除键", "danger")
      }
    </div>
  </div>`;

  const stringTools = v.type === "string" ? valueTools(s, readOnly, editingString) : "";
  return `${head}${stringTools}<div class="value-body ${v.type === "string" ? "value-body-string" : "scroll"}">${valueBody(v, s.valueMode, readOnly, keyId, editingString)}</div>${valueFoot(v, readOnly)}`;
}

function maybeJson(raw: string, maxBytes: number): ReturnType<typeof safeJson> {
  if (raw.length > Math.min(maxBytes, JSON_PARSE_LIMIT)) return { ok: false, error: "too large" };
  return safeJson(raw);
}

function valueTools(s: ViewState, readOnly: boolean, editingString: boolean): string {
  const v = s.value!;
  const raw = String(v.stringValue ?? "");
  const maxBytes = settings.get("maxValueBytes");
  const json = maybeJson(raw, maxBytes);
  const items: { id: ValueViewMode; label: string }[] = (
    [
      { id: "raw", label: "原始" },
      { id: "json", label: "JSON" },
      { id: "hex", label: "Hex" },
      { id: "html", label: "HTML 预览" },
      { id: "markdown", label: "MD 预览" },
    ] as { id: ValueViewMode; label: string }[]
  ).filter((i) => i.id !== "json" || json.ok);
  const active = s.valueMode === "json" && !json.ok ? "raw" : s.valueMode;
  const editBtn =
    !readOnly && !v.truncated
      ? `<span class="spacer"></span><button type="button" class="btn sm ${editingString ? "primary" : ""}" data-action="toggle-string-edit" aria-pressed="${editingString}">${icon("edit", 11)} ${editingString ? "退出编辑" : "编辑"}</button>`
      : "";
  return `<div class="value-tools"><span class="mlabel">格式</span>${segmented(items, active, "view-mode")}${editBtn}</div>`;
}

function valueBody(v: RedisValue, viewMode: ValueViewMode, readOnly: boolean, keyId: string, editingString: boolean): string {
  const maxBytes = settings.get("maxValueBytes");
  switch (v.type) {
    case "string":
      return stringBody(v, maxBytes, viewMode, editingString);
    case "hash": {
      const entries = Object.entries(v.hash ?? {});
      const total = v.totalCount || entries.length;
      const rows = entries
        .map(([field, value]) => {
          const cellId = `${keyId}:hash:${field}`;
          const expanded = expandedCells.has(cellId);
          const over = value.length > HASH_CELL_CLIP;
          const display = over && !expanded ? `${esc(clip(value, HASH_CELL_CLIP).text)} …` : esc(value);
          return `<tr>
            <td class="key-cell">${esc(field)}</td>
            <td class="key-cell ${expanded ? "cell-expanded" : ""}">${display}${over ? ` <button type="button" class="btn sm ghost" data-expand-cell="${esc(cellId)}">${expanded ? "收起" : `展开 (${bytes(value.length)})`}</button>` : ""}</td>
            <td class="num-cell" style="width:72px">
              <span class="cell-actions">
                <button type="button" class="icon-btn" data-action="copy" data-copy="${esc(value)}" title="复制字段值" aria-label="复制字段值">${icon("copy", 12)}</button>
                ${!readOnly ? `<button type="button" class="icon-btn danger" data-action="delete-hash-field" data-field="${esc(field)}" title="删除字段" aria-label="删除字段">${icon("trash", 12)}</button>` : ""}
              </span>
            </td>
          </tr>`;
        })
        .join("");
      const formHtml = !readOnly
        ? `<form class="hash-add" id="hash-form" data-key="${esc(v.key)}">
          <input class="input mono" name="field" placeholder="field" autocomplete="off" required aria-label="字段名" />
          <input class="input mono grow" name="value" placeholder="value" autocomplete="off" aria-label="字段值" />
          <button class="btn primary" type="submit">${icon("plus", 12)} 写入字段</button>
        </form>`
        : "";
      return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:30%">field<span class="mlabel" style="margin-left:6px">${num(total)}</span></th><th>value</th><th style="width:72px"></th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="3">空 Hash</td></tr>`}</tbody></table>${collectionTruncationNotice(v, entries.length)}</div>${formHtml}`;
    }
    case "list": {
      const items = v.list ?? [];
      const rows = items
        .map((item, i) => {
          const cellId = `${keyId}:list:${i}`;
          const expanded = expandedCells.has(cellId);
          const over = item.length > LIST_CELL_CLIP;
          const display = over && !expanded ? `${esc(clip(item, LIST_CELL_CLIP).text)} …` : esc(item);
          return `<tr>
            <td class="num-cell faint" style="width:64px">${i}</td>
            <td class="key-cell ${expanded ? "cell-expanded" : ""}">${display}${over ? ` <button type="button" class="btn sm ghost" data-expand-cell="${esc(cellId)}">${expanded ? "收起" : `展开 (${bytes(item.length)})`}</button>` : ""}</td>
            <td class="num-cell" style="width:44px"><span class="cell-actions"><button type="button" class="icon-btn" data-action="copy" data-copy="${esc(item)}" title="复制元素" aria-label="复制元素">${icon("copy", 12)}</button></span></td>
          </tr>`;
        })
        .join("");
      return `<table class="tbl"><thead><tr><th>index</th><th>value</th><th style="width:44px"></th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="3">空 List</td></tr>`}</tbody></table>${collectionTruncationNotice(v, items.length)}`;
    }
    case "set": {
      const members = v.set ?? [];
      const rows = members.map((m) => `<tr><td class="key-cell">${esc(m)}</td></tr>`).join("");
      return `<table class="tbl"><thead><tr><th>member</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td>空 Set</td></tr>`}</tbody></table>${collectionTruncationNotice(v, members.length)}`;
    }
    case "zset": {
      const entries = v.zset ?? [];
      const rows = entries.map((e, i) => `<tr><td class="num-cell faint" style="width:56px">${i + 1}</td><td class="key-cell">${esc(e.member)}</td><td class="num-cell">${e.score}</td></tr>`).join("");
      return `<table class="tbl"><thead><tr><th>#</th><th>member</th><th style="text-align:right">score</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="3">空 ZSet</td></tr>`}</tbody></table>${collectionTruncationNotice(v, entries.length)}`;
    }
    case "stream": {
      const entries = v.stream ?? [];
      const rows = entries
        .map((entry) => `<tr><td class="key-cell faint" style="width:180px">${esc(entry.id)}</td><td><pre class="mono pre-inline">${esc(JSON.stringify(entry.values, null, 2))}</pre></td></tr>`)
        .join("");
      return `<table class="tbl"><thead><tr><th>id</th><th>fields</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="2">空 Stream</td></tr>`}</tbody></table>${collectionTruncationNotice(v, entries.length)}`;
    }
    default:
      return `<div class="value-empty">不支持的类型：${esc(v.type)}</div>`;
  }
}

function collectionTruncationNotice(v: RedisValue, loadedCount: number): string {
  if (!v.truncated) return "";
  const cmd = v.type === "hash" ? "HSCAN" : v.type === "list" ? "LRANGE" : v.type === "zset" ? "ZSCAN / ZRANGE" : v.type === "stream" ? "XRANGE" : "SSCAN";
  const totalText = v.totalCount ? `共 ${num(v.totalCount)} 项` : "元素较多";
  return `<div class="pad-inline pad-bottom" style="margin-top:8px"><div class="notice info">${icon("info", 13)}<div class="notice-body"><b>已安全分批加载前 ${num(loadedCount)} 项（${totalText}）</b><span>为避免大键阻塞 Redis 主线程，已通过 ${cmd} 限制单次载入条数；如需检索特定成员可使用命令行。</span></div></div></div>`;
}

function stringBody(v: RedisValue, maxBytes: number, viewMode: ValueViewMode, editingString: boolean): string {
  if (editingString) {
    const draftByteLen = new TextEncoder().encode(stringDraftValue).length;
    return `<form id="string-form" data-key="${esc(v.key)}" style="display:flex;flex-direction:column;flex:1;min-height:0">
      <textarea class="string-editor mono" id="string-editor-input" name="value" spellcheck="false" aria-label="编辑字符串内容">${esc(stringDraftValue)}</textarea>
      <div class="string-edit-bar">
        <span class="faint mono">${bytes(draftByteLen)} · 保存时保留原有 TTL</span>
        <span class="spacer"></span>
        <button class="btn sm ghost" type="button" data-action="cancel-string-edit">取消</button>
        <button class="btn sm primary" type="submit">${icon("check", 12)} 保存修改</button>
      </div>
    </form>`;
  }

  const raw = String(v.stringValue ?? "");
  const limit = maxBytes;
  const json = maybeJson(raw, maxBytes);
  const activeMode = viewMode === "json" && !json.ok ? "raw" : viewMode;
  const previewMode = activeMode === "html" || activeMode === "markdown";
  const shown = activeMode === "json" && json.ok ? clip(json.pretty, limit) : clip(previewMode ? decodeJsonString(raw).text : raw, limit);

  let body: string;
  switch (activeMode) {
    case "html":
      body = `<iframe class="html-preview" data-view="html" title="HTML 预览" sandbox="" referrerpolicy="no-referrer" srcdoc="${esc(htmlPreviewDocument(shown.text))}"></iframe>`;
      break;
    case "markdown":
      body = `<article class="markdown-preview" data-view="markdown">${markdownToHtml(shown.text)}</article>`;
      break;
    case "json":
      body = `<pre class="code-box mono" data-view="json">${esc(shown.text)}</pre>`;
      break;
    case "hex":
      body = `<pre class="code-box mono" data-view="hex">${esc(hexDump(shown.text, v.totalCount || v.sizeBytes))}</pre>`;
      break;
    default:
      body = `<pre class="code-box mono" data-view="raw">${esc(shown.text)}</pre>`;
  }

  const totalSize = v.totalCount || v.sizeBytes;
  const notice = shown.truncated
    ? `<div class="pad-inline pad-bottom"><div class="notice warn">${icon("alert", 13)}<div class="notice-body"><b>只渲染了前 ${bytes(shown.text.length)}</b><span>该值共 ${bytes(totalSize)}${v.truncated ? "（已触发服务端 4 MiB 大键读取保护）" : "，可在设置中调整单次载入上限"}。</span></div></div></div>`
    : v.truncated
      ? `<div class="pad-inline pad-bottom"><div class="notice warn">${icon("alert", 13)}<div class="notice-body"><b>服务端大键保护已截断读取</b><span>已读取前 ${bytes(raw.length)}（总大小 ${bytes(totalSize)}），为避免截断数据覆盖原值已禁用在线编辑。</span></div></div></div>`
      : "";
  return body + notice;
}

function hexDump(text: string, totalSizeBytes: number): string {
  const sampleBytes = new TextEncoder().encode(text.slice(0, 4100));
  const capped = text.length > 4096 || sampleBytes.length > 4096;
  const bytesArr = sampleBytes.slice(0, 4096);
  const lines: string[] = [];
  for (let i = 0; i < bytesArr.length; i += 16) {
    const chunk = Array.from(bytesArr.slice(i, i + 16));
    const hex = chunk.map((b) => b.toString(16).padStart(2, "0")).join(" ").padEnd(47, " ");
    const ascii = chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${i.toString(16).padStart(8, "0")}  ${hex}  ${ascii}`);
  }
  if (capped) {
    lines.push(`… 仅展示前 4,096 字节（共 ${bytes(totalSizeBytes)}）`);
  }
  return lines.join("\n");
}

function valueFoot(v: RedisValue, readOnly: boolean): string {
  const formatCount = (loaded: number, unit: string) =>
    v.truncated && v.totalCount ? `${num(loaded)} / ${num(v.totalCount)} ${unit}` : `${num(v.totalCount || loaded)} ${unit}`;
  const countText =
    v.type === "hash"
      ? formatCount(Object.keys(v.hash ?? {}).length, "fields")
      : v.type === "list"
        ? formatCount((v.list ?? []).length, "items")
        : v.type === "set"
          ? formatCount((v.set ?? []).length, "members")
          : v.type === "zset"
            ? formatCount((v.zset ?? []).length, "members")
            : v.type === "stream"
              ? formatCount((v.stream ?? []).length, "entries")
              : `${bytes(v.totalCount || v.sizeBytes)}`;
  const modeHint = readOnly
    ? "只读连接 · 已禁止写入与删除"
    : v.type === "hash"
      ? "写入或删除字段会立即生效"
      : v.type === "string"
        ? v.truncated
          ? "超大键值已启用只读保护"
          : "可点击编辑直接修改字符串内容"
        : "该类型当前可在命令行写入";
  return `<div class="value-foot"><span>${esc(countText)}</span><span>·</span><span>${esc(ttl(v.ttlMs).label)}</span><span>·</span><span>${esc(v.encoding || "—")}</span><span class="spacer"></span><span>${esc(modeHint)}</span></div>`;
}

/* ------------------------------------------------------------------ */
/* New Key Dialog                                                      */
/* ------------------------------------------------------------------ */

export function newKeyDialog(draft: NewKeyDraft | null): string {
  const conn = currentConnection();
  if (!draft || !conn || conn.readOnly) return "";
  return `<div class="dialog-scrim" data-action="new-key-close">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="新建键" data-stop>
      <div class="dialog-head">
        <span class="dialog-title">新建键 · db${currentDb(conn)}</span>
        <div class="row"><button class="icon-btn" data-action="new-key-close" type="button" aria-label="关闭">${icon("x", 14)}</button></div>
      </div>
      <form class="dialog-body" id="new-key-form" data-stop>
        <div class="field-grid">
          <div class="field full">
            <label for="nk-key">键名</label>
            <input class="input mono" id="nk-key" name="key" data-nk-field="key" value="${esc(draft.key)}" placeholder="如 user:1024 或 cache:config" autocomplete="off" required />
          </div>
          <div class="field">
            <label for="nk-type">类型</label>
            <select class="select" id="nk-type" name="type" data-nk-field="type">
              <option value="string" ${draft.type === "string" ? "selected" : ""}>String</option>
              <option value="hash" ${draft.type === "hash" ? "selected" : ""}>Hash</option>
            </select>
          </div>
          <div class="field">
            <label for="nk-ttl">过期时间 TTL（秒，可选）</label>
            <input class="input mono" id="nk-ttl" name="ttl" data-nk-field="ttl" type="number" min="-1" step="1" value="${esc(draft.ttl)}" placeholder="留空表示持久" autocomplete="off" />
          </div>
          ${
            draft.type === "hash"
              ? `<div class="field full">
            <label for="nk-field">初始字段名 (field)</label>
            <input class="input mono" id="nk-field" name="field" data-nk-field="field" value="${esc(draft.field)}" placeholder="如 id 或 name" autocomplete="off" required />
          </div>`
              : ""
          }
          <div class="field full">
            <label for="nk-value">${draft.type === "hash" ? "初始字段值 (value)" : "键值 (value)"}</label>
            <textarea class="string-editor mono" id="nk-value" name="value" data-nk-field="value" rows="5" placeholder="${draft.type === "hash" ? "字段内容" : "字符串或 JSON 内容"}" spellcheck="false" style="min-height:110px">${esc(draft.value)}</textarea>
          </div>
        </div>
      </form>
      <div class="dialog-foot">
        <span style="flex:1"></span>
        <button class="btn ghost" data-action="new-key-close" type="button">取消</button>
        <button class="btn primary" data-action="save-new-key" type="button">${icon("check", 12)} 创建键</button>
      </div>
    </div>
  </div>`;
}
