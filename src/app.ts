import { bindCharts } from "./core/charts";
import { api, errorMessage, redis, type Connection } from "./core/api";
import { esc, splitCommandLine } from "./core/format";
import { icon } from "./core/icons";
import {
  activeCliSession,
  addCliSession,
  checkForUpdates,
  clearCliLog,
  closeCliSession,
  confirmDialog,
  createNewKey,
  currentConnection,
  currentDb,
  currentHistory,
  deleteSelectedKey,
  go,
  loadAppInfo,
  loadCredentialStorage,
  loadMonitor,
  loadOverview,
  notify,
  onChange,
  openKey,
  patch,
  refreshConnections,
  removeConnection,
  removeHashField,
  runCli,
  saveConnection,
  saveHashField,
  saveKeyTtl,
  saveStringValue,
  scanKeys,
  selectConnection,
  selectDatabase,
  selectKey,
  setCliReadOnly,
  setCredentialStorage,
  startPolling,
  state,
  stopPolling,
  testConnection,
  toast,
  type ChangeKind,
  type MetricSample,
  type PageId,
  type ViewState,
} from "./core/store";
import { settings } from "./theme/settings";
import { isScheme, type Scheme } from "./theme/themes";
import {
  browserView,
  closeStringEditor,
  currentBrowserKeyId,
  isStringEditing,
  isTtlEditing,
  newKeyDialog,
  openStringEditor,
  setTtlEditing,
  toggleExpandedCell,
  updateStringDraft,
  type NewKeyDraft,
} from "./views/browser";
import { cliView } from "./views/cli";
import { connectionDialog, connectionsView, editorDraft, type EditorDraft } from "./views/connections";
import { monitorView } from "./views/monitor";
import { overviewView, setWindowSize } from "./views/overview";
import { settingsView } from "./views/settings";
import { confirmModal, instanceHead, palette, paletteList, sidebar, statusbar, tabs, toasts, topbar } from "./ui/shell";

interface LocalUi {
  windowSize: string;
  testResult: { kind: "ok" | "err" | "info"; text: string } | null;
  draft: EditorDraft | null;
  editor: ViewState["connectionEditor"];
  newKeyDraft: NewKeyDraft | null;
  paletteQuery: string;
  paletteAction: string;
}

const ui: LocalUi = {
  windowSize: "45",
  testResult: null,
  draft: null,
  editor: null,
  newKeyDraft: null,
  paletteQuery: "",
  paletteAction: "",
};

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

const scrollMemo: Record<string, number> = {};
let firstPaint = true;
let testRequest = 0;
let sessionSwitchPending = false;
let keyRoveTimer: number | null = null;
let lastValueKeyId = "";
const hashEditVersions = new WeakMap<HTMLFormElement, number>();

function cancelKeyRove() {
  if (keyRoveTimer != null) {
    window.clearTimeout(keyRoveTimer);
    keyRoveTimer = null;
  }
}

/**
 * Strips formatting whitespace text nodes between HTML tags so they never
 * become flex/grid items inside layout containers.
 */
function parseCleanFragment(html: string): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  const stray = document.createNodeIterator(container, NodeFilter.SHOW_TEXT);
  const blanks: Text[] = [];
  for (let node = stray.nextNode(); node; node = stray.nextNode()) {
    if (!(node as Text).data.trim()) blanks.push(node as Text);
  }
  for (const node of blanks) node.remove();
  return container;
}

/**
 * Lightweight chrome-only patch for background 4s metric polling while the user
 * is working in Browser, CLI, or Settings. Leaves `.content` completely untouched
 * so large key lists, previews, text selections, and form drafts never flicker.
 */
