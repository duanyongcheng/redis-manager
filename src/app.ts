import { bindCharts } from "./core/charts";
import { api, errorMessage, redis } from "./core/api";
import { esc, splitCommandLine } from "./core/format";
import {
  activeCliSession,
  addCliSession,
  clearCliLog,
  checkForUpdates,
  confirmDialog,
  currentConnection,
  currentDb,
  deleteSelectedKey,
  go,
  loadMonitor,
  loadAppInfo,
  loadOverview,
  notify,
  onChange,
  openKey,
  patch,
  refreshConnections,
  removeConnection,
  runCli,
  saveConnection,
  saveHashField,
  scanKeys,
  selectConnection,
  selectDatabase,
  setCliReadOnly,
  startPolling,
  state,
  stopPolling,
  testConnection,
  toast,
  type PageId,
  type ViewState,
} from "./core/store";
import { settings } from "./theme/settings";
import { isScheme, isThemeId, themeMeta, type Scheme, type ThemeId } from "./theme/themes";
import { browserView } from "./views/browser";
import { cliView } from "./views/cli";
import { connectionsView, connectionDialog, editorDraft, type EditorDraft } from "./views/connections";
import { monitorView } from "./views/monitor";
import { overviewView, setWindowSize } from "./views/overview";
import { settingsView } from "./views/settings";
import { confirmModal, dataContext, palette, paletteList, sidebar, statusbar, tabs, toasts, topbar } from "./ui/shell";

interface LocalUi {
  windowSize: number;
  themeMenu: boolean;
  testResult: { kind: "ok" | "err"; text: string } | null;
  draft: EditorDraft | null;
  editor: ViewState["connectionEditor"];
  paletteQuery: string;
  paletteAction: string;
}

const ui: LocalUi = { windowSize: 60, themeMenu: false, testResult: null, draft: null, editor: null, paletteQuery: "", paletteAction: "" };

const root = document.getElementById("root")!;

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

const PAGE_VIEWS: Record<PageId, (s: ViewState) => string> = {
  overview: overviewView,
  browser: browserView,
  cli: cliView,
  monitor: monitorView,
  connections: connectionsView,
  settings: settingsView,
};

let scrollMemo: Record<string, number> = {};
let hasPaintedApp = false;
let renderedContext = "";
let renderedKey: string | null = null;
let renderedEditor: ViewState["connectionEditor"] = null;
let renderedEditorMode: string | undefined;
let testRequest = 0;
const pendingSelectUpdates = new WeakMap<HTMLSelectElement, HTMLSelectElement>();
const hashEditVersions = new WeakMap<HTMLFormElement, number>();

function applySelectOptions(previous: HTMLSelectElement, next: HTMLSelectElement) {
  const value = next.value;
  previous.replaceChildren(...Array.from(next.childNodes));
  previous.value = value;
  previous.disabled = next.disabled;
  pendingSelectUpdates.delete(previous);
}

