import { icon } from "../core/icons";
import { connAddress, esc, modeLabel, num } from "../core/format";
import { availableDatabases, currentConnection, currentDb, currentHistory, type ConnectionView, type PageId, type ViewState } from "../core/store";
import { settings } from "../theme/settings";
import { themeMeta } from "../theme/themes";

export const NAV: { id: PageId; label: string; icon: string; hint: string }[] = [
  { id: "overview", label: "总览", icon: "gauge", hint: "QPS · 内存 · 告警" },
  { id: "browser", label: "键浏览", icon: "listTree", hint: "SCAN 键空间" },
  { id: "cli", label: "CLI", icon: "terminal", hint: "命令控制台" },
  { id: "monitor", label: "监控", icon: "activity", hint: "实时指标 · 慢日志" },
  { id: "connections", label: "连接", icon: "plug", hint: "连接管理" },
  { id: "settings", label: "设置", icon: "settings", hint: "主题与偏好" },
];

export function themeLabel(): string {
  const meta = themeMeta(settings.get("theme"));
  return `${meta.name} · ${settings.get("scheme") === "dark" ? "深色" : "浅色"}`;
}

/* ------------------------------------------------------------------ */
/* Top bar                                                             */
/* ------------------------------------------------------------------ */

export function topbar(s: ViewState): string {
  // The window keeps its native title bar, which already shows the traffic
  // lights, so the in-page top bar starts with the brand.
  return `<header class="topbar">
    <div class="brand"><span class="brand-logo">R</span><span class="brand-name">Redis Manager</span><span class="brand-version">0.1.0</span></div>
    <button class="topbar-search" data-action="palette">
      ${icon("search", 14)}
      <input readonly placeholder="搜索连接、键或执行命令…" tabindex="-1" />
      <span class="kbd">⌘K</span>
    </button>
    <div class="topbar-actions">
      ${themeButton()}
      ${schemeButton()}
      <button class="btn ghost icon" data-action="toggle-sidebar" title="收起侧栏" aria-label="收起侧栏">${icon("layout", 15)}</button>
      <button class="btn ghost icon" data-action="go-cli" title="打开 CLI（⌘T）" aria-label="打开 CLI">${icon("terminal", 15)}</button>
      <button class="btn primary" data-action="new-connection">${icon("plus", 14)} <span class="nowrap">新建连接</span></button>
    </div>
  </header>`;
}

function themeButton(): string {
  const current = themeMeta(settings.get("theme"));
  return `<button class="btn ghost icon" data-action="theme-menu" title="切换主题（${esc(current.name)}）" aria-label="切换主题">
    ${icon("layers", 15)}
  </button>`;
}

function schemeButton(): string {
  const meta = themeMeta(settings.get("theme"));
  if (!meta.schemes) {
    return `<button class="btn ghost icon" data-action="noop" title="${esc(meta.name)} 是单配色主题" aria-label="该主题不支持深浅色切换" disabled>${icon("moon", 15)}</button>`;
  }
  const scheme = settings.get("scheme");
  return `<button class="btn ghost icon" data-action="toggle-scheme" title="切换深浅色" aria-label="切换深浅色">${icon(scheme === "dark" ? "sun" : "moon", 15)}</button>`;
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
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
          (g) => `<div class="group-label">${esc(g.name)}<span class="spacer"></span><span class="faint num">${g.items.length}</span></div>${g.items
            .map((c) => connRow(c, s.connId === c.id))
            .join("")}`,
        )
        .join("")
    : `<div class="sidebar-empty">${icon("database", 18)}<div style="margin-top:8px">还没有保存的连接</div><button class="btn sm" data-action="new-connection" style="margin-top:10px">新建连接</button></div>`;

  return `<aside class="sidebar" aria-label="连接列表">
    <div class="sidebar-head">
      <span class="sidebar-title">连接</span>
      <div class="row">
        <button class="btn ghost icon sm" data-action="refresh" title="刷新连接" aria-label="刷新连接">${icon("refresh", 13)}</button>
        <button class="btn ghost icon sm" data-action="new-connection" title="新建连接" aria-label="新建连接">${icon("plus", 13)}</button>
      </div>
    </div>
    <div class="conn-list scroll">${body}</div>
    <div class="sidebar-foot">
      ${NAV.filter((n) => n.id === "connections" || n.id === "settings")
        .map(
          (n) => `<button class="side-foot-btn ${s.page === n.id ? "active" : ""}" data-nav="${n.id}">${icon(n.icon, 14)} ${n.label}
            <span class="kbd">${n.id === "settings" ? "⌘," : "⌘⇧C"}</span></button>`,
        )
        .join("")}
    </div>
  </aside>`;
}

