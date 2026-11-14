import { bindCharts } from "./core/charts";
import { api, errorMessage, redis } from "./core/api";
import { esc, splitCommandLine } from "./core/format";
import { icon } from "./core/icons";
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
  currentHistory,
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
  type MetricSample,
  type PageId,
  type ViewState,
} from "./core/store";
import { settings } from "./theme/settings";
import { isScheme, type Scheme } from "./theme/themes";
import { browserView } from "./views/browser";
import { cliView } from "./views/cli";
import { connectionsView, connectionDialog, editorDraft, type EditorDraft } from "./views/connections";
import { monitorView } from "./views/monitor";
import { overviewView, setWindowSize } from "./views/overview";
import { settingsView } from "./views/settings";
import { confirmModal, instanceHead, palette, paletteList, sidebar, statusbar, tabs, toasts, topbar } from "./ui/shell";

interface LocalUi {
  windowSize: string;
  testResult: { kind: "ok" | "err" | "info"; text: string } | null;
  draft: EditorDraft | null;
  editor: ViewState["connectionEditor"];
  paletteQuery: string;
  paletteAction: string;
}

const ui: LocalUi = { windowSize: "45", testResult: null, draft: null, editor: null, paletteQuery: "", paletteAction: "" };

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
let firstPaint = true;
let testRequest = 0;
/** The session the live prompt's draft belongs to; re-pointed on each paint. */
let draftSessionRef: { input?: string; id?: string } | null = null;
/** The session the live prompt was painted for, so drafts never cross over. */
/** The prompt node is about to be replaced by another session's prompt. */
let sessionSwitchPending = false;
const hashEditVersions = new WeakMap<HTMLFormElement, number>();

/**
 * Re-renders the shell from an HTML string.
 *
 * The default is a wholesale replacement, which keeps the DOM exactly equal to
 * the template. Only subtrees whose live identity matters survive a paint:
 * an open dialog's form, an open document (iframe), a focused CLI prompt and
 * the scroll position of the lists the user is reading. Five layers of patch
 * selectors quietly diverging from the markup was the previous failure mode,
 * so the patch list is deliberately short and structural.
 */
