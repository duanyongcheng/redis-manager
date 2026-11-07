import { api, errorMessage, redis, type Connection, type KeyPage, type MonitorSnapshot, type OverviewSnapshot, type RedisValue } from "./api";
import { settings } from "../theme/settings";

export type PageId = "overview" | "browser" | "cli" | "monitor" | "connections" | "settings";
export type ConnStatus = "on" | "warn" | "off";
export type ValueViewMode = "raw" | "json" | "hex" | "html" | "markdown";

export interface ConnectionView extends Connection {
  status: ConnStatus;
  version: string;
  latencyMs: number;
  error?: string;
}

export interface MetricSample {
  at: number;
  ops: number;
  clients: number;
  used: number;
  latency: number;
  netIn: number;
  netOut: number;
}

export interface CliLine {
  kind: string;
  text: string;
}

export interface CliSession {
  id: string;
  name: string;
  lines: { id: number; at: number; command?: string; lines: CliLine[]; readOnly?: boolean; input?: string }[];
  readOnly: boolean;
  history: string[];
}

export interface Toast {
  id: number;
  kind: "ok" | "err" | "info";
  title: string;
  detail?: string;
}

export interface KeyTreeGroup {
  prefix: string;
  keys: ConnectionKey[];
  total: number;
  collapsed: boolean;
}

export interface ConnectionKey {
  key: string;
  type: string;
  ttlMs: number;
  sizeBytes: number;
  encoding: string;
}

export interface ViewState {
  page: PageId;
  /** Page for each connection so switching servers keeps the last tab. */
  pageByConn: Record<string, PageId>;
  connId: string | null;
  /** The database currently being viewed for each connection. */
  dbByConn: Record<string, number>;
  connections: ConnectionView[];
  loadingConnections: boolean;
  globalError: string;
  serviceAvailable: boolean;

  overview: Record<string, OverviewSnapshot>;
  history: Record<string, MetricSample[]>;
  monitor: Record<string, MonitorSnapshot>;

  keys: ConnectionKey[];
  keyPattern: string;
  keyCursor: number;
  keyDone: boolean;
  keyScanned: number;
  scanning: boolean;
  keyType: string;
  keyQuery: string;
  selectedKey: string | null;
  valueMode: ValueViewMode;
  value: RedisValue | null;
  valueLoading: boolean;
  valueError: string;
  collapsedGroups: Record<string, boolean>;

  cliSessions: Record<string, CliSession[]>;
  cliActive: Record<string, number>;

  paletteOpen: boolean;
  connectionEditor: { mode: "new" | "edit"; id?: string } | null;
  confirm: { title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => void } | null;
  toasts: Toast[];
  lockOpen: boolean;
  sidebarOpen: boolean;
}

const HISTORY_LIMIT = 90;
const keyOf = (connId: string) => connId;
const overviewRequests = new Map<string, Promise<void>>();

export const state: ViewState = {
  page: "overview",
  pageByConn: {},
  connId: null,
  dbByConn: {},
  connections: [],
  loadingConnections: false,
  globalError: "",
  serviceAvailable: api.available,
  overview: {},
  history: {},
  monitor: {},
  keys: [],
  keyPattern: "*",
  keyCursor: 0,
  keyDone: false,
  keyScanned: 0,
  scanning: false,
  keyType: "all",
  keyQuery: "",
  selectedKey: null,
  valueMode: "raw",
  value: null,
  valueLoading: false,
  valueError: "",
  collapsedGroups: {},
  cliSessions: {},
  cliActive: {},
  paletteOpen: false,
  connectionEditor: null,
  confirm: null,
  toasts: [],
  lockOpen: false,
  sidebarOpen: false,
};

type Listener = () => void;
const listeners = new Set<Listener>();
let scheduled = false;

export function onChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Batches every mutation from one tick into a single re-render. */
export function notify() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const listener of listeners) listener();
  });
}

export function patch(partial: Partial<ViewState>) {
  Object.assign(state, partial);
  notify();
}