function connRow(conn: ConnectionView, active: boolean): string {
  const db = active ? currentDb(conn) : conn.db;
  return `<button class="conn ${active ? "selected" : ""}" data-conn="${esc(conn.id)}" title="${esc(`${conn.name} · ${connAddress(conn)}/db${db}`)}">
    <span class="status-dot ${conn.status}"></span>
    <span class="conn-main">
      <span class="conn-name">${esc(conn.name || connAddress(conn))}${conn.readOnly ? `<span class="faint" title="只读">${icon("lock", 10)}</span>` : ""}</span>
      <span class="conn-sub">${esc(connAddress(conn))}<span class="faint">/db${db}</span></span>
    </span>
    <span class="conn-ver">${esc(conn.version || "—")}</span>
  </button>`;
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export function tabs(s: ViewState): string {
  const conn = currentConnection();
  const badge = (id: PageId) => {
    if (!conn) return "";
    if (id === "browser" && s.keys.length) return `<span class="tab-badge">${num(s.keys.length)}</span>`;
    if (id === "monitor") return `<span class="tab-badge">LIVE</span>`;
    return "";
  };
  return `<nav class="tabs" aria-label="页面">
    ${NAV.filter((n) => n.id !== "connections" && n.id !== "settings")
      .map((n) => `<button class="tab ${s.page === n.id ? "active" : ""}" data-nav="${n.id}">${icon(n.icon, 13)}<span>${n.label}</span>${badge(n.id)}</button>`)
      .join("")}
    <button class="tab ${s.page === "connections" ? "active" : ""}" data-nav="connections">${icon("plug", 13)}<span>连接</span></button>
    <button class="tab ${s.page === "settings" ? "active" : ""}" data-nav="settings">${icon("settings", 13)}<span>设置</span></button>
    <span class="tabs-live"><i class="live-dot"></i>${conn && conn.status === "on" ? "实时" : "离线"}</span>
  </nav>`;
}

export function dataContext(s: ViewState): string {
  const conn = currentConnection();
  if (!conn || s.page === "connections" || s.page === "settings") return `<div class="data-context data-context-empty" aria-hidden="true"></div>`;
  const db = currentDb(conn);
  const keyspaces = new Map((s.overview[conn.id]?.keyspaces ?? []).map((item) => [item.db, item.keys]));
  const connectionOptions = s.connections
    .map((item) => `<option value="${esc(item.id)}" ${item.id === conn.id ? "selected" : ""}>${esc(item.name || connAddress(item))} · ${esc(connAddress(item))}</option>`)
    .join("");
  const databaseOptions = availableDatabases(conn)
    .map((item) => `<option value="${item}" ${item === db ? "selected" : ""}>DB ${item}${keyspaces.has(item) ? ` · ${num(keyspaces.get(item) ?? 0)} keys` : ""}</option>`)
    .join("");
  return `<div class="data-context" aria-label="当前数据源">
    <span class="data-context-label">数据源</span>
    <select class="select data-context-connection" data-connection-select aria-label="选择 Redis 连接">${connectionOptions}</select>
    <span class="data-context-address mono">${esc(connAddress(conn))}</span>
    <span class="data-context-divider"></span>
    <label class="data-context-db"><span>数据库</span><select class="select" data-db-select aria-label="选择 Redis 数据库">${databaseOptions}</select></label>
    <span class="data-context-mode">${esc(modeLabel(conn.mode))}</span>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Status bar                                                          */
/* ------------------------------------------------------------------ */

export function statusbar(s: ViewState): string {
  const conn = currentConnection();
  const hist = currentHistory();
  const last = hist[hist.length - 1];
  const ver = conn?.version && conn.version !== "—" ? conn.version : "—";
  const state = !conn ? "未连接" : conn.status === "on" ? "connected" : conn.status === "warn" ? "degraded" : "disconnected";
  return `<footer class="statusbar">
    <span class="sb-item ${conn?.status === "on" ? "ok" : ""}"><i class="status-dot ${conn?.status ?? "off"}"></i> ${esc(state)}</span>
    <span class="sb-sep">│</span>
    <span class="sb-item">${icon("server", 11)} redis <b>${esc(ver)}</b></span>
    <span class="sb-sep">│</span>
    <span class="sb-item"><span class="sb-key">ping</span> <b>${last ? `${last.latency.toFixed(1)} ms` : "—"}</b></span>
    <span class="sb-spacer"></span>
    ${conn ? `<span class="sb-item"><span class="sb-key">db</span> <b>${currentDb(conn)}</b></span><span class="sb-sep">│</span>` : ""}
    <span class="sb-item"><span class="sb-key">ops</span> <b>${num(last?.ops ?? 0)}</b></span>
    <span class="sb-sep">│</span>
    <span class="sb-item"><span class="sb-key">clients</span> <b>${num(last?.clients ?? 0)}</b></span>
    <span class="sb-sep">│</span>
    <span class="sb-item"><span class="sb-key">mode</span> <b>${esc(modeLabel(conn?.mode))}</b></span>
  </footer>`;
}

/* ------------------------------------------------------------------ */
/* Command palette                                                     */
/* ------------------------------------------------------------------ */

export function palette(s: ViewState): string {
  if (!s.paletteOpen) return "";
  const conn = currentConnection();
  return `<div class="scrim" data-action="palette-close">
    <div class="palette" role="dialog" aria-modal="true" aria-label="命令面板" data-stop>
      <div class="palette-input">${icon("search", 16)}<input id="palette-input" placeholder="搜索连接、键、页面或执行命令…" autocomplete="off" spellcheck="false" /><span class="kbd">esc</span></div>
      <div class="palette-list" id="palette-list">${paletteList(s, "")}</div>
    </div>
  </div>`;
}

export function paletteList(s: ViewState, query: string): string {
  const q = query.trim().toLowerCase();
  const conn = currentConnection();
  const groups: { title: string; items: { label: string; hint: string; action: string; iconName: string }[] }[] = [];

  groups.push({
    title: "页面",
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
      items: [{ label: `在 CLI 中执行 « ${query.trim()} »`, hint: "enter", action: `cmd:${query.trim()}`, iconName: "terminal" }],
    });
  }

  const html = groups
    .map((g) => {
      const items = g.items.filter((i) => !q || `${i.label} ${i.hint}`.toLowerCase().includes(q)).slice(0, q ? 6 : 8);
      if (!items.length) return "";
      return `<div class="palette-group">${esc(g.title)}</div>${items
        .map((i) => `<button class="palette-item" data-palette-action="${esc(i.action)}">${icon(i.iconName, 14)}<span class="ellipsis">${esc(i.label)}</span><span class="p-hint">${esc(i.hint)}</span></button>`)
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
      (t) => `<div class="toast ${t.kind}"><span class="toast-icon">${icon(t.kind === "ok" ? "checkCircle" : t.kind === "err" ? "xCircle" : "info", 15)}</span>
        <div><div class="toast-title">${esc(t.title)}</div>${t.detail ? `<div class="toast-detail">${esc(t.detail)}</div>` : ""}</div></div>`,
    )
    .join("")}</div>`;
}

export function confirmModal(s: ViewState): string {
  const c = s.confirm;
  if (!c) return "";
  return `<div class="dialog-scrim" data-action="confirm-cancel">
    <div class="dialog" role="alertdialog" aria-modal="true" data-stop>
      <div class="dialog-head"><span class="dialog-title">${esc(c.title)}</span><div class="row"><button class="btn ghost icon" data-action="confirm-cancel" aria-label="关闭">${icon("x", 15)}</button></div></div>
      <div class="dialog-body"><p style="color:var(--fg-2);line-height:1.65">${esc(c.body)}</p></div>
      <div class="dialog-foot"><span class="grow"></span><button class="btn" data-action="confirm-cancel">取消</button><button class="btn ${c.danger ? "danger" : "primary"}" data-action="confirm-ok">${esc(c.confirmLabel)}</button></div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* History memo for sidebar sparklines (kept out of the store's hot path) */
/* ------------------------------------------------------------------ */

const historyCache = new Map<string, { ops: number }[]>();
export function noteHistory(id: string, values: { ops: number }[]) {
  historyCache.set(id, values);
}
function currentHistoryForKey(id: string) {
  return historyCache.get(id) ?? [];
}