function updateRenderedApp(html: string, promptState: { focused: boolean; selection: { start: number | null; end: number | null; direction: "forward" | "backward" | "none" | null } | null } = { focused: false, selection: null }) {
  const next = document.createElement("div");
  next.innerHTML = html;

  // Strip formatting whitespace between elements: those text nodes would
  // otherwise become flex/grid items inside every layout container.
  const stray = document.createNodeIterator(next, NodeFilter.SHOW_TEXT);
  const blanks: Text[] = [];
  for (let node = stray.nextNode(); node; node = stray.nextNode()) {
    if (!(node as Text).data.trim()) blanks.push(node as Text);
  }
  for (const node of blanks) node.remove();

  const promptFocus = promptState.focused;
  const formText = readFormValues(root.querySelector("#connection-form"));
  const keep = new Map<string, Element>();
  // The connection form is rebuilt from its draft on purpose: its visible
  // shape (mode-specific fields) must follow the state, and its values are
  // restored below.
  for (const selector of [".html-preview", "#cli-input", "#cli-log", ".value-body", ".key-list", ".stream-body", "#hash-form", ".filterbar"]) {
    const live = root.querySelector(selector);
    if (live) keep.set(selector, live);
  }

  // Any focused control the template can reproduce (by id) keeps its focus and
  // caret: a rebuild must never move the user's cursor out of the field they
  // are typing in. Selection is read before the paint removes it.
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  // A control without an id is named by the data attribute that identifies it.
  const focusId = active && active !== document.body && active.id && active.id !== "cli-input"
    ? active.id
    : active?.dataset.setting
      ? `[data-setting="${active.dataset.setting}"]`
      : active?.hasAttribute("data-db-select")
        ? "[data-db-select]"
        // Form controls inside a repeated row are named by their section + name.
        : "";
  const focusSelection = focusId && typeof active?.selectionStart === "number"
    ? { start: active.selectionStart, end: active.selectionEnd ?? active.selectionStart, direction: active.selectionDirection ?? "none" }
    : null;

  // Lists keep their node so the scroll offset survives the paint.
  const listScroll = new Map<string, number>();
  for (const [selector, live] of keep) {
    if (live instanceof HTMLElement) listScroll.set(selector, live.scrollTop);
  }

  root.replaceChildren(...Array.from(next.childNodes));
  firstPaint = false;

  // A live document is only carried over when its own markup is unchanged:
  // adopting a different document would show the previous value.
  const liveFrame = keep.get(".html-preview");
  const freshFrame = root.querySelector(".html-preview");
  if (liveFrame && freshFrame) {
    const same = (liveFrame as HTMLElement).outerHTML === (freshFrame as HTMLElement).outerHTML;
    if (same) freshFrame.replaceWith(liveFrame);
  }

  // The command prompt is a live editing surface: keep the node (and with it
  // the draft, caret, selection direction and focus) while metrics refresh.
  // The hash form is a draft for one key: carry it only within the same key.
  const liveHash = keep.get("#hash-form");
  const freshHash = root.querySelector("#hash-form");
  if (liveHash && freshHash && liveHash.getAttribute("data-key") === freshHash.getAttribute("data-key")) {
    freshHash.replaceWith(liveHash);
    const activeField = liveHash.querySelector<HTMLInputElement>(`[name="${active?.name}"]`);
    if (active && liveHash.contains(active) && activeField) {
      activeField.focus({ preventScroll: true });
      if (focusSelection) {
        try {
          activeField.setSelectionRange(focusSelection.start, focusSelection.end, focusSelection.direction);
        } catch {
          /* number inputs reject ranges */
        }
      }
    }
  }

  // The SCAN pattern field is a draft: carry it while it holds the same text.
  const liveFilters = keep.get(".filterbar");
  const freshFilters = root.querySelector(".filterbar");
  if (liveFilters && freshFilters) {
    const livePattern = (liveFilters as HTMLElement).querySelector<HTMLInputElement>("#key-pattern");
    const freshPattern = (freshFilters as HTMLElement).querySelector<HTMLInputElement>("#key-pattern");
    if (livePattern && freshPattern && livePattern.value === freshPattern.value) {
      freshFilters.replaceWith(liveFilters);
      if (active && liveFilters.contains(active) && active instanceof HTMLInputElement) {
        active.focus({ preventScroll: true });
        if (focusSelection) active.setSelectionRange(focusSelection.start, focusSelection.end, focusSelection.direction);
      }
    }
  }

  const livePrompt = keep.get("#cli-input");
  const freshPrompt = root.querySelector("#cli-input");
  if (livePrompt && freshPrompt) {
    // The prompt is a per-session draft, not a value: carry it only while the
    // session it belongs to is the one still on screen, then take back the
    // focus the detach costs.
    const sameSession = (livePrompt as HTMLInputElement).dataset.session === (freshPrompt as HTMLInputElement).dataset.session;
    const sameValue = (livePrompt as HTMLInputElement).value === (freshPrompt as HTMLInputElement).value;

    if (sameSession && sameValue) {
      // The node is the caret and selection; the value is the draft. The
      // fresh node is authoritative for everything else, the selection included.
      freshPrompt.replaceWith(livePrompt);
      if (promptFocus && livePrompt instanceof HTMLInputElement) {
        const selection = promptState.selection;
        livePrompt.focus({ preventScroll: true });
        if (selection) livePrompt.setSelectionRange(selection.start ?? 0, selection.end ?? 0, selection.direction ?? "none");
      }
    }
  }

  for (const [selector, top] of listScroll) {
    const fresh = root.querySelector<HTMLElement>(selector);
    if (fresh) fresh.scrollTop = top;
  }

  // Restore what the user was doing: form contents, focus, caret.
  const form = root.querySelector<HTMLFormElement>("#connection-form");
  if (form && formText.size) {
    for (const el of Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]"))) {
      const value = formText.get(el.dataset.field ?? "");
      if (value != null && el.value !== value) el.value = value;
    }
  }
  if (focusId) {
    const el = (focusId.startsWith("[") ? root.querySelector(focusId) : document.getElementById(focusId)) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el && typeof el.focus === "function") {
      el.focus({ preventScroll: true });
      if (focusSelection && typeof el.setSelectionRange === "function") {
        try {
          el.setSelectionRange(focusSelection.start, focusSelection.end, focusSelection.direction);
        } catch {
          /* number inputs and some controls reject ranges; focus is enough */
        }
      }
    }
  }
  root.querySelector(".app")?.classList.remove("entering");
}

