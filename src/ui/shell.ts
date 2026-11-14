import { icon } from "../core/icons";
import { connAddress, esc, modeLabel, num } from "../core/format";
import { availableDatabases, currentConnection, currentDb, currentHistory, type ConnectionView, type PageId, type ViewState } from "../core/store";
import { settings } from "../theme/settings";

/**
 * Navigation model: instances are the primary navigation. A page is a view
 * *inside* the selected instance, so the shell has exactly one navigational
 * axis — the sidebar — and the tab row only ever switches between views of
 * the same instance. Connection management and preferences live in the
 * sidebar footer, where they are global rather than per-instance.
 */
export const NAV: { id: PageId; label: string; en: string; icon: string; hint: string }[] = [
  { id: "overview", label: "总览", en: "overview", icon: "activity", hint: "吞吐 · 内存 · 告警" },
  { id: "browser", label: "键", en: "keys", icon: "listTree", hint: "SCAN 键空间" },
  { id: "cli", label: "命令行", en: "cli", icon: "terminal", hint: "执行 Redis 命令" },
  { id: "monitor", label: "监控", en: "monitor", icon: "gauge", hint: "慢查询 · 客户端 · 复制" },
];

export const VIEW_IDS = NAV.map((n) => n.id);

/* ------------------------------------------------------------------ */
/* Top bar                                                             */
/* ------------------------------------------------------------------ */

export function topbar(s: ViewState): string {
  // The window keeps its native title bar, which already shows the traffic
  // lights, so the in-page top bar starts with the brand.
  return `<header class="topbar">
    <div class="brand"><span class="brand-logo"></span><span class="brand-name">Redis Manager</span><span class="brand-version" data-app-version>${esc(s.appInfo?.version || (s.appInfo?.isDev ? "dev" : "—"))}</span></div>
    <button class="topbar-search" data-action="palette" aria-label="打开命令面板">
      ${icon("search", 13)}
      <input readonly placeholder="搜索连接、键或执行命令…" tabindex="-1" aria-hidden="true" />
      <span class="kbd">⌘K</span>
    </button>
    <div class="topbar-actions">
      <button class="btn ghost icon" data-action="toggle-scheme" title="切换深浅色" aria-label="切换深浅色">${icon(settings.get("scheme") === "dark" ? "sun" : "moon", 15)}</button>
      <button class="btn ghost icon" data-action="refresh" title="刷新连接与指标" aria-label="刷新">${icon("refresh", 15)}</button>
      <span class="topbar-divider"></span>
      <button class="btn primary" data-action="new-connection">${icon("plus", 13)}<span class="nowrap">新建连接</span></button>
    </div>
  </header>`;
}

/* ------------------------------------------------------------------ */
/* Sidebar — the instance list                                         */
/* ------------------------------------------------------------------ */

export function sidebar(s: ViewState): string {
  const groups: { name: string; items: ConnectionView[] }[] = [];
  for (const conn of s.connections) {
    const name = conn.group || "未分组";
    const g = groups.find((x) => x.name === name);
    if (g) g.items.push(conn);
    else groups.push({ name, items: [conn] });
  }

  const body = groups.length
    ? groups
        .map(
          (g) => `<div class="group-label">${esc(g.name)}<span class="spacer"></span><span class="num">${g.items.length}</span></div>${g.items.map((c) => connRow(c, s.connId === c.id)).join("")}`,
        )
        .join("")
    : `<div class="sidebar-empty">还没有保存的连接<div style="margin-top:10px"><button class="btn sm" data-action="new-connection">新建连接</button></div></div>`;

  return `<aside class="sidebar" aria-label="实例列表">
    <div class="sidebar-head">
      <span class="sidebar-title">实例 · ${s.connections.length}</span>
      <div class="row">
        <button class="icon-btn" data-action="refresh" title="刷新连接" aria-label="刷新连接">${icon("refresh", 12)}</button>
        <button class="icon-btn" data-action="new-connection" title="新建连接" aria-label="新建连接">${icon("plus", 13)}</button>
      </div>
    </div>
    <div class="conn-list scroll">${body}</div>
    <div class="sidebar-foot">
      <button class="side-foot-btn ${s.page === "connections" ? "active" : ""}" data-nav="connections">${icon("server", 14)}<span>连接管理</span></button>
      <button class="side-foot-btn ${s.page === "settings" ? "active" : ""}" data-nav="settings">${icon("settings", 14)}<span>设置</span><span class="kbd">⌘,</span></button>
    </div>
  </aside>`;
}