// Keep interactive subtrees connected when only the surrounding metrics change.
// Replacing them would reset iframe documents or interrupt CLI input and focus.
function updateRenderedApp(html: string, context: string) {
  if (!hasPaintedApp) {
    root.innerHTML = html;
  } else {
    const template = document.createElement("template");
    template.innerHTML = html;
    const updateRegion = (selector: string, replace = false) => {
      const previous = root.querySelector(selector);
      const next = template.content.querySelector(selector);
      if (previous && next && (replace || !previous.isEqualNode(next))) previous.replaceWith(next);
    };
    const updateSelect = (selector: string) => {
      const previous = root.querySelector<HTMLSelectElement>(selector);
      const next = template.content.querySelector<HTMLSelectElement>(selector);
      if (!previous || !next) return;
      if (previous.isEqualNode(next)) {
        pendingSelectUpdates.delete(previous);
      } else if (document.activeElement === previous) {
        // Updating native options can close an open picker even if the select stays connected.
        pendingSelectUpdates.set(previous, next);
      } else {
        applySelectOptions(previous, next);
      }
    };
    for (const selector of [".topbar", ".sidebar", ".tabs", ".statusbar"]) updateRegion(selector);
    if (root.querySelector("[data-connection-select]") && template.content.querySelector("[data-connection-select]")) {
      updateSelect("[data-connection-select]");
      updateSelect("[data-db-select]");
      updateRegion(".data-context-address");
      updateRegion(".data-context-mode");
    } else {
      updateRegion(".data-context");
    }
    if (root.querySelector("#palette-input") && template.content.querySelector("#palette-input")) {
      updateRegion("#palette-list");
    } else {
      updateRegion('[data-overlay="palette"]');
    }
    if (state.connectionEditor && state.connectionEditor === renderedEditor && root.querySelector("#connection-form") && template.content.querySelector("#connection-form")) {
      if (ui.draft?.mode !== renderedEditorMode) updateRegion("#connection-mode-fields");
      updateRegion("#connection-test-result");
    } else {
      updateRegion('[data-overlay="editor"]');
    }
    for (const name of ["theme", "confirm", "toasts"]) updateRegion(`[data-overlay="${name}"]`);
    if (context === renderedContext && state.page === "browser" && root.querySelector(".browser") && template.content.querySelector(".browser")) {
      for (const selector of [".browser-keys .card-meta", ".browser-chips", ".key-list", ".browser-foot"]) updateRegion(selector);
      if (state.selectedKey === renderedKey && state.value?.key === state.selectedKey && root.querySelector("#hash-form") && template.content.querySelector("#hash-form")) {
        updateRegion(".value-head");
        updateRegion(".value-body > .tbl");
        updateRegion(".value-foot");
      } else {
        updateRegion(".browser-value");
      }
    } else if (context === renderedContext && state.page === "cli" && root.querySelector(".cli") && template.content.querySelector(".cli")) {
      updateRegion(".cli-bar");
      updateRegion("#cli-log");
      updateRegion(".cli-suggest");
      updateRegion(".cli-prompt .prompt");
    } else if (context === renderedContext && state.page === "settings" && root.querySelector(".settings") && template.content.querySelector(".settings")) {
      updateRegion(".settings-theme");
      updateRegion(".settings-about");
      updateRegion('.settings [data-action="set-key-grouping"]');
      updateRegion('.settings [data-action="set-cli-readonly"]');
      for (const name of ["scanCount", "maxValueBytes", "cliHistoryLimit"]) updateSelect(`[data-setting="${name}"]`);
    } else {
      updateRegion(".content", true);
    }
    root.querySelector(".app")?.classList.remove("app-enter");
  }
  renderedContext = context;
  renderedKey = state.selectedKey;
  renderedEditor = state.connectionEditor;
  renderedEditorMode = ui.draft?.mode;
  hasPaintedApp = true;
}

function pageBody(s: ViewState): string {
  const view = PAGE_VIEWS[s.page] ?? overviewView;
  try {
    return view(s);
  } catch (error) {
    return `<div class="notice err">页面渲染失败：${esc(errorMessage(error))}</div>`;
  }
}

function render() {
  const s = state;
  const conn = currentConnection();
  syncEditorDraft();
  const hadPalette = Boolean(root.querySelector("#palette-input"));
  // Preserve the scroll offset of the page container across re-renders.
  const prevContent = root.querySelector<HTMLElement>(".content");
  if (prevContent && s.page) scrollMemo[`${s.page}:${s.connId}`] = prevContent.scrollTop;
  const prevLog = root.querySelector<HTMLElement>("#cli-log");
  if (prevLog) scrollMemo["cli"] = prevLog.scrollTop;
  const prevValue = root.querySelector<HTMLElement>(".value-body");
  if (prevValue) scrollMemo["value"] = prevValue.scrollTop;
  const prevKeys = root.querySelector<HTMLElement>(".key-list");
  if (prevKeys) scrollMemo["keys"] = prevKeys.scrollTop;

  const html = `
    <div class="app${hasPaintedApp ? "" : " app-enter"}">
      ${topbar(s)}
      <div class="workarea">
        ${sidebar(s)}
        <main class="main">
          ${tabs(s)}
          ${dataContext(s)}
          <div class="content" data-page="${s.page}">${s.serviceAvailable ? "" : serviceBanner()}${pageBody(s)}</div>
        </main>
      </div>
      ${statusbar(s)}
    </div>
    <div class="app-overlays">
      <div data-overlay="palette">${palette(s, ui.paletteQuery, ui.paletteAction)}</div>
      <div data-overlay="editor">${s.connectionEditor ? connectionDialog(s, ui.draft!, ui.testResult) : ""}</div>
      <div data-overlay="theme">${ui.themeMenu ? themeMenu(s) : ""}</div>
      <div data-overlay="confirm">${confirmModal(s)}</div>
      <div data-overlay="toasts">${toasts(s)}</div>
    </div>`;

  updateRenderedApp(html, JSON.stringify([s.page, conn?.id, currentDb(conn), s.page === "cli" ? activeCliSession()?.id : null]));
  document.title = conn ? `Redis Manager — ${conn.name || conn.host}` : "Redis Manager";

  // restore scrolls
  const content = root.querySelector<HTMLElement>(".content");
  const memoKey = `${s.page}:${s.connId}`;
  if (content && scrollMemo[memoKey] != null) content.scrollTop = scrollMemo[memoKey]!;
  const log = root.querySelector<HTMLElement>("#cli-log");
  if (log) log.scrollTop = scrollMemo["cli"] ?? log.scrollHeight;
  const valueBody = root.querySelector<HTMLElement>(".value-body");
  if (valueBody && scrollMemo["value"]) valueBody.scrollTop = scrollMemo["value"]!;
  const keyList = root.querySelector<HTMLElement>(".key-list");
  if (keyList && scrollMemo["keys"]) keyList.scrollTop = scrollMemo["keys"]!;

  bindCharts(root);
  if (s.paletteOpen && !hadPalette) focusPalette();
  updateAsciiBars();
  updateThemeMeta();
  document.documentElement.dataset.page = s.page;
}