function updateMetricsChrome(s: ViewState) {
  const conn = currentConnection();

  const liveSidebar = root.querySelector<HTMLElement>(".sidebar");
  if (liveSidebar) {
    const freshSidebar = parseCleanFragment(sidebar(s));
    const liveTitle = liveSidebar.querySelector<HTMLElement>(".sidebar-title");
    const freshTitle = freshSidebar.querySelector<HTMLElement>(".sidebar-title");
    if (liveTitle && freshTitle && liveTitle.textContent !== freshTitle.textContent) {
      liveTitle.textContent = freshTitle.textContent;
    }
    const liveConnList = liveSidebar.querySelector<HTMLElement>(".conn-list");
    const freshConnList = freshSidebar.querySelector<HTMLElement>(".conn-list");
    if (liveConnList && freshConnList && liveConnList.innerHTML !== freshConnList.innerHTML) {
      const prevTop = liveConnList.scrollTop;
      liveConnList.replaceChildren(...Array.from(freshConnList.childNodes));
      liveConnList.scrollTop = prevTop;
    }
  }

  const liveInstHead = root.querySelector<HTMLElement>(".inst-head");
  const instHtml = instanceHead(s);
  if (instHtml) {
    const dbFocused = Boolean(document.activeElement?.hasAttribute("data-db-select"));
    const liveDbSelect = liveInstHead?.querySelector<HTMLSelectElement>("[data-db-select]") ?? null;
    const freshInst = parseCleanFragment(instHtml).firstElementChild as HTMLElement | null;
    if (freshInst) {
      const freshDbSelect = freshInst.querySelector<HTMLSelectElement>("[data-db-select]");
      if (dbFocused && liveDbSelect && freshDbSelect && liveDbSelect.innerHTML === freshDbSelect.innerHTML && liveDbSelect.value === freshDbSelect.value) {
        freshDbSelect.replaceWith(liveDbSelect);
      }
      if (liveInstHead) liveInstHead.replaceWith(freshInst);
      else root.querySelector(".main")?.prepend(freshInst);
      if (dbFocused) {
        freshInst.querySelector<HTMLElement>("[data-db-select]")?.focus({ preventScroll: true });
      }
    }
  } else if (liveInstHead) {
    liveInstHead.remove();
  }

  const liveTabs = root.querySelector<HTMLElement>(".tabs");
  const freshTabs = parseCleanFragment(tabs(s)).firstElementChild as HTMLElement | null;
  if (liveTabs && freshTabs && liveTabs.outerHTML !== freshTabs.outerHTML) {
    liveTabs.replaceWith(freshTabs);
  }

  const liveStatus = root.querySelector<HTMLElement>(".statusbar");
  const freshStatus = parseCleanFragment(statusbar(s)).firstElementChild as HTMLElement | null;
  if (liveStatus && freshStatus && liveStatus.outerHTML !== freshStatus.outerHTML) {
    liveStatus.replaceWith(freshStatus);
  }

  document.title = conn ? `Redis Manager — ${conn.name || conn.host}` : "Redis Manager";
}

/**
 * Re-renders the shell from an HTML string.
 *
 * The default is a wholesale replacement, which keeps the DOM exactly equal to
 * the template. Only subtrees whose live identity matters survive a paint:
 * an open dialog's form, an open document (iframe), a focused CLI prompt, an
 * active text selection, and the scroll position of the lists the user is reading.
 */