function readFormValues(form: Element | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!form) return out;
  for (const el of Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]"))) {
    out.set(el.dataset.field ?? "", el.value);
  }
  return out;
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
  // While the connection form is open it owns the draft; the live fields are
  // read straight back into it, so no action can overwrite what was typed.
  if (s.connectionEditor) readDraft();
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
  const prevWindowY = window.scrollY;
  const prevPrompt = root.querySelector<HTMLInputElement>("#cli-input");

  const prevPromptFocused = document.activeElement === prevPrompt;
  const prevPromptSelection = prevPrompt ? { start: prevPrompt.selectionStart, end: prevPrompt.selectionEnd, direction: prevPrompt.selectionDirection } : null;
  // The prompt is the source of truth for its draft at paint time; mirroring it
  // into the session it belonged to keeps every rebuild faithful.
  if (prevPrompt && !sessionSwitchPending) saveDraft();
  sessionSwitchPending = false;
  draftSessionRef = activeCliSession();

  const html = `
    <div class="app${firstPaint ? " entering" : ""}">
      ${topbar(s)}
      <div class="workspace">${sidebar(s)}<main class="main">${instanceHead(s)}${tabs(s)}${s.page === "connections" || s.page === "settings" ? pageHead(s) : ""}<div class="content" data-page="${s.page}">${serviceBanner()}${pageBody(s)}</div></main></div>
      ${statusbar(s)}
    </div>
    <div class="app-overlays">
      <div data-overlay="palette">${palette(s, ui.paletteQuery, ui.paletteAction)}</div>
      <div data-overlay="editor">${s.connectionEditor ? connectionDialog(s, ui.draft!, ui.testResult) : ""}</div>
      <div data-overlay="confirm">${confirmModal(s)}</div>
      <div data-overlay="toasts">${toasts(s)}</div>
    </div>`;

  updateRenderedApp(html, { focused: prevPromptFocused, selection: prevPromptSelection });
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
  // Values can be long enough to scroll the host page; keep the reader's place.
  if (prevWindowY > 0 && window.scrollY !== prevWindowY) window.scrollTo(0, prevWindowY);

  bindCharts(root);
  if (s.paletteOpen && !hadPalette) focusPalette();
  updateThemeMeta();
  document.documentElement.dataset.page = s.page;
}

/** Head for the two global pages, which are not views of an instance. */
function pageHead(s: ViewState): string {
  const conn = currentConnection();
  if (s.page === "connections") {
    return `<div class="page-head"><h1>连接管理</h1><span class="sub">${s.connections.length} 个实例 · 按分组排列在左侧</span><span class="spacer"></span><button class="btn" data-action="refresh">${icon("refresh", 12)} 刷新</button><button class="btn primary" data-action="new-connection">${icon("plus", 12)} 新建连接</button></div>`;
  }
  return `<div class="page-head"><h1>设置</h1><span class="sub">配色 · 浏览 · 命令行 · 凭据</span></div>`;
}

/** Selecting a sample in the stream pins the detail pane and the histogram. */
function selectSample(index: number) {
  const hist = currentHistory();
  const sample = hist[index];
  if (!sample) return;
  patch({ selectedSampleAt: sample.at });
}

/** Preview mode is a caption under the tabs, not a notice competing with data. */
function serviceBanner(): string {
  if (state.serviceAvailable) return "";
  return `<div class="preview-note" title="连接真实 Redis 请用 bun run dev 打开桌面窗口">${icon("info", 11)}<span>预览数据 · 未连接 Go 服务</span><span class="mono">?preview=1</span></div>`;
}

function updateThemeMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (bg) meta.setAttribute("content", bg);
  }
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
  ui.testResult = { kind: "info", text: "正在连接…" };
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
  "toggle-scheme": () => {
    const next: Scheme = settings.get("scheme") === "dark" ? "light" : "dark";
    settings.patch({ scheme: next });
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

  // scheme pickers (menu + settings)
  const schemeBtn = closest<HTMLElement>(target, "[data-pick-scheme]");
  if (schemeBtn) {
    const scheme = schemeBtn.dataset.pickScheme as Scheme;
    if (isScheme(scheme)) settings.patch({ scheme });
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
  const windowBtn = closest<HTMLElement>(target, "[data-seg-action]");
  if (windowBtn?.dataset.segAction === "window" && windowBtn.dataset.segValue) {
    ui.windowSize = windowBtn.dataset.segValue;
    setWindowSize(state, ui.windowSize);
    render();
    return;
  }
  const sampleRow = closest<HTMLElement>(target, "[data-sample]");
  if (sampleRow?.dataset.sample != null) {
    selectSample(Number(sampleRow.dataset.sample));
    return;
  }
  const cliSession = closest<HTMLElement>(target, "[data-session-tab]");
  if (cliSession?.dataset.sessionTab != null) {
    sessionSwitchPending = true;
    const conn = currentConnection();
    if (conn) {
      // Switching views another session; the painter mirrors the outgoing
      // prompt into the outgoing session before the new one is drawn.
      state.cliActive[conn.id] = Number(cliSession.dataset.sessionTab);
      notify();
    }
    return;
  }
  const cliMode = closest<HTMLElement>(target, "[data-cli-mode]");
  if (cliMode?.dataset.cliMode) {
    setCliReadOnly(cliMode.dataset.cliMode === "readonly");
    return;
  }
  if (closest(target, "[data-cli-new]")) {
    // Record the outgoing session's draft first, then open an empty one.
    saveDraft();
    addCliSession();
    return;
  }
  const swatch = closest<HTMLElement>(target, "[data-color-pick]");
  if (swatch) {
    // The picker writes into the draft and repaints only the picker: the rest
    // of the dialog keeps its values through readDraft().
    readDraft();
    if (ui.draft) ui.draft.color = swatch.dataset.colorPick || undefined;
    render();
    return;
  }

  const fill = closest<HTMLElement>(target, "[data-fill]");
  if (fill?.dataset.fill) {
    const input = document.getElementById("cli-input") as HTMLInputElement | null;
    if (input) {
      input.value = fill.dataset.fill;
      input.focus();
      // A filled suggestion is a draft like any other: it must survive the
      // next paint, which renders the prompt from the session.
      saveDraft();
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
    if (action === "palette-close" || action === "editor-close" || action === "confirm-cancel") {
      return;
    }
  }

  // scrims: only close when clicking the backdrop itself
  const scrim = target.classList?.contains("scrim") ? target : target.classList?.contains("dialog-scrim") ? target : null;
  if (scrim) {
    if (state.paletteOpen) closePalette();
 else if (state.confirm) patch({ confirm: null });
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
  if (target.id === "cli-input") {
    // The draft lives in the session so a rebuild (polling, dialogs, scheme)
    // renders the same draft back instead of an empty prompt.
    const session = activeCliSession();
    if (session) session.input = target.value;
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
      recall(target as HTMLInputElement, session, -1);
      return;
    }
    if (event.key === "ArrowDown" && session) {
      event.preventDefault();
      recall(target as HTMLInputElement, session, 1);
      return;
    }
    if (event.key !== "Enter") delete (target as HTMLInputElement).dataset.hist;
  }

  // Lists are keyboard-navigable: ↑/↓ roves the selection in the key list and
  // the sample stream, so a 45-row stream never costs 45 tab stops.
  const roving = target?.closest<HTMLElement>(".key-row") ? ".key-row" : target?.closest<HTMLElement>(".srow") ? ".srow" : null;
  if (roving && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    const rows = Array.from(root.querySelectorAll<HTMLElement>(roving));
    const index = rows.indexOf(target as HTMLElement);
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      next.focus({ preventScroll: false });
      next.click();
    }
    return;
  }

  if (event.key === "Enter" && target?.id === "key-pattern") {
    event.preventDefault();
    void scanKeys({ reset: true });
  }
  if (typing) return;
});