function connRow(conn: ConnectionView, active: boolean): string {
  const db = active ? currentDb(conn) : conn.db;
  const state = conn.status === "on" ? "已连接" : conn.status === "warn" ? "连接不稳定" : "未连接";
  // Status is the dot's job (ok / warn / off only). The user's per-connection
  // colour is a separate identity mark, so a pinned orange never reads as an
  // error state and the selected row keeps its identity.
  return `<button class="conn ${active ? "selected" : ""}" data-conn="${esc(conn.id)}" aria-current="${active}" title="${esc(`${conn.name} · ${connAddress(conn)}/db${db} · ${state}`)}">
    <span class="status-dot ${conn.status}" title="${esc(state)}" aria-label="${esc(state)}"></span>
    <span class="conn-main">
      <span class="conn-name">${esc(conn.name || connAddress(conn))}${conn.readOnly ? `<span class="faint" title="只读连接">${icon("lock", 10)}</span>` : ""}</span>
      <span class="conn-sub">${esc(connAddress(conn))}<span class="faint">/db${db}</span></span>
    </span>
    <span class="conn-side">
      ${connColor(conn) ? `<span class="conn-color pinned" style="background:${connColor(conn)}" title="连接标识色" aria-hidden="true"></span>` : ""}
      <span class="conn-ver">${esc(conn.version && conn.version !== "—" ? conn.version : "")}</span>
    </span>
  </button>`;
}

/** A connection's identity colour, or "" when the record has none. */
function connColor(conn: ConnectionView): string {
  return conn.color && /^#[0-9a-f]{3,8}$/i.test(conn.color) ? conn.color : "";
}

/* ------------------------------------------------------------------ */
/* Instance header                                                     */
/* ------------------------------------------------------------------ */

/** Identity strip for the selected instance: who, where, which db, is it live. */
export function instanceHead(s: ViewState): string {
  const conn = currentConnection();
  if (!conn || s.page === "connections" || s.page === "settings") return "";
  const db = currentDb(conn);
  const keyspaces = new Map((s.overview[conn.id]?.keyspaces ?? []).map((item) => [item.db, item.keys]));
  const databaseOptions = availableDatabases(conn)
    .map((item) => `<option value="${item}" ${item === db ? "selected" : ""}>db${item}${keyspaces.has(item) ? ` · ${num(keyspaces.get(item) ?? 0)}` : ""}</option>`)
    .join("");
  const hist = currentHistory();
  const last = hist[hist.length - 1];
  const live = conn.status === "on";
  return `<div class="inst-head" aria-label="当前实例">
    <span class="inst-tick" style="background:${connColor(conn) || "var(--accent)"}"></span>
    <span class="inst-name">${esc(conn.name || connAddress(conn))}</span>
    <span class="sep-v"></span>
    <span class="inst-addr">${esc(connAddress(conn))}</span>
    <span class="sep-v"></span>
    <span class="inst-meta">redis ${esc(conn.version && conn.version !== "—" ? conn.version : "—")} · ${esc(modeLabel(conn.mode))}${conn.readOnly ? " · 只读" : ""}</span>
    <span class="sep-v"></span>
    <label class="db-pick" title="当前数据库">${icon("layers", 11)}<select data-db-select aria-label="选择数据库">${databaseOptions}</select></label>
    <span class="inst-live ${live ? "" : "off"}"><i></i>${live ? "实时" : conn.status === "warn" ? "不稳定" : "未连接"}${last ? `<span>· ${latencyStamp(last.at)}</span>` : ""}</span>
  </div>`;
}