function updateRenderedApp(
  html: string,
  promptState: {
    focused: boolean;
    selection: { start: number | null; end: number | null; direction: "forward" | "backward" | "none" | null } | null;
  } = { focused: false, selection: null },
) {
  const next = parseCleanFragment(html);

  const promptFocus = promptState.focused;
  const formText = readFormValues(root.querySelector("#connection-form"), "data-field");
  const newKeyFormText = readFormValues(root.querySelector("#new-key-form"), "data-nk-field");
  const keep = new Map<string, Element>();
  for (const selector of [
    ".html-preview",
    "#cli-input",
    "#cli-log",
    ".value-body",
    ".key-list",
    ".stream-body",
    ".tbl-wrap",
    "#hash-form",
    "#string-form",
    "#ttl-form",
    ".filterbar",
  ]) {
    const live = root.querySelector(selector);
    if (live) keep.set(selector, live);
  }

  // Capture non-collapsed user text selection inside `.value-body` or `#cli-log`
  // as raw node/offset endpoints (a live `Range` would be collapsed to `(root, 0)`
  // by the DOM standard when `replaceChildren` detaches the old `.app` subtree).
  const sel = window.getSelection();
  let selectionKeepSelector: ".value-body" | "#cli-log" | null = null;
  let selectionSavedEndpoints: {
    startContainer: Node;
    startOffset: number;
    endContainer: Node;
    endOffset: number;
  } | null = null;
  if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const anchor = range.commonAncestorContainer;
    const liveValue = keep.get(".value-body");
    const liveLog = keep.get("#cli-log");
    if (liveValue && liveValue.contains(anchor)) {
      selectionKeepSelector = ".value-body";
      selectionSavedEndpoints = {
        startContainer: range.startContainer,
        startOffset: range.startOffset,
        endContainer: range.endContainer,
        endOffset: range.endOffset,
      };
    } else if (liveLog && liveLog.contains(anchor)) {
      selectionKeepSelector = "#cli-log";
      selectionSavedEndpoints = {
        startContainer: range.startContainer,
        startOffset: range.startOffset,
        endContainer: range.endContainer,
        endOffset: range.endOffset,
      };
    }
  }

  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const focusedKeyRow = active?.classList.contains("key-row") ? active.dataset.key ?? null : null;
  const focusedSampleRow = active?.classList.contains("srow") ? active.dataset.sample ?? null : null;
  const focusId =
    active && active !== document.body && active.id && active.id !== "cli-input"
      ? active.id
      : active?.dataset.setting
        ? `[data-setting="${active.dataset.setting}"]`
        : active?.hasAttribute("data-db-select")
          ? "[data-db-select]"
          : "";
  const focusSelection =
    focusId && typeof active?.selectionStart === "number"
      ? {
          start: active.selectionStart,
          end: active.selectionEnd ?? active.selectionStart,
          direction: active.selectionDirection ?? "none",
        }
      : null;

  const listScroll = new Map<string, number>();
  for (const [selector, live] of keep) {
    if (live instanceof HTMLElement) listScroll.set(selector, live.scrollTop);
  }

  root.replaceChildren(...Array.from(next.childNodes));
  firstPaint = false;

  // Preserve active text selection in `.value-body` or `#cli-log` across toast / chrome updates.
  if (selectionKeepSelector) {
    const liveSelHost = keep.get(selectionKeepSelector);
    const freshSelHost = root.querySelector(selectionKeepSelector);
    if (
      liveSelHost &&
      freshSelHost &&
      liveSelHost !== freshSelHost &&
      liveSelHost.className === freshSelHost.className &&
      liveSelHost.innerHTML === freshSelHost.innerHTML
    ) {
      freshSelHost.replaceWith(liveSelHost);
      if (selectionSavedEndpoints) {
        const afterSel = window.getSelection();
        if (afterSel) {
          try {
            const restored = document.createRange();
            restored.setStart(selectionSavedEndpoints.startContainer, selectionSavedEndpoints.startOffset);
            restored.setEnd(selectionSavedEndpoints.endContainer, selectionSavedEndpoints.endOffset);
            afterSel.removeAllRanges();
            afterSel.addRange(restored);
          } catch {
            /* ignore if range cannot be restored */
          }
        }
      }
    }
  }

  // A live document is only carried over when its own markup is unchanged.
  const liveFrame = keep.get(".html-preview");
  const freshFrame = root.querySelector(".html-preview");
  if (liveFrame && freshFrame && liveFrame !== freshFrame) {
    const same = (liveFrame as HTMLElement).outerHTML === (freshFrame as HTMLElement).outerHTML;
    if (same) freshFrame.replaceWith(liveFrame);
  }

  // Carry over per-key inline forms (`#hash-form`, `#string-form`, `#ttl-form`) while editing the same key.
  for (const formSel of ["#hash-form", "#string-form", "#ttl-form"] as const) {
    const liveForm = keep.get(formSel);
    const freshForm = root.querySelector(formSel);
    if (liveForm && freshForm && liveForm !== freshForm && liveForm.getAttribute("data-key") === freshForm.getAttribute("data-key")) {
      freshForm.replaceWith(liveForm);
      if (active && liveForm.contains(active)) {
        const activeField = active.name ? liveForm.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${active.name}"]`) : active;
        if (activeField) {
          activeField.focus({ preventScroll: true });
          if (focusSelection && typeof activeField.setSelectionRange === "function") {
            try {
              activeField.setSelectionRange(focusSelection.start, focusSelection.end, focusSelection.direction);
            } catch {
              /* number inputs reject ranges */
            }
          }
        }
      }
    }
  }

  // Carry over filterbar text inputs (`#key-pattern` and `#key-filter`) when their text matches,
  // while letting `.filterbar-meta`, grouping chip, and New Key button update freely.
  const liveFilters = keep.get(".filterbar") as HTMLElement | undefined;
  const freshFilters = root.querySelector<HTMLElement>(".filterbar");
  if (liveFilters && freshFilters && liveFilters !== freshFilters) {
    for (const inputId of ["#key-pattern", "#key-filter"]) {
      const liveInput = liveFilters.querySelector<HTMLInputElement>(inputId);
      const freshInput = freshFilters.querySelector<HTMLInputElement>(inputId);
      if (liveInput && freshInput && liveInput.value === freshInput.value) {
        freshInput.replaceWith(liveInput);
        if (active === liveInput) {
          liveInput.focus({ preventScroll: true });
          if (focusSelection) liveInput.setSelectionRange(focusSelection.start, focusSelection.end, focusSelection.direction);
        }
      }
    }
  }

  const livePrompt = keep.get("#cli-input");
  const freshPrompt = root.querySelector("#cli-input");
  if (livePrompt && freshPrompt && livePrompt !== freshPrompt) {
    const sameSession = (livePrompt as HTMLInputElement).dataset.session === (freshPrompt as HTMLInputElement).dataset.session;
    const sameValue = (livePrompt as HTMLInputElement).value === (freshPrompt as HTMLInputElement).value;
    if (sameSession && sameValue) {
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

  restoreFormValues(root.querySelector<HTMLFormElement>("#connection-form"), formText, "data-field");
  restoreFormValues(root.querySelector<HTMLFormElement>("#new-key-form"), newKeyFormText, "data-nk-field");

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
  } else if (focusedKeyRow != null) {
    Array.from(root.querySelectorAll<HTMLElement>(".key-row"))
      .find((el) => el.dataset.key === focusedKeyRow)
      ?.focus({ preventScroll: true });
  } else if (focusedSampleRow != null) {
    Array.from(root.querySelectorAll<HTMLElement>(".srow"))
      .find((el) => el.dataset.sample === focusedSampleRow)
      ?.focus({ preventScroll: true });
  }
  root.querySelector(".app")?.classList.remove("entering");
}