let toastSeq = 0;
export function toast(kind: Toast["kind"], title: string, detail?: string) {
  const id = (toastSeq += 1);
  state.toasts = [...state.toasts, { id, kind, title, detail }];
  notify();
  window.setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== id);
    notify();
  }, kind === "err" ? 7000 : 3800);
}

export function confirmDialog(options: { title: string; body: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void }) {
  state.confirm = { confirmLabel: "确认", ...options };
  notify();
}

/* ------------------------------------------------------------------ */
/* Derived selectors                                                   */
/* ------------------------------------------------------------------ */

export function currentConnection(): ConnectionView | null {
  return state.connections.find((c) => c.id === state.connId) ?? state.connections[0] ?? null;
}

export function currentDb(conn: ConnectionView | null = currentConnection()): number {
  if (!conn) return 0;
  if (conn.mode.toLowerCase() === "cluster") return 0;
  const selected = state.dbByConn[conn.id];
  if (typeof selected === "number" && Number.isInteger(selected) && selected >= 0) return selected;
  return Number.isInteger(conn.db) && conn.db >= 0 ? conn.db : 0;
}

export function availableDatabases(conn: ConnectionView | null = currentConnection()): number[] {
  if (!conn) return [];
  if (conn.mode.toLowerCase() === "cluster") return [0];
  const values = new Set<number>(Array.from({ length: 16 }, (_, db) => db));
  values.add(currentDb(conn));
  for (const keyspace of state.overview[conn.id]?.keyspaces ?? []) {
    if (Number.isInteger(keyspace.db) && keyspace.db >= 0) values.add(keyspace.db);
  }
  return [...values].sort((a, b) => a - b);
}

export function currentOverview(): OverviewSnapshot | null {
  const conn = currentConnection();
  return conn ? state.overview[keyOf(conn.id)] ?? null : null;
}

export function currentHistory(): MetricSample[] {
  const conn = currentConnection();
  return conn ? state.history[keyOf(conn.id)] ?? [] : [];
}

export function currentMonitor(): MonitorSnapshot | null {
  const conn = currentConnection();
  return conn ? state.monitor[keyOf(conn.id)] ?? null : null;
}

export function cliSessionsFor(conn: ConnectionView | null): CliSession[] {
  if (!conn) return [];
  if (!state.cliSessions[conn.id]) {
    state.cliSessions[conn.id] = [newCliSession(conn, 0)];
    state.cliActive[conn.id] = 0;
  }
  return state.cliSessions[conn.id]!;
}

export function activeCliSession(): CliSession | null {
  const conn = currentConnection();
  if (!conn) return null;
  const list = cliSessionsFor(conn);
  return list[state.cliActive[conn.id] ?? 0] ?? list[0] ?? null;
}

function newCliSession(conn: Connection, index: number): CliSession {
  return {
    id: `${conn.id}-cli-${Date.now()}-${index}`,
    name: `[${index}] ${conn.host ?? "127.0.0.1"}:${conn.port ?? 6379}`,
    lines: [],
    readOnly: settings.get("cliReadOnlyDefault") || conn.readOnly,
    history: [],
  };
}

export function addCliSession() {
  const conn = currentConnection();
  if (!conn) return;
  const list = cliSessionsFor(conn);
  list.push(newCliSession(conn, list.length));
  state.cliActive[conn.id] = list.length - 1;
  notify();
}

export function go(page: PageId) {
  state.page = page;
  if (state.connId) state.pageByConn[state.connId] = page;
  notify();
  if (page === "browser" && state.keys.length === 0 && currentConnection()) void scanKeys({ reset: true });
  if (page === "monitor" && currentConnection()) void loadMonitor();
  if (page === "overview" && currentConnection() && !currentOverview()) void loadOverview();
}

/* ------------------------------------------------------------------ */
/* Data loading                                                        */
/* ------------------------------------------------------------------ */