function latencyStamp(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Views of the selected instance                                      */
/* ------------------------------------------------------------------ */

export function tabs(s: ViewState): string {
  const conn = currentConnection();
  const badge = (id: PageId) => {
    if (!conn) return "";
    if (id === "browser" && s.keys.length) return `<span class="tab-count">${num(s.keys.length)}</span>`;
    return "";
  };
  const inInstance = s.page !== "connections" && s.page !== "settings";
  return `<nav class="tabs" aria-label="实例视图">
    ${NAV.map(
      (n) =>
        `<button class="tab ${inInstance && s.page === n.id ? "active" : ""}" data-nav="${n.id}" ${!conn ? "disabled" : ""} title="${esc(n.hint)}">${esc(n.label)}${badge(n.id)}${n.id === "monitor" && conn?.status === "on" ? `<span class="tab-live"><i></i>LIVE</span>` : ""}</button>`,
    ).join("")}
    <div class="tabs-actions">
      ${inInstance && conn ? `<span class="inst-meta">${esc(modeLabel(conn.mode))}${conn.status === "on" ? "" : " · 离线"}</span>` : ""}
    </div>
  </nav>`;
}

/* ------------------------------------------------------------------ */
/* Status bar — facts only, no decoration                              */
/* ------------------------------------------------------------------ */

export function statusbar(s: ViewState): string {
  const conn = currentConnection();
  const hist = currentHistory();
  const last = hist[hist.length - 1];
  const ver = conn?.version && conn.version !== "—" ? conn.version : "—";
  const state = !conn ? "未连接" : conn.status === "on" ? "已连接" : conn.status === "warn" ? "不稳定" : "已断开";
  return `<footer class="statusbar">
    <span class="sb-item ${conn?.status === "on" ? "ok" : ""}"><i class="status-dot ${conn?.status ?? "idle"}"></i>${esc(state)}</span>
    <span class="sb-sep"></span>
    <span class="sb-item">redis <b>${esc(ver)}</b></span>
    <span class="sb-sep"></span>
    <span class="sb-item">ping <b>${last ? `${last.latency.toFixed(1)} ms` : "—"}</b></span>
    ${conn ? `<span class="sb-sep"></span><span class="sb-item">db <b>${currentDb(conn)}</b></span>` : ""}
    <span class="sb-sep"></span>
    <span class="sb-item">ops <b>${num(last?.ops ?? 0)}</b></span>
    <span class="sb-sep"></span>
    <span class="sb-item">clients <b>${num(last?.clients ?? 0)}</b></span>
    <span class="sb-spacer"></span>
    <span class="sb-item">${esc(modeLabel(conn?.mode))}</span>
    <span class="sb-sep"></span>
    <span class="sb-item sb-live ${conn?.status === "on" ? "" : "off"}"><i></i>${conn?.status === "on" ? "每 4 秒采样" : "采样暂停"}</span>
  </footer>`;
}

/* ------------------------------------------------------------------ */
/* Command palette                                                     */
/* ------------------------------------------------------------------ */

export function palette(s: ViewState, query = "", activeAction = ""): string {
  if (!s.paletteOpen) return "";
  return `<div class="scrim" data-action="palette-close">
    <div class="palette" role="dialog" aria-modal="true" aria-label="命令面板" data-stop>
      <div class="palette-input">${icon("search", 15)}<input id="palette-input" value="${esc(query)}" placeholder="搜索连接、键、视图，或直接输入要执行的命令…" autocomplete="off" spellcheck="false" /><span class="kbd">esc</span></div>
      <div class="palette-list" id="palette-list">${paletteList(s, query, activeAction)}</div>
    </div>
  </div>`;
}

export function paletteList(s: ViewState, query: string, activeAction = ""): string {
  const q = query.trim().toLowerCase();
  const conn = currentConnection();
  const groups: { title: string; items: { label: string; hint: string; action: string; iconName: string }[] }[] = [];

  groups.push({
    title: "视图",
    items: NAV.map((n) => ({ label: n.label, hint: n.hint, action: `nav:${n.id}`, iconName: n.icon })),
  });
  if (s.connections.length) {
    groups.push({
      title: "连接",
      items: s.connections.map((c) => ({ label: c.name || connAddress(c), hint: `${connAddress(c)}/db${c.db}`, action: `conn:${c.id}`, iconName: "server" })),
    });
  }
  if (conn && s.keys.length) {
    groups.push({
      title: `键 · ${conn.name}`,
      items: s.keys.slice(0, 40).map((k) => ({ label: k.key, hint: k.type, action: `key:${k.key}`, iconName: "key" })),
    });
  }
  if (q) {
    groups.unshift({
      title: "执行命令",
      items: [{ label: `在命令行执行 ${query.trim()}`, hint: "enter", action: `cmd:${query.trim()}`, iconName: "terminal" }],
    });
  }

  const html = groups
    .map((g) => {
      const items = g.items.filter((i) => !q || `${i.label} ${i.hint}`.toLowerCase().includes(q)).slice(0, q ? 6 : 8);
      if (!items.length) return "";
      return `<div class="palette-group">${esc(g.title)}</div>${items
        .map((i) => `<button class="palette-item ${i.action === activeAction ? "active" : ""}" data-palette-action="${esc(i.action)}">${icon(i.iconName, 13)}<span class="ellipsis">${esc(i.label)}</span><span class="p-hint">${esc(i.hint)}</span></button>`)
        .join("")}`;
    })
    .join("");
  return html || `<div class="palette-empty">没有匹配的结果</div>`;
}

/* ------------------------------------------------------------------ */
/* Toasts / confirm                                                    */
/* ------------------------------------------------------------------ */

export function toasts(s: ViewState): string {
  if (!s.toasts.length) return "";
  return `<div class="toasts" aria-live="polite">${s.toasts
    .map(
      (t) => `<div class="toast ${t.kind}"><span class="toast-icon">${icon(t.kind === "ok" ? "checkCircle" : t.kind === "err" ? "xCircle" : "info", 14)}</span>
        <div><div class="toast-title">${esc(t.title)}</div>${t.detail ? `<div class="toast-detail">${esc(t.detail)}</div>` : ""}</div></div>`,
    )
    .join("")}</div>`;
}

export function confirmModal(s: ViewState): string {
  const c = s.confirm;
  if (!c) return "";
  return `<div class="dialog-scrim" data-action="confirm-cancel">
    <div class="dialog" role="alertdialog" aria-modal="true" aria-label="${esc(c.title)}" data-stop>
      <div class="dialog-head"><span class="dialog-title">${esc(c.title)}</span><div class="row"><button class="icon-btn" data-action="confirm-cancel" aria-label="关闭">${icon("x", 14)}</button></div></div>
      <div class="dialog-body"><p class="dim" style="line-height:1.6">${esc(c.body)}</p></div>
      <div class="dialog-foot"><span class="spacer"></span><button class="btn" data-action="confirm-cancel">取消</button><button class="btn ${c.danger ? "danger" : "primary"}" data-action="confirm-ok">${esc(c.confirmLabel)}</button></div>
    </div>
  </div>`;
}