function readFormValues(form: Element | null, attr: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!form) return out;
  for (const el of Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[${attr}]`))) {
    out.set(el.getAttribute(attr) ?? "", el.value);
  }
  return out;
}

function restoreFormValues(form: HTMLFormElement | null, values: Map<string, string>, attr: string) {
  if (!form || !values.size) return;
  for (const el of Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[${attr}]`))) {
    const value = values.get(el.getAttribute(attr) ?? "");
    if (value != null && el.value !== value) el.value = value;
  }
}

function pageBody(s: ViewState): string {
  const view = PAGE_VIEWS[s.page] ?? overviewView;
  try {
    return view(s);
  } catch (error) {
    return `<div class="notice err">页面渲染失败：${esc(errorMessage(error))}</div>`;
  }
}

function render(kind: ChangeKind = "full") {
  const s = state;
  if (
    kind === "metrics" &&
    !firstPaint &&
    (s.page === "browser" || s.page === "cli" || s.page === "settings") &&
    !s.paletteOpen &&
    !s.connectionEditor &&
    !s.confirm &&
    !ui.newKeyDraft &&
    s.serviceAvailable
  ) {
    updateMetricsChrome(s);
    return;
  }

  const conn = currentConnection();
  if (s.connectionEditor) readDraft();
  syncEditorDraft();
  if (ui.newKeyDraft) readNewKeyDraft();
  if (ui.newKeyDraft && (!conn || conn.readOnly)) ui.newKeyDraft = null;

  const hadPalette = Boolean(root.querySelector("#palette-input"));
  const currentValKey = currentBrowserKeyId(s);
  const sameValueKey = currentValKey === lastValueKeyId;
  lastValueKeyId = currentValKey;

  const prevContent = root.querySelector<HTMLElement>(".content");
  if (prevContent && s.page) scrollMemo[`${s.page}:${s.connId}`] = prevContent.scrollTop;
  const prevLog = root.querySelector<HTMLElement>("#cli-log");
  const prevLogAtBottom = prevLog ? prevLog.scrollHeight - prevLog.scrollTop - prevLog.clientHeight < 24 : true;
  const prevLogCount = prevLog?.childElementCount ?? 0;
  if (prevLog) scrollMemo["cli"] = prevLog.scrollTop;
  const prevValue = root.querySelector<HTMLElement>(".value-body");
  scrollMemo["value"] = sameValueKey && prevValue ? prevValue.scrollTop : 0;
  const prevTbl = root.querySelector<HTMLElement>(".tbl-wrap");
  scrollMemo["tbl"] = sameValueKey && prevTbl ? prevTbl.scrollTop : 0;
  const prevKeys = root.querySelector<HTMLElement>(".key-list");
  if (prevKeys) scrollMemo["keys"] = prevKeys.scrollTop;
  const prevWindowY = window.scrollY;
  const prevPrompt = root.querySelector<HTMLInputElement>("#cli-input");

  const prevPromptFocused = document.activeElement === prevPrompt;
  const prevPromptSelection = prevPrompt
    ? { start: prevPrompt.selectionStart, end: prevPrompt.selectionEnd, direction: prevPrompt.selectionDirection }
    : null;
  if (prevPrompt && !sessionSwitchPending) saveDraft();
  sessionSwitchPending = false;

  const html = `
    <div class="app${firstPaint ? " entering" : ""}">
      ${topbar(s)}
      <div class="workspace">${sidebar(s)}<main class="main">${instanceHead(s)}${tabs(s)}${s.page === "connections" || s.page === "settings" ? pageHead(s) : ""}<div class="content" data-page="${s.page}">${serviceBanner()}${pageBody(s)}</div></main></div>
      ${statusbar(s)}
    </div>
    <div class="app-overlays">
      <div data-overlay="palette">${palette(s, ui.paletteQuery, ui.paletteAction)}</div>
      <div data-overlay="editor">${s.connectionEditor ? connectionDialog(s, ui.draft!, ui.testResult) : ""}</div>
      <div data-overlay="new-key">${newKeyDialog(ui.newKeyDraft)}</div>
      <div data-overlay="confirm">${confirmModal(s)}</div>
      <div data-overlay="toasts">${toasts(s)}</div>
    </div>`;

  updateRenderedApp(html, { focused: prevPromptFocused, selection: prevPromptSelection });
  document.title = conn ? `Redis Manager — ${conn.name || conn.host}` : "Redis Manager";

  const content = root.querySelector<HTMLElement>(".content");
  const memoKey = `${s.page}:${s.connId}`;
  if (content && scrollMemo[memoKey] != null) content.scrollTop = scrollMemo[memoKey]!;
  const log = root.querySelector<HTMLElement>("#cli-log");
  if (log) {
    log.scrollTop = log.childElementCount > prevLogCount && prevLogAtBottom ? log.scrollHeight : (scrollMemo["cli"] ?? log.scrollHeight);
  }
  const valueBody = root.querySelector<HTMLElement>(".value-body");
  if (valueBody) valueBody.scrollTop = scrollMemo["value"] ?? 0;
  const tblWrap = root.querySelector<HTMLElement>(".tbl-wrap");
  if (tblWrap) tblWrap.scrollTop = scrollMemo["tbl"] ?? 0;
  const keyList = root.querySelector<HTMLElement>(".key-list");
  if (keyList && scrollMemo["keys"]) keyList.scrollTop = scrollMemo["keys"]!;
  if (prevWindowY > 0 && window.scrollY !== prevWindowY) window.scrollTo(0, prevWindowY);

  bindCharts(root);
  if (s.paletteOpen && !hadPalette) focusPalette();
  updateThemeMeta();
  document.documentElement.dataset.page = s.page;
}