export async function refreshConnections(): Promise<void> {
  if (!api.available) {
    state.serviceAvailable = false;
    state.globalError = "";
    notify();
    return;
  }
  state.loadingConnections = true;
  notify();
  try {
    const list = await redis.listConnections();
    const prev = new Map(state.connections.map((c) => [c.id, c]));
    state.connections = (list ?? []).map((conn) => {
      const old = prev.get(conn.id);
      return {
        ...conn,
        status: old?.status ?? "off",
        version: old?.version ?? "—",
        latencyMs: old?.latencyMs ?? 0,
      };
    });
    state.serviceAvailable = true;
    state.globalError = "";
    if (!state.connId || !state.connections.some((c) => c.id === state.connId)) {
      state.connId = state.connections[0]?.id ?? null;
    }
  } catch (error) {
    state.globalError = errorMessage(error);
  } finally {
    state.loadingConnections = false;
    notify();
  }
  if (currentConnection()) await loadOverview();
}

function pushSample(connId: string, overview: OverviewSnapshot, netIn: number, netOut: number) {
  const sample: MetricSample = {
    at: overview.atMs || Date.now(),
    ops: overview.opsPerSec,
    clients: overview.connectedClients,
    used: overview.usedMemoryBytes,
    latency: overview.latencyMs,
    netIn,
    netOut,
  };
  const list = [...(state.history[connId] ?? []), sample];
  state.history[connId] = list.slice(-HISTORY_LIMIT);
}

export function loadOverview(): Promise<void> {
  const conn = currentConnection();
  if (!conn || !api.available) return Promise.resolve();
  const db = currentDb(conn);
  const requestKey = `${conn.id}:${db}`;
  const inFlight = overviewRequests.get(requestKey);
  if (inFlight) return inFlight;

  const request = loadOverviewRequest(conn, db, requestKey);
  overviewRequests.set(requestKey, request);
  return request;
}

async function loadOverviewRequest(conn: ConnectionView, db: number, requestKey: string): Promise<void> {
  try {
    const overview = await redis.getOverview(conn.id, db);
    if (currentConnection()?.id !== conn.id || currentDb(conn) !== db) return;
    const prevInfo = state.overview[conn.id]?.info;
    const netIn = diff(overview.info["total_net_input_bytes"], prevInfo?.["total_net_input_bytes"]);
    const netOut = diff(overview.info["total_net_output_bytes"], prevInfo?.["total_net_output_bytes"]);
    state.overview[conn.id] = overview;
    pushSample(conn.id, overview, netIn, netOut);
    updateConn(conn.id, {
      status: "on",
      version: overview.info["redis_version"] ?? conn.version,
      latencyMs: overview.latencyMs,
      error: undefined,
    });
  } catch (error) {
    updateConn(conn.id, { status: "off", error: errorMessage(error) });
  } finally {
    overviewRequests.delete(requestKey);
  }
  notify();
}

function diff(next: string | undefined, prev: string | undefined): number {
  const n = Number(next);
  const p = Number(prev);
  if (!Number.isFinite(n) || !Number.isFinite(p)) return 0;
  return Math.max(0, n - p);
}

function updateConn(id: string, partial: Partial<ConnectionView>) {
  state.connections = state.connections.map((c) => (c.id === id ? { ...c, ...partial } : c));
}

export async function loadMonitor(): Promise<void> {
  const conn = currentConnection();
  if (!conn || !api.available) return;
  const db = currentDb(conn);
  try {
    const snapshot = await redis.getMonitorSnapshot(conn.id, db);
    if (currentConnection()?.id !== conn.id || currentDb(conn) !== db) return;
    state.monitor[conn.id] = snapshot;
    const prevInfo = state.overview[conn.id]?.info;
    state.overview[conn.id] = snapshot.overview;
    pushSample(conn.id, snapshot.overview, diff(snapshot.overview.info["total_net_input_bytes"], prevInfo?.["total_net_input_bytes"]), diff(snapshot.overview.info["total_net_output_bytes"], prevInfo?.["total_net_output_bytes"]));
    updateConn(conn.id, { status: "on", version: snapshot.overview.info["redis_version"] ?? conn.version, latencyMs: snapshot.overview.latencyMs });
  } catch (error) {
    updateConn(conn.id, { status: "off", error: errorMessage(error) });
    toast("err", "监控数据读取失败", errorMessage(error));
  }
  notify();
}