/**
 * Arrow keys drive the focused list row without re-binding a handler: the
 * click that follows already routes through the normal selection path.
 */
document.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const row = (event.target as HTMLElement | null)?.closest?.(".key-row, .srow") as HTMLElement | null;
  if (!row) return;
  event.preventDefault();
  const selector = row.classList.contains("key-row") ? ".key-row" : ".srow";
  const rows = Array.from(root.querySelectorAll<HTMLElement>(selector));
  const next = rows[Math.max(0, Math.min(rows.length - 1, rows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)))];
  if (next) {
    next.focus({ preventScroll: false });
    next.click();
  }
});

const COMMANDS = [
  "APPEND", "AUTH", "BGSAVE", "CLIENT", "CLUSTER", "COMMAND", "CONFIG", "DBSIZE", "DEBUG", "DEL", "EXISTS",
  "EXPIRE", "FLUSHALL", "FLUSHDB", "GET", "HDEL", "HGET", "HGETALL", "HLEN", "HSET", "INFO", "KEYS", "LLEN",
  "LPUSH", "LRANGE", "MEMORY", "MONITOR", "MSET", "OBJECT", "PERSIST", "PING", "PTTL", "RPOP", "RPUSH", "SADD",
  "SCAN", "SCARD", "SCAN", "SELECT", "SET", "SETEX", "SLOWLOG", "SMEMBERS", "SREM", "STRLEN", "TIME", "TTL",
  "TYPE", "UNLINK", "XADD", "XLEN", "XRANGE", "ZADD", "ZCARD", "ZRANGE", "ZREM",
];

/**
 * History navigation owns the draft while it is active: the recalled command
 * becomes the session's draft (so a repaint keeps it) and the cursor position
 * in the history travels with it.
 */
/**
 * The prompt is the live editing surface and owns its draft: every place that
 * can replace or lose the node calls this first, writing into the session the
 * node currently belongs to (resolved by id, never by "whatever is active").
 */
function saveDraft() {
  const input = root.querySelector<HTMLInputElement>("#cli-input");
  if (!input) return;
  const owner = Object.values(state.cliSessions).flat().find((item) => item.id === input.dataset.session);
  if (owner) owner.input = input.value;
}

function recall(input: HTMLInputElement, session: { history: string[]; input?: string }, step: -1 | 1) {
  const index = Number(input.dataset.hist ?? session.history.length);
  const next = step === -1 ? Math.max(0, index - 1) : Math.min(session.history.length, index + 1);
  input.dataset.hist = String(next);
  input.value = session.history[next] ?? "";
  session.input = input.value;
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

settings.subscribe((_, changed) => {
  if (changed.has("scheme")) render();
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
  // The screenshot fixture seeds a short history so charts read like a session
  // that has been open for a while; the real app never sets this.
  const seed = (window as unknown as { __RM_PREVIEW_SEED__?: MetricSample[] }).__RM_PREVIEW_SEED__;
  if (Array.isArray(seed) && seed.length && !(window as unknown as { __RM_SEEDED__?: boolean }).__RM_SEEDED__) {
    (window as unknown as { __RM_SEEDED__?: boolean }).__RM_SEEDED__ = true;
    // Keyed by the selected instance: loadOverview replaces its own entry.
    if (state.connId) state.history[state.connId] = seed;
    notify();
  }
  const params = new URLSearchParams(location.search);
  setWindowSize(state, ui.windowSize);
  // Preview deep links (used by scripts/shoot-all.mjs) may force a theme.
  const schemeParam = params.get("scheme");
  if (isScheme(schemeParam)) settings.patch({ scheme: schemeParam });
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