/** Head for the two global pages, which are not views of an instance. */
function pageHead(s: ViewState): string {
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
/* Editor & New-Key form helpers                                       */
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
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("#connection-form [data-field]").forEach((el) => {
    const name = el.dataset.field as keyof EditorDraft;
    const raw = el.value;
    if (name === "port" || name === "db") (draft as unknown as Record<string, unknown>)[name] = Number(raw) || 0;
    else (draft as unknown as Record<string, unknown>)[name] = raw;
  });
  ui.draft = draft;
  return draft;
}

function draftConnection(draft: EditorDraft): Connection {
  return {
    id: draft.id,
    name: draft.name,
    group: draft.group,
    host: draft.host,
    port: draft.port || 6379,
    db: Number.isFinite(draft.db) && draft.db >= 0 ? draft.db : 0,
    mode: draft.mode,
    username: draft.username ?? "",
    tls: Boolean(draft.tls),
    tlsSkipVerify: Boolean(draft.tls && draft.tlsSkipVerify),
    readOnly: Boolean(draft.readOnly),
    color: draft.color,
    seedNodes: draft.seedNodes ?? "",
    sentinelMaster: draft.sentinelMaster ?? "",
  };
}

function readNewKeyDraft(): NewKeyDraft | null {
  if (!ui.newKeyDraft) return null;
  const draft: NewKeyDraft = { ...ui.newKeyDraft };
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("#new-key-form [data-nk-field]").forEach((el) => {
    const name = el.dataset.nkField as keyof NewKeyDraft;
    if (name === "type") draft.type = el.value === "hash" ? "hash" : "string";
    else draft[name] = el.value;
  });
  ui.newKeyDraft = draft;
  return draft;
}

async function onSaveNewKey() {
  const conn = currentConnection();
  if (!conn || conn.readOnly) return;
  const draft = readNewKeyDraft();
  if (!draft) return;
  const key = draft.key.trim();
  if (!key) {
    toast("err", "请填写键名");
    document.getElementById("nk-key")?.focus();
    return;
  }
  if (draft.type === "hash" && !draft.field.trim()) {
    toast("err", "请填写初始字段名");
    document.getElementById("nk-field")?.focus();
    return;
  }
  const ttlRaw = draft.ttl.trim();
  let ttlSeconds: number | undefined;
  if (ttlRaw !== "") {
    const parsed = Math.floor(Number(ttlRaw));
    if (!Number.isFinite(parsed) || parsed === 0 || parsed < -1) {
      toast("err", "无效的 TTL", "请输入正整数秒数，或留空设为持久");
      document.getElementById("nk-ttl")?.focus();
      return;
    }
    if (parsed > 0) ttlSeconds = parsed;
  }
  const ok = await createNewKey({
    key,
    type: draft.type,
    value: draft.value,
    field: draft.type === "hash" ? draft.field.trim() : undefined,
    ttlSeconds,
  });
  if (ok) {
    ui.newKeyDraft = null;
    render();
  }
}

async function onSubmitTtl(form: HTMLFormElement) {
  const conn = currentConnection();
  if (!conn || conn.readOnly) return;
  const raw = String(new FormData(form).get("ttl") ?? "").trim();
  const ttlSeconds = raw === "" ? -1 : Math.floor(Number(raw));
  if (!Number.isFinite(ttlSeconds) || ttlSeconds === 0 || ttlSeconds < -1) {
    toast("err", "无效的 TTL", "请输入正整数秒数，或 -1 设为持久");
    return;
  }
  const ok = await saveKeyTtl(ttlSeconds);
  if (ok) {
    setTtlEditing(false);
    render();
  }
}