function serviceBanner(): string {
  return `<div class="notice warn" style="margin-bottom:var(--gap)">未检测到 Go 服务：<code class="mono">bun run dev:web</code> 只能预览界面，完整的绑定需要 <code class="mono">bun run dev</code>（MyGo 窗口）。</div>`;
}

/** ASCII themes paint bars as text; CSS can't compute widths, JS can. */
function updateAsciiBars() {
  if (settings.get("theme") !== "terminal") return;
  root.querySelectorAll<HTMLElement>(".bar-track > i").forEach((fill) => {
    const parent = fill.parentElement;
    if (!parent) return;
    const width = Number.parseFloat(fill.style.width || "0");
    const slots = 18;
    const filled = Math.max(1, Math.round((width / 100) * slots));
    parent.style.setProperty("--ascii", `'${"█".repeat(filled)}${"░".repeat(slots - filled)}'`);
  });
  root.querySelectorAll<HTMLElement>(".bar").forEach((bar) => {
    const fill = bar.querySelector<HTMLElement>("i");
    if (!fill) return;
    const width = Number.parseFloat(fill.style.width || "0");
    const slots = 24;
    const filled = Math.round((width / 100) * slots);
    bar.style.setProperty("--ascii", `'[${"█".repeat(filled)}${"░".repeat(slots - filled)}]'`);
  });
}

function updateThemeMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (bg) meta.setAttribute("content", bg);
  }
}

/* ------------------------------------------------------------------ */
/* Theme menu (topbar dropdown)                                        */
/* ------------------------------------------------------------------ */