export async function selectConnection(id: string) {
  state.connId = id;
  state.page = state.pageByConn[id] ?? "overview";
  state.selectedKey = null;
  state.valueMode = "raw";
  state.value = null;
  state.keys = [];
  state.keyDone = false;
  state.keyCursor = 0;
  state.sidebarOpen = false;
  notify();
  if (state.page === "monitor") await loadMonitor();
  else await loadOverview();
  if (state.page === "browser") void scanKeys({ reset: true });
}

export async function selectDatabase(db: number) {
  const conn = currentConnection();
  const next = Math.trunc(db);
  if (!conn || !Number.isFinite(next) || next < 0 || (conn.mode.toLowerCase() === "cluster" && next !== 0)) return;
  if (currentDb(conn) === next) return;
  state.dbByConn = { ...state.dbByConn, [conn.id]: next };
  state.selectedKey = null;
  state.valueMode = "raw";
  state.value = null;
  state.valueLoading = false;
  state.valueError = "";
  state.keys = [];
  state.keyDone = false;
  state.keyCursor = 0;
  state.keyScanned = 0;
  state.scanning = false;
  delete state.overview[conn.id];
  delete state.monitor[conn.id];
  delete state.history[conn.id];
  delete state.cliSessions[conn.id];
  delete state.cliActive[conn.id];
  notify();
  if (state.page === "monitor") await loadMonitor();
  else await loadOverview();
  if (currentConnection()?.id !== conn.id || currentDb(conn) !== next) return;
  if (state.page === "browser") void scanKeys({ reset: true });
}

export async function testConnection(conn: ConnectionView) {
  if (!api.available) return;
  try {
    const result = await redis.checkConnection(conn.id);
    updateConn(conn.id, {
      status: result.status === "ok" ? "on" : "warn",
      version: result.version || conn.version,
      latencyMs: result.latencyMs,
      error: result.status === "ok" ? undefined : result.message,
    });
    notify();
  } catch (error) {
    updateConn(conn.id, { status: "off", error: errorMessage(error) });
    notify();
  }
}

export async function scanKeys(options: { reset?: boolean; append?: boolean } = {}): Promise<void> {
  const conn = currentConnection();
  if (!conn || !api.available || state.scanning) return;
  const db = currentDb(conn);
  const reset = options.reset || !options.append;
  state.scanning = true;
  if (reset) {
    state.keyCursor = 0;
    state.keyDone = false;
    state.keyScanned = 0;
  }
  notify();
  try {
    const count = settings.get("scanCount");
    const page: KeyPage = await redis.scanKeys(conn.id, db, state.keyPattern || "*", reset ? 0 : state.keyCursor, count);
    if (currentConnection()?.id !== conn.id || currentDb(conn) !== db) return;
    const seen = new Set(state.keys.map((k) => k.key));
    const merged = [...(state.keys ?? []), ...(page.keys ?? []).filter((k) => !seen.has(k.key))];
    state.keys = merged.slice(0, 2000);
    state.keyCursor = page.cursor;
    state.keyDone = page.done || merged.length >= 2000;
    state.keyScanned += page.keys?.length ?? 0;
    if (state.selectedKey && !state.keys.some((k) => k.key === state.selectedKey)) {
      state.selectedKey = state.keys[0]?.key ?? null;
    }
    if (!state.selectedKey && state.keys[0]) state.selectedKey = state.keys[0].key;
  } catch (error) {
    toast("err", "SCAN 失败", errorMessage(error));
    state.keyDone = true;
  } finally {
    state.scanning = false;
    notify();
  }
  if (state.selectedKey && !state.value) void openKey(state.selectedKey);
}

export async function openKey(key: string): Promise<void> {
  const conn = currentConnection();
  if (!conn || !api.available) return;
  const db = currentDb(conn);
  if (state.selectedKey !== key) state.valueMode = "raw";
  state.selectedKey = key;
  state.valueLoading = true;
  state.valueError = "";
  notify();
  try {
    const value = await redis.getValue(conn.id, db, key);
    if (state.selectedKey !== key || currentConnection()?.id !== conn.id || currentDb(conn) !== db) return;
    state.value = value;
  } catch (error) {
    state.valueError = errorMessage(error);
    state.value = null;
  } finally {
    state.valueLoading = false;
    notify();
  }
}