async function onSubmitString(form: HTMLFormElement) {
  const conn = currentConnection();
  if (!conn || conn.readOnly) return;
  const value = String(new FormData(form).get("value") ?? "");
  const ok = await saveStringValue(value);
  if (ok) {
    closeStringEditor();
    render();
  }
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
    const result = await redis.testConnection(conn, draft.password ?? "");
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
  const ok = await saveConnection(conn, draft.password ?? "");
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

function openCloneEditor(id: string) {
  const src = state.connections.find((c) => c.id === id);
  if (!src) return;
  const editor = { mode: "new" as const };
  ui.editor = editor;
  ui.draft = {
    id: `conn-${Date.now().toString(36)}`,
    name: `${src.name || `${src.host}:${src.port}`} (副本)`,
    group: src.group,
    host: src.host,
    port: src.port,
    db: src.db,
    mode: src.mode,
    username: src.username ?? "",
    tls: Boolean(src.tls),
    tlsSkipVerify: Boolean(src.tlsSkipVerify),
    readOnly: Boolean(src.readOnly),
    color: src.color,
    seedNodes: src.seedNodes ?? "",
    sentinelMaster: src.sentinelMaster ?? "",
    password: "",
  };
  ui.testResult = null;
  testRequest += 1;
  patch({ connectionEditor: editor });
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
  palette: () => openPalette(),
  "palette-close": () => closePalette(),
  "toggle-scheme": () => {
    const next: Scheme = settings.get("scheme") === "dark" ? "light" : "dark";
    settings.patch({ scheme: next });
  },
  "toggle-grouping": () => settings.patch({ keyGrouping: !settings.get("keyGrouping") }),
  "go-cli": () => go("cli"),
  "scan-reset": () => scanKeys({ reset: true }),
  "scan-more": () => scanKeys({ append: true }),
  "new-key": () => {
    const conn = currentConnection();
    if (!conn || conn.readOnly) return;
    ui.newKeyDraft = { key: "", type: "string", field: "", value: "", ttl: "" };
    render();
    document.getElementById("nk-key")?.focus();
  },
  "new-key-close": () => {
    if (!ui.newKeyDraft) return;
    ui.newKeyDraft = null;
    render();
  },
  "save-new-key": () => onSaveNewKey(),
  "reload-value": () => (state.selectedKey ? openKey(state.selectedKey) : undefined),
  "copy-key": () => {
    const key = state.value?.key ?? state.selectedKey;
    if (key) void copy(key);
  },
  "copy-value": () => {
    const v = state.value;
    if (!v) return;
    let text = "";
    if (v.type === "string") text = v.stringValue ?? "";
    else if (v.type === "hash") text = JSON.stringify(v.hash ?? {}, null, 2);
    else if (v.type === "list") text = JSON.stringify(v.list ?? [], null, 2);
    else if (v.type === "set") text = JSON.stringify(v.set ?? [], null, 2);
    else if (v.type === "zset") text = JSON.stringify(v.zset ?? [], null, 2);
    else if (v.type === "stream") text = JSON.stringify(v.stream ?? [], null, 2);
    void copy(text);
  },
  "edit-ttl": () => {
    const conn = currentConnection();
    const v = state.value;
    if (!conn || conn.readOnly || !v) return;
    setTtlEditing(true, currentBrowserKeyId(state));
    render();
    const input = document.getElementById("ttl-input") as HTMLInputElement | null;
    input?.focus();
    input?.select();
  },
  "cancel-ttl": () => {
    setTtlEditing(false);
    render();
  },
  "persist-ttl": async () => {
    const conn = currentConnection();
    if (!conn || conn.readOnly) return;
    const ok = await saveKeyTtl(-1);
    if (ok) {
      setTtlEditing(false);
      render();
    }
  },
  "toggle-string-edit": () => {
    const conn = currentConnection();
    const v = state.value;
    if (!conn || conn.readOnly || !v || v.type !== "string" || v.truncated) return;
    const keyId = currentBrowserKeyId(state);
    if (isStringEditing(keyId)) {
      closeStringEditor();
      render();
      return;
    }
    openStringEditor(keyId, v.stringValue ?? "");
    render();
    document.getElementById("string-editor-input")?.focus();
  },
  "cancel-string-edit": () => {
    closeStringEditor();
    render();
  },
  "delete-key": () => {
    const value = state.value;
    const conn = currentConnection();
    if (!value || !conn || conn.readOnly) return;
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
    confirmDialog({
      title: "恢复默认设置",
      body: "主题、浏览、CLI 与密码存储偏好都会回到初始值。",
      confirmLabel: "恢复",
      onConfirm: () => {
        settings.reset();
        if (state.credentialStorage !== "local") void setCredentialStorage("local");
      },
    });
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
      cancelKeyRove();
      go("browser");
      void openKey(payload);
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
  const keyRow = closest<HTMLElement>(target, ".key-row[data-key]");
  if (keyRow?.dataset.key) {
    cancelKeyRove();
    void openKey(keyRow.dataset.key);
    return;
  }
  const expandBtn = closest<HTMLElement>(target, "[data-expand-cell]");
  if (expandBtn?.dataset.expandCell) {
    toggleExpandedCell(expandBtn.dataset.expandCell);
    render();
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
    if (["raw", "json", "hex", "html", "markdown"].includes(mode)) {
      if (isStringEditing()) closeStringEditor();
      patch({ valueMode: mode });
    }
    return;
  }
  if (segValue?.dataset.segAction === "window" && segValue.dataset.segValue) {
    ui.windowSize = segValue.dataset.segValue;
    setWindowSize(state, ui.windowSize);
    render();
    return;
  }
  const sampleRow = closest<HTMLElement>(target, "[data-sample]");
  if (sampleRow?.dataset.sample != null) {
    selectSample(Number(sampleRow.dataset.sample));
    return;
  }
  const cliClose = closest<HTMLElement>(target, "[data-cli-close]");
  if (cliClose?.dataset.cliClose != null) {
    saveDraft();
    sessionSwitchPending = true;
    closeCliSession(Number(cliClose.dataset.cliClose));
    return;
  }
  const cliSession = closest<HTMLElement>(target, "[data-session-tab]");
  if (cliSession?.dataset.sessionTab != null) {
    sessionSwitchPending = true;
    const conn = currentConnection();
    if (conn) {
      state.cliActive[conn.id] = Number(cliSession.dataset.sessionTab);
      notify();
    }
    return;
  }
  const cliMode = closest<HTMLElement>(target, "[data-cli-mode]");
  if (cliMode?.dataset.cliMode) {
    if ((cliMode as HTMLButtonElement).disabled || (cliMode.dataset.cliMode === "write" && currentConnection()?.readOnly)) return;
    setCliReadOnly(cliMode.dataset.cliMode === "readonly");
    return;
  }
  if (closest(target, "[data-cli-new]")) {
    saveDraft();
    addCliSession();
    return;
  }
  const swatch = closest<HTMLElement>(target, "[data-color-pick]");
  if (swatch) {
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
      saveDraft();
    }
    return;
  }
  const formToggle =
    closest<HTMLElement>(target, "[data-form-toggle]") ??
    closest<HTMLElement>(target, ".toggle-field")?.querySelector<HTMLElement>("[data-form-toggle]") ??
    null;
  if (formToggle) {
    const key = formToggle.dataset.formToggle as "tls" | "tlsSkipVerify" | "readOnly";
    readDraft();
    if (ui.draft) {
      ui.draft[key] = !ui.draft[key];
      if (key === "tls" && !ui.draft.tls) ui.draft.tlsSkipVerify = false;
    }
    render();
    return;
  }
  if (closest(target, "#cli-clear")) {
    clearCliLog();
    return;
  }

  // generic actions
  const stopEl = closest<HTMLElement>(target, "[data-stop]");
  const candidateAction = closest<HTMLElement>(target, "[data-action]");
  const actionEl = candidateAction && (!stopEl || stopEl.contains(candidateAction)) ? candidateAction : null;
  if (actionEl) {
    const action = actionEl.dataset.action ?? "";
    if (action === "edit-connection") {
      openEditor("edit", actionEl.dataset.id);
      return;
    }
    if (action === "clone-connection" && actionEl.dataset.id) {
      openCloneEditor(actionEl.dataset.id);
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
    if (action === "copy" && actionEl.dataset.copy != null) {
      void copy(actionEl.dataset.copy);
      return;
    }
    if (action === "delete-hash-field" && actionEl.dataset.field != null) {
      const field = actionEl.dataset.field;
      const conn = currentConnection();
      const v = state.value;
      if (!conn || conn.readOnly || !v) return;
      confirmDialog({
        title: "删除 Hash 字段",
        body: `确认从 ${v.key} 中删除字段「${field}」？此操作不可恢复。`,
        confirmLabel: "删除字段",
        danger: true,
        onConfirm: () => void removeHashField(field),
      });
      return;
    }
    const fn = actions[action];
    if (fn) {
      void fn();
      return;
    }
    if (action === "palette-close" || action === "editor-close" || action === "confirm-cancel" || action === "new-key-close") {
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
    } else if (ui.newKeyDraft) {
      ui.newKeyDraft = null;
      render();
    }
  }
});

document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (target.matches("#connection-form [data-field]")) {
    readDraft();
    return;
  }
  if (target.matches("#new-key-form [data-nk-field]")) {
    readNewKeyDraft();
    return;
  }
  if (target.id === "string-editor-input") {
    updateStringDraft(target.value);
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
      const view = browserView({ ...state, keyQuery: target.value } as ViewState);
      const temp = parseCleanFragment(view);
      const fresh = temp.querySelector(".key-list");
      if (fresh) list.replaceChildren(...Array.from(fresh.childNodes));
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
  if (target.matches("#new-key-form [data-nk-field]")) {
    readNewKeyDraft();
    if (target.dataset.nkField === "type") render();
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
  if (key === "credentialStorage") {
    void setCredentialStorage(target.value === "keychain" ? "keychain" : "local");
    return;
  }
  if (key === "scanCount" || key === "cliHistoryLimit" || key === "maxValueBytes") {
    settings.patch({ [key]: Number(target.value) } as never);
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  event.preventDefault();
  if (form.id === "cli-form") {
    const input = form.querySelector<HTMLInputElement>("#cli-input");
    if (!input?.value.trim()) return;
    const value = input.value;
    input.value = "";
    delete input.dataset.hist;
    void runCli(value);
    return;
  }
  if (form.id === "hash-form") {
    if (currentConnection()?.readOnly) return;
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
  if (form.id === "ttl-form") {
    void onSubmitTtl(form);
    return;
  }
  if (form.id === "string-form") {
    void onSubmitString(form);
    return;
  }
  if (form.id === "new-key-form") {
    void onSaveNewKey();
    return;
  }
  if (form.id === "connection-form") {
    void onSaveConnection();
  }
});

document.addEventListener("keydown", (event) => {
  const mod = event.metaKey || event.ctrlKey;
  const target = (event.target instanceof HTMLElement ? event.target : null) as HTMLElement | null;
  const typing = Boolean(target?.matches("input, textarea, select") || target?.isContentEditable);

  if (event.key === "Escape") {
    if (state.paletteOpen) return void closePalette();
    if (state.confirm) return void patch({ confirm: null });
    if (state.connectionEditor) return void actions["editor-close"]!();
    if (ui.newKeyDraft) return void actions["new-key-close"]!();
    if (isTtlEditing()) {
      setTtlEditing(false);
      render();
      return;
    }
    if (isStringEditing()) {
      closeStringEditor();
      render();
      return;
    }
    return;
  }

  if (mod && event.key.toLowerCase() === "s" && target?.id === "string-editor-input") {
    event.preventDefault();
    const form = target.closest<HTMLFormElement>("#string-form");
    if (form) void onSubmitString(form);
    return;
  }

  if ((event.key === " " || event.key === "Enter") && target?.hasAttribute("data-form-toggle")) {
    event.preventDefault();
    target.click();
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
    if (state.page === "monitor") return void loadMonitor();
    if (state.page === "browser") return void scanKeys({ reset: true });
    if (state.page === "connections") return void refreshConnections();
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
        if (session) session.input = input.value;
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

  // Keyboard roving in key list and sample stream (single listener; `.key-row`
  // debounces remote `GetValue` by 90ms so holding ↑/↓ stays responsive).
  const row = target?.closest<HTMLElement>(".key-row, .srow") ?? null;
  if (row && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    const isKeyRow = row.classList.contains("key-row");
    const selector = isKeyRow ? ".key-row" : ".srow";
    const rows = Array.from(root.querySelectorAll<HTMLElement>(selector));
    const index = rows.indexOf(row);
    if (index < 0) return;
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (!next || next === row) return;
    next.focus({ preventScroll: false });
    if (isKeyRow) {
      const nextKey = next.dataset.key;
      if (nextKey) {
        rows.forEach((el) => {
          const active = el === next;
          el.classList.toggle("active", active);
          el.tabIndex = active ? 0 : -1;
          el.setAttribute("aria-current", String(active));
        });
        selectKey(nextKey);
        const roveConn = state.connId;
        const roveDb = currentDb();
        cancelKeyRove();
        keyRoveTimer = window.setTimeout(() => {
          keyRoveTimer = null;
          if (state.page === "browser" && state.connId === roveConn && currentDb() === roveDb && state.selectedKey === nextKey) {
            void openKey(nextKey);
          }
        }, 90);
      }
    } else if (next.dataset.sample != null) {
      selectSample(Number(next.dataset.sample));
    }
    return;
  }

  if (event.key === "Enter" && target?.id === "key-pattern") {
    event.preventDefault();
    void scanKeys({ reset: true });
    return;
  }
  if (typing) return;
});

const COMMANDS = [
  "APPEND", "AUTH", "BGSAVE", "CLIENT", "CLUSTER", "COMMAND", "CONFIG", "DBSIZE", "DEBUG", "DEL", "EXISTS",
  "EXPIRE", "FLUSHALL", "FLUSHDB", "GET", "HDEL", "HGET", "HGETALL", "HLEN", "HSET", "INFO", "KEYS", "LLEN",
  "LPUSH", "LRANGE", "MEMORY", "MONITOR", "MSET", "OBJECT", "PERSIST", "PING", "PTTL", "RPOP", "RPUSH", "SADD",
  "SCAN", "SCARD", "SELECT", "SET", "SETEX", "SLOWLOG", "SMEMBERS", "SREM", "STRLEN", "TIME", "TTL",
  "TYPE", "UNLINK", "XADD", "XLEN", "XRANGE", "ZADD", "ZCARD", "ZRANGE", "ZREM",
];

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

onChange((kind) => render(kind));

async function boot() {
  window.__RM_BOOTED__ = (window.__RM_BOOTED__ ?? []).concat(["boot"]);
  settings.applyTheme();
  render();
  window.__RM_READY__ = true;
  window.__RM_SERVICE__ = state.serviceAvailable;
  window.__RM_DEBUG__ = { outside: window.__RM_OUTSIDE__, available: api.available, hasWindowSvc: Boolean(window.RedisService) };
  void loadAppInfo();
  void loadCredentialStorage();
  await refreshConnections();
  const seed = (window as unknown as { __RM_PREVIEW_SEED__?: MetricSample[] }).__RM_PREVIEW_SEED__;
  if (Array.isArray(seed) && seed.length && !(window as unknown as { __RM_SEEDED__?: boolean }).__RM_SEEDED__) {
    (window as unknown as { __RM_SEEDED__?: boolean }).__RM_SEEDED__ = true;
    if (state.connId) state.history[state.connId] = seed;
    notify();
  }
  const params = new URLSearchParams(location.search);
  setWindowSize(state, ui.windowSize);
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