function themeMenu(s: ViewState): string {
  const active = settings.get("theme");
  const scheme = settings.get("scheme");
  return `<div class="scrim theme-scrim" data-action="theme-menu-close">
    <div class="palette theme-menu" data-stop>
      <div class="palette-group">界面主题</div>
      ${themeMeta(active) && ""
      }
      ${["terminal", "craft", "console", "airy"]
        .map((id) => {
          const meta = themeMeta(id as ThemeId);
          return `<button class="palette-item ${active === id ? "active" : ""}" data-pick-theme="${id}">
            <span class="theme-swatch" style="background:${meta.swatch[0]};border-color:${meta.swatch[1]}"></span>
            <span>${esc(meta.name)} <span class="faint">${esc(meta.tagline)}</span></span>
            <span class="p-hint">${meta.schemes ? `${meta.schemes.length} 配色` : "单配色"}</span>
            ${active === id ? `<span class="acc">✓</span>` : ""}
          </button>`;
        })
        .join("")}
      ${themeMeta(active).schemes
        ? `<div class="palette-group">深浅色</div><div class="row" style="padding:4px 10px 10px">
            ${themeMeta(active)
              .schemes!.map((sc) => `<button class="chip ${scheme === sc ? "active" : ""}" data-pick-scheme="${sc}">${sc === "dark" ? "深色" : "浅色"}</button>`)
              .join("")}
          </div>`
        : ""}
      <div class="palette-group" style="border-top:1px solid var(--line);margin-top:4px">更多</div>
      <button class="palette-item" data-nav="settings">在设置中管理主题 <span class="p-hint">⌘,</span></button>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Editor form helpers                                                 */
/* ------------------------------------------------------------------ */

function syncEditorDraft() {
  if (ui.editor === state.connectionEditor) return;
  ui.editor = state.connectionEditor;
  ui.draft = ui.editor ? editorDraft(state) : null;
  ui.testResult = null;
  testRequest += 1;
}

function readDraft(): EditorDraft {
  const draft: EditorDraft = { ...(ui.draft ?? editorDraft(state)) };
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach((el) => {
    const name = el.dataset.field as keyof EditorDraft;
    const raw = el.value;
    if (name === "port" || name === "db") (draft as unknown as Record<string, unknown>)[name] = Number(raw) || 0;
    else (draft as unknown as Record<string, unknown>)[name] = raw;
  });
  ui.draft = draft;
  return draft;
}

function draftConnection(draft: EditorDraft): EditorDraft {
  const { password: _password, ...conn } = draft;
  return { ...conn, port: conn.port || 6379, db: Number.isFinite(conn.db) ? conn.db : 0 } as EditorDraft;
}

async function onTestConnection() {
  const editor = state.connectionEditor;
  if (!editor) return;
  const request = ++testRequest;
  const draft = readDraft();
  if (!state.serviceAvailable) {
    ui.testResult = { kind: "err", text: "Go 服务不可用，无法测试连接。" };
    render();
    return;
  }
  const conn = draftConnection(draft);
  if (!conn.host) {
    ui.testResult = { kind: "err", text: "请填写主机地址。" };
    render();
    return;
  }
  ui.testResult = { kind: "err", text: "正在连接…" };
  render();
  try {
    const result = await redis.testConnection(conn as never, draft.password ?? "");
    if (state.connectionEditor !== editor || request !== testRequest) return;
    ui.testResult =
      result.status === "ok"
        ? { kind: "ok", text: `连接成功 · ${result.version || "Redis"} · ${result.latencyMs.toFixed(1)} ms · ${result.mode || conn.mode}` }
        : { kind: "err", text: result.message || "连接失败" };
  } catch (error) {
    if (state.connectionEditor !== editor || request !== testRequest) return;
    ui.testResult = { kind: "err", text: errorMessage(error) };
  }
  render();
}

async function onSaveConnection() {
  const editor = state.connectionEditor;
  if (!editor) return;
  const draft = readDraft();
  const conn = draftConnection(draft);
  if (!conn.name.trim()) conn.name = `${conn.host}:${conn.port}`;
  if (!conn.host) {
    ui.testResult = { kind: "err", text: "请填写主机地址。" };
    render();
    return;
  }
  const ok = await saveConnection(conn as never, draft.password ?? "");
  if (ok && state.connectionEditor === editor) {
    ui.draft = null;
    ui.testResult = null;
    patch({ connectionEditor: null });
  }
}

function openEditor(mode: "new" | "edit", id?: string) {
  ui.draft = null;
  ui.testResult = null;
  patch({ connectionEditor: { mode, id } });
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function openPalette() {
  if (!state.paletteOpen) {
    ui.paletteQuery = "";
    ui.paletteAction = "";
  }
  patch({ paletteOpen: true });
}

function closePalette() {
  if (!state.paletteOpen) return;
  ui.paletteQuery = "";
  ui.paletteAction = "";
  patch({ paletteOpen: false });
}

function focusPalette() {
  const input = document.getElementById("palette-input") as HTMLInputElement | null;
  input?.focus();
}

const actions: Record<string, () => void | Promise<void>> = {
  noop: () => {},
  refresh: () => refreshConnections(),
  "refresh-metrics": () => loadOverview(),
  "refresh-monitor": () => loadMonitor(),
  "check-updates": () => checkForUpdates(),
  "new-connection": () => openEditor("new"),
  "editor-close": () => {
    ui.draft = null;
    ui.testResult = null;
    patch({ connectionEditor: null });
  },
  "test-connection": () => onTestConnection(),
  "save-connection": () => onSaveConnection(),
  "palette": () => openPalette(),
  "palette-close": () => closePalette(),
  "theme-menu": () => {
    ui.themeMenu = true;
    render();
  },
  "theme-menu-close": () => {
    ui.themeMenu = false;
    render();
  },
  "toggle-sidebar": () => settings.patch({ sidebarCollapsed: !settings.get("sidebarCollapsed") }),
  "toggle-scheme": () => {
    const meta = themeMeta(settings.get("theme"));
    if (!meta.schemes) return;
    const next: Scheme = settings.get("scheme") === "dark" ? "light" : "dark";
    settings.patch({ scheme: meta.schemes.includes(next) ? next : meta.defaultScheme });
  },
  "toggle-grouping": () => settings.patch({ keyGrouping: !settings.get("keyGrouping") }),
  "go-cli": () => go("cli"),
  "scan-reset": () => scanKeys({ reset: true }),
  "scan-more": () => scanKeys({ append: true }),
  "reload-value": () => (state.selectedKey ? openKey(state.selectedKey) : undefined),
  "copy-key": () => {
    const key = state.value?.key ?? state.selectedKey;
    if (key) void copy(key);
  },
  "delete-key": () => {
    const value = state.value;
    const conn = currentConnection();
    if (!value || !conn) return;
    const target = { connId: conn.id, db: currentDb(conn), key: value.key };
    confirmDialog({
      title: "删除键",
      body: `确认删除 ${value.key}？此操作不可恢复，删除后所有客户端立即不可见。`,
      confirmLabel: "删除",
      danger: true,
      onConfirm: () => void deleteSelectedKey(target),
    });
  },
  "confirm-cancel": () => patch({ confirm: null }),
  "confirm-ok": () => {
    const c = state.confirm;
    patch({ confirm: null });
    c?.onConfirm();
  },
  "new-cli-session": () => addCliSession(),
  "cli-clear": () => clearCliLog(),
  "delete-connection": () => {
    const id = state.connections.find((c) => c.id === (state as ViewState & { _id?: string })._id)?.id;
    if (id) void deleteConnection(id);
  },
  "reset-settings": () => {
    confirmDialog({ title: "恢复默认设置", body: "主题、浏览与 CLI 偏好都会回到初始值。", confirmLabel: "恢复", onConfirm: () => settings.reset() });
  },
  "set-key-grouping": () => settings.patch({ keyGrouping: !settings.get("keyGrouping") }),
  "set-cli-readonly": () => settings.patch({ cliReadOnlyDefault: !settings.get("cliReadOnlyDefault") }),
};

function deleteConnection(id: string) {
  const conn = state.connections.find((c) => c.id === id);
  if (!conn) return;
  confirmDialog({
    title: "删除连接",
    body: `将删除已保存的连接「${conn.name || conn.host}」及其密码凭据，不影响 Redis 服务器上的数据。`,
    confirmLabel: "删除连接",
    danger: true,
    onConfirm: () => void removeConnection(id),
  });
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("ok", "已复制", text.length > 40 ? `${text.slice(0, 40)}…` : text);
  } catch {
    toast("err", "复制失败", "剪贴板不可用");
  }
}

/* ------------------------------------------------------------------ */
/* Event wiring                                                        */
/* ------------------------------------------------------------------ */

function closest<T extends Element = HTMLElement>(target: EventTarget | null, selector: string): T | null {
  return target instanceof Element ? (target.closest(selector) as T | null) : null;
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;

  // theme pickers (menu + settings)
  const themeBtn = closest<HTMLElement>(target, "[data-pick-theme]");
  if (themeBtn) {
    settings.patch({ theme: themeBtn.dataset.pickTheme as ThemeId });
    ui.themeMenu = false;
    render();
    return;
  }
  const schemeBtn = closest<HTMLElement>(target, "[data-pick-scheme]");
  if (schemeBtn) {
    const meta = themeMeta(settings.get("theme"));
    const scheme = schemeBtn.dataset.pickScheme as Scheme;
    if (!meta.schemes || meta.schemes.includes(scheme)) settings.patch({ scheme });
    ui.themeMenu = false;
    render();
    return;
  }

  // palette entries
  const paletteItem = closest<HTMLElement>(target, "[data-palette-action]");
  if (paletteItem) {
    const value = paletteItem.dataset.paletteAction ?? "";
    const [kind, ...rest] = value.split(":");
    const payload = rest.join(":");
    closePalette();
    if (kind === "nav") go(payload as PageId);
    else if (kind === "conn") void selectConnection(payload);
    else if (kind === "key") {
      go("browser");
      void openKey(payload.replace("key:", ""));
    } else if (kind === "cmd") {
      go("cli");
      void runCli(payload);
    }
    return;
  }

  // navigation / selection
  const nav = closest<HTMLElement>(target, "[data-nav]");
  if (nav?.dataset.nav) {
    go(nav.dataset.nav as PageId);
    return;
  }
  const connItem = closest<HTMLElement>(target, "[data-conn]");
  if (connItem?.dataset.conn) {
    void selectConnection(connItem.dataset.conn);
    return;
  }
  const connectBtn = closest<HTMLElement>(target, "[data-connect]");
  if (connectBtn?.dataset.connect) {
    void selectConnection(connectBtn.dataset.connect);
    return;
  }
  const keyRow = closest<HTMLElement>(target, "[data-key]");
  if (keyRow?.dataset.key) {
    void openKey(keyRow.dataset.key);
    return;
  }
  const group = closest<HTMLElement>(target, "[data-group]");
  if (group?.dataset.group != null) {
    const prefix = group.dataset.group;
    state.collapsedGroups = { ...state.collapsedGroups, [prefix]: !state.collapsedGroups[prefix] };
    notify();
    return;
  }
  const keyType = closest<HTMLElement>(target, "[data-key-type]");
  if (keyType?.dataset.keyType) {
    patch({ keyType: keyType.dataset.keyType });
    return;
  }
  const segValue = closest<HTMLElement>(target, "[data-seg-action]");
  if (segValue?.dataset.segAction === "view-mode") {
    const mode = segValue.dataset.segValue as ViewState["valueMode"];
    if (["raw", "json", "hex", "html", "markdown"].includes(mode)) patch({ valueMode: mode });
    return;
  }
  const windowBtn = closest<HTMLElement>(target, "[data-window]");
  if (windowBtn?.dataset.window) {
    ui.windowSize = Number(windowBtn.dataset.window) || 60;
    setWindowSize(state, ui.windowSize);
    render();
    return;
  }
  const cliSession = closest<HTMLElement>(target, "[data-cli-session]");
  if (cliSession?.dataset.cliSession != null) {
    const conn = currentConnection();
    if (conn) {
      state.cliActive[conn.id] = Number(cliSession.dataset.cliSession);
      notify();
    }
    return;
  }
  const cliMode = closest<HTMLElement>(target, "[data-cli-mode]");
  if (cliMode?.dataset.cliMode) {
    setCliReadOnly(cliMode.dataset.cliMode === "readonly");
    return;
  }
  const fill = closest<HTMLElement>(target, "[data-fill]");
  if (fill?.dataset.fill) {
    const input = document.getElementById("cli-input") as HTMLInputElement | null;
    if (input) {
      input.value = fill.dataset.fill;
      input.focus();
    }
    return;
  }
  const formToggle = closest<HTMLElement>(target, "[data-form-toggle]");
  if (formToggle) {
    const key = formToggle.dataset.formToggle as "tls" | "readOnly";
    readDraft();
    if (ui.draft) ui.draft[key] = !ui.draft[key];
    formToggle.classList.toggle("on", Boolean(ui.draft?.[key]));
    formToggle.setAttribute("aria-checked", String(Boolean(ui.draft?.[key])));
    return;
  }
  if (closest(target, "#cli-clear")) {
    clearCliLog();
    return;
  }

  // generic actions
  // A dialog scrim owns the close action, but clicks inside its data-stop
  // panel must not resolve that ancestor as the clicked action. Keep actions
  // rendered inside the stopped panel available for buttons such as Save.
  const stopEl = closest<HTMLElement>(target, "[data-stop]");
  const candidateAction = closest<HTMLElement>(target, "[data-action]");
  const actionEl = candidateAction && (!stopEl || stopEl.contains(candidateAction)) ? candidateAction : null;
  if (actionEl) {
    const action = actionEl.dataset.action ?? "";
    if (action === "edit-connection") {
      openEditor("edit", actionEl.dataset.id);
      return;
    }
    if (action === "delete-connection" && actionEl.dataset.id) {
      deleteConnection(actionEl.dataset.id);
      return;
    }
    if (action === "test-id" && actionEl.dataset.id) {
      const conn = state.connections.find((c) => c.id === actionEl.dataset.id);
      if (conn) void testConnection(conn);
      return;
    }
    if (action === "copy" && actionEl.dataset.copy) {
      void copy(actionEl.dataset.copy);
      return;
    }
    const fn = actions[action];
    if (fn) {
      void fn();
      return;
    }
    // scrim click handlers (palette / theme menu / dialogs) close when the
    // click lands outside the inner panel.
    if (action === "palette-close" || action === "theme-menu-close" || action === "editor-close" || action === "confirm-cancel") {
      return;
    }
  }

  // scrims: only close when clicking the backdrop itself
  const scrim = target.classList?.contains("scrim") ? target : target.classList?.contains("dialog-scrim") ? target : null;
  if (scrim) {
    if (state.paletteOpen) closePalette();
    else if (ui.themeMenu) {
      ui.themeMenu = false;
      render();
    } else if (state.confirm) patch({ confirm: null });
    else if (state.connectionEditor) {
      ui.draft = null;
      ui.testResult = null;
      patch({ connectionEditor: null });
    }
  }
});

document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.matches("#connection-form [data-field]")) {
    readDraft();
    return;
  }
  if (target.form?.id === "hash-form") {
    hashEditVersions.set(target.form, (hashEditVersions.get(target.form) ?? 0) + 1);
    return;
  }
  if (target.id === "palette-input") {
    ui.paletteQuery = target.value;
    ui.paletteAction = "";
    const list = document.getElementById("palette-list");
    if (list) list.innerHTML = paletteList(state, target.value);
    return;
  }
  if (target.id === "key-pattern") {
    state.keyPattern = target.value;
    return;
  }
  if (target.id === "key-filter") {
    state.keyQuery = target.value;
    const list = root.querySelector(".key-list");
    if (list) {
      // Cheap re-render of only the key list.
      const view = browserView({ ...state, keyQuery: target.value } as ViewState);
      const temp = document.createElement("div");
      temp.innerHTML = view;
      const fresh = temp.querySelector(".key-list");
      if (fresh) list.innerHTML = fresh.innerHTML;
    }
  }
});

document.addEventListener("change", (event) => {
  const target = event.target as HTMLSelectElement;
  if (target.matches("#connection-form [data-field]")) {
    readDraft();
    if (target.dataset.field === "mode") render();
    return;
  }
  if (target.dataset.connectionSelect != null) {
    void selectConnection(target.value);
    return;
  }
  if (target.dataset.dbSelect != null) {
    void selectDatabase(Number(target.value));
    return;
  }
  const key = target.dataset.setting;
  if (!key) return;
  if (key === "scanCount" || key === "cliHistoryLimit" || key === "maxValueBytes") {
    settings.patch({ [key]: Number(target.value) } as never);
  }
});

document.addEventListener("focusout", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  const pending = pendingSelectUpdates.get(target);
  if (pending && target.isConnected) applySelectOptions(target, pending);
});

document.addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  event.preventDefault();
  if (form.id === "cli-form") {
    // The live element, not getElementById: form submission can race a
    // re-render, and the submitted form is the authoritative node here.
    const input = form.querySelector<HTMLInputElement>("#cli-input");
    if (!input?.value.trim()) return;
    const value = input.value;
    input.value = "";
    delete input.dataset.hist;
    void runCli(value);
    return;
  }
  if (form.id === "hash-form") {
    const data = new FormData(form);
    const field = String(data.get("field") ?? "").trim();
    const value = String(data.get("value") ?? "");
    if (!field) return;
    const editVersion = hashEditVersions.get(form) ?? 0;
    void saveHashField(field, value).then((ok) => {
      if (!ok || !form.isConnected || (hashEditVersions.get(form) ?? 0) !== editVersion) return;
      const current = new FormData(form);
      if (String(current.get("field") ?? "").trim() === field && String(current.get("value") ?? "") === value) form.reset();
    });
    return;
  }
  if (form.id === "connection-form") {
    void onSaveConnection();
  }
});

document.addEventListener("keydown", (event) => {
  const mod = event.metaKey || event.ctrlKey;
  // Keyboard events may target the document (programmatic dispatch, some
  // webviews), where `Element.matches` does not exist.
  const target = (event.target instanceof HTMLElement ? event.target : null) as HTMLElement | null;
  const typing = Boolean(target?.matches("input, textarea, select") || target?.isContentEditable);

  if (event.key === "Escape") {
    if (state.paletteOpen) return void closePalette();
    if (ui.themeMenu) {
      ui.themeMenu = false;
      return void render();
    }
    if (state.confirm) return void patch({ confirm: null });
    if (state.connectionEditor) return void actions["editor-close"]!();
    return;
  }
  if (mod && event.key.toLowerCase() === "k") {
    event.preventDefault();
    return void openPalette();
  }
  if (mod && event.key === ",") {
    event.preventDefault();
    return void go("settings");
  }
  if (mod && event.key.toLowerCase() === "t") {
    event.preventDefault();
    go("cli");
    return void addCliSession();
  }
  if (mod && event.key.toLowerCase() === "r") {
    event.preventDefault();
    return void loadOverview();
  }
  if (mod && event.key.toLowerCase() === "l") {
    if (state.page === "cli") {
      event.preventDefault();
      clearCliLog();
    }
    return;
  }
  if (mod && (event.key === "1" || event.key === "2" || event.key === "3" || event.key === "4")) {
    const pages: PageId[] = ["overview", "browser", "cli", "monitor"];
    event.preventDefault();
    return void go(pages[Number(event.key) - 1]!);
  }

  if (state.paletteOpen) {
    const items = Array.from(root.querySelectorAll<HTMLElement>("#palette-list .palette-item"));
    const current = items.findIndex((el) => el.classList.contains("active"));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const dir = event.key === "ArrowDown" ? 1 : -1;
      const next = (current + dir + items.length) % Math.max(1, items.length);
      items.forEach((el, i) => el.classList.toggle("active", i === next));
      ui.paletteAction = items[next]?.dataset.paletteAction ?? "";
      items[next]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const pick = items[current >= 0 ? current : 0];
      pick?.click();
      return;
    }
  }

  if (target?.id === "cli-input") {
    const session = activeCliSession();
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const input = target as HTMLInputElement;
      if (input.value.trim()) {
        const value = input.value;
        input.value = "";
        delete input.dataset.hist;
        void runCli(value);
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const input = target as HTMLInputElement;
      const words = splitCommandLine(input.value);
      if (!words.length) return;
      const last = words[words.length - 1]!.toUpperCase();
      const candidate = COMMANDS.find((c) => c.startsWith(last) && c !== last);
      if (candidate) {
        words[words.length - 1] = candidate;
        input.value = `${words.join(" ")} `;
      }
      return;
    }
    if (event.key === "ArrowUp" && session) {
      event.preventDefault();
      const input = target as HTMLInputElement;
      const idx = Number(input.dataset.hist ?? session.history.length);
      const next = Math.max(0, idx - 1);
      input.dataset.hist = String(next);
      input.value = session.history[next] ?? "";
      return;
    }
    if (event.key === "ArrowDown" && session) {
      event.preventDefault();
      const input = target as HTMLInputElement;
      const idx = Number(input.dataset.hist ?? session.history.length);
      const next = Math.min(session.history.length, idx + 1);
      input.dataset.hist = String(next);
      input.value = session.history[next] ?? "";
      return;
    }
    if (event.key !== "Enter") delete (target as HTMLInputElement).dataset.hist;
  }

  if (event.key === "Enter" && target?.id === "key-pattern") {
    event.preventDefault();
    void scanKeys({ reset: true });
  }
  if (typing) return;
});

const COMMANDS = [
  "APPEND", "AUTH", "BGSAVE", "CLIENT", "CLUSTER", "COMMAND", "CONFIG", "DBSIZE", "DEBUG", "DEL", "EXISTS",
  "EXPIRE", "FLUSHALL", "FLUSHDB", "GET", "HDEL", "HGET", "HGETALL", "HLEN", "HSET", "INFO", "KEYS", "LLEN",
  "LPUSH", "LRANGE", "MEMORY", "MONITOR", "MSET", "OBJECT", "PERSIST", "PING", "PTTL", "RPOP", "RPUSH", "SADD",
  "SCAN", "SCARD", "SCAN", "SELECT", "SET", "SETEX", "SLOWLOG", "SMEMBERS", "SREM", "STRLEN", "TIME", "TTL",
  "TYPE", "UNLINK", "XADD", "XLEN", "XRANGE", "ZADD", "ZCARD", "ZRANGE", "ZREM",
];

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

settings.subscribe((_, changed) => {
  if (changed.has("theme") || changed.has("scheme")) render();
  else notify();
});

onChange(() => render());

async function boot() {
  window.__RM_BOOTED__ = (window.__RM_BOOTED__ ?? []).concat(["boot"]);
  settings.applyTheme();
  render();
  window.__RM_READY__ = true;
  window.__RM_SERVICE__ = state.serviceAvailable;
  window.__RM_DEBUG__ = { outside: window.__RM_OUTSIDE__, available: api.available, hasWindowSvc: Boolean(window.RedisService) };
  void loadAppInfo();
  await refreshConnections();
  const params = new URLSearchParams(location.search);
  setWindowSize(state, ui.windowSize);
  // Preview deep links (used by scripts/shoot-all.mjs) may force a theme.
  const themeParam = params.get("theme");
  const schemeParam = params.get("scheme");
  if (isThemeId(themeParam)) {
    const meta = themeMeta(themeParam);
    settings.patch({ theme: themeParam, scheme: isScheme(schemeParam) ? schemeParam : meta.defaultScheme });
  } else if (isScheme(schemeParam)) {
    settings.patch({ scheme: schemeParam });
  }
  const page = params.get("page") as PageId | null;
  if (page && PAGE_VIEWS[page]) go(page);
  if (state.serviceAvailable) {
    startPolling();
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPolling();
  else if (state.serviceAvailable) {
    startPolling();
    if (state.page === "monitor") void loadMonitor();
    else void loadOverview();
  }
});

declare global {
  interface Window {
    __RM_READY__?: boolean;
    __RM_STATE__?: ViewState;
    __RM_SETTINGS__?: typeof settings;
    __RM_SERVICE__?: boolean;
    __RM_OUTSIDE__?: boolean;
    __RM_DEBUG__?: unknown;
    __RM_KEYS__?: string;
    __RM_BOOTED__?: string[];
  }
}

window.__RM_STATE__ = state;
window.__RM_SETTINGS__ = settings;

void boot();