export async function deleteSelectedKey(): Promise<void> {
  const conn = currentConnection();
  const value = state.value;
  if (!conn || !value) return;
  const db = currentDb(conn);
  try {
    await redis.deleteKey(conn.id, db, value.key);
    toast("ok", `已删除 ${value.key}`);
    state.value = null;
    state.selectedKey = null;
    state.valueMode = "raw";
    state.keys = state.keys.filter((k) => k.key !== value.key);
    notify();
    await scanKeys({ reset: true });
  } catch (error) {
    toast("err", "删除失败", errorMessage(error));
  }
}

export async function saveHashField(field: string, value: string): Promise<boolean> {
  const conn = currentConnection();
  const current = state.value;
  if (!conn || !current) return false;
  const db = currentDb(conn);
  try {
    await redis.hashSet(conn.id, db, current.key, field, value);
    state.value = { ...current, hash: { ...(current.hash ?? {}), [field]: value } };
    notify();
    toast("ok", "字段已写入", `${current.key} · ${field}`);
    return true;
  } catch (error) {
    toast("err", "写入失败", errorMessage(error));
    return false;
  }
}

export async function runCli(command: string): Promise<void> {
  const conn = currentConnection();
  const session = activeCliSession();
  if (!conn || !session) return;
  const db = currentDb(conn);
  const text = command.trim();
  if (!text) return;
  const entry = { id: Date.now(), at: Date.now(), command: text, lines: [] as CliLine[], readOnly: session.readOnly };
  session.lines = [...session.lines, entry];
  session.history = [...session.history.filter((h) => h !== text), text].slice(-settings.get("cliHistoryLimit"));
  notify();
  if (!api.available) {
    entry.lines = [{ kind: "error", text: "Go 服务不可用（仅 dev:web 预览时没有绑定）。" }];
    notify();
    return;
  }
  try {
    const result = await redis.execCLI(conn.id, db, text, session.readOnly);
    entry.lines = result.lines ?? [];
    if (!entry.lines.length) entry.lines = [{ kind: "string", text: "(empty)" }];
  } catch (error) {
    entry.lines = [{ kind: "error", text: errorMessage(error) }];
  }
  session.lines = [...session.lines];
  notify();
}

export function clearCliLog() {
  const session = activeCliSession();
  if (!session) return;
  session.lines = [];
  notify();
}

export function setCliReadOnly(readOnly: boolean) {
  const session = activeCliSession();
  if (!session) return;
  session.readOnly = readOnly;
  notify();
}

export async function saveConnection(conn: Connection, password: string): Promise<boolean> {
  if (!api.available) return false;
  try {
    await redis.saveConnection(conn, password);
    state.connId = conn.id;
    state.connectionEditor = null;
    await refreshConnections();
    notify();
    toast("ok", "连接已保存", `${conn.name} · ${conn.host}:${conn.port}`);
    return true;
  } catch (error) {
    toast("err", "保存失败", errorMessage(error));
    return false;
  }
}

export async function removeConnection(id: string) {
  if (!api.available) return;
  try {
    await redis.deleteConnection(id);
    state.connections = state.connections.filter((c) => c.id !== id);
    delete state.overview[id];
    delete state.history[id];
    delete state.monitor[id];
    delete state.cliSessions[id];
    if (state.connId === id) state.connId = state.connections[0]?.id ?? null;
    notify();
    toast("ok", "连接已删除");
  } catch (error) {
    toast("err", "删除失败", errorMessage(error));
  }
}

/* ------------------------------------------------------------------ */
/* Polling                                                             */
/* ------------------------------------------------------------------ */

let timer: number | null = null;

export function startPolling() {
  stopPolling();
  timer = window.setInterval(() => {
    if (!api.available || !currentConnection()) return;
    if (state.connectionEditor || state.confirm || state.lockOpen || document.hidden) return;
    if (state.page === "monitor") void loadMonitor();
    else void loadOverview();
  }, 4000);
}

export function stopPolling() {
  if (timer != null) window.clearInterval(timer);
  timer = null;
}
