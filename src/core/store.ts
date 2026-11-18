import {
  api,
  application,
  errorMessage,
  redis,
  type AppInfo,
  type Connection,
  type CredentialStorageMode,
  type KeyPage,
  type MonitorSnapshot,
  type OverviewSnapshot,
  type RedisValue,
} from "./api";
import { settings } from "../theme/settings";

export type PageId = "overview" | "browser" | "cli" | "monitor" | "connections" | "settings";
export type ConnStatus = "on" | "warn" | "off";
export type ValueViewMode = "raw" | "json" | "hex" | "html" | "markdown";
export type ChangeKind = "full" | "metrics";

export interface ConnectionView extends Connection {
  status: ConnStatus;
  version: string;
  latencyMs: number;
  error?: string;
}

export interface MetricSample {
  at: number;
  intervalMs?: number;
  /** True for samples carried backwards from the first real reading. */
  inferred?: boolean;
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
  /** Unsent draft, owned by the session so re-renders never lose it. */
  input?: string;
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

export interface KeyTarget {
  connId: string;
  db: number;
  key: string;
}

export interface ViewState {
  /** Which instance view was last visible, so "there is a current instance" is answerable. */
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
  appInfo: AppInfo | null;
  appInfoLoading: boolean;
  appInfoError: string;
  openingUpdater: boolean;
  credentialStorage: CredentialStorageMode;
  credentialKeychainPending: number;
  credentialStorageSaving: boolean;

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
  /** Timestamp of the metric sample under inspection in the analyser detail pane. */
  selectedSampleAt: number | null;
  cliSessions: Record<string, CliSession[]>;
  cliActive: Record<string, number>;

  paletteOpen: boolean;
  connectionEditor: { mode: "new" | "edit"; id?: string } | null;
  confirm: { title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => void } | null;
  toasts: Toast[];
}

const HISTORY_LIMIT = 90;
const keyOf = (connId: string) => connId;
const overviewRequests = new Map<string, Promise<void>>();
let browserContextVersion = 0;
let scanRequestVersion = 0;
let valueRequestVersion = 0;
let keySelectionVersion = 0;
let monitorRequestVersion = 0;

export const state: ViewState = {
  page: "overview",
  pageByConn: {},
  connId: null,
  dbByConn: {},
  connections: [],
  loadingConnections: false,
  globalError: "",
  serviceAvailable: api.available,
  appInfo: null,
  appInfoLoading: false,
  appInfoError: "",
  openingUpdater: false,
  credentialStorage: "local",
  credentialKeychainPending: 0,
  credentialStorageSaving: false,
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
  selectedSampleAt: null,
  cliSessions: {},
  cliActive: {},
  paletteOpen: false,
  connectionEditor: null,
  confirm: null,
  toasts: [],
};

type Listener = (kind: ChangeKind) => void;
const listeners = new Set<Listener>();
let scheduled = false;
let pendingKind: ChangeKind | null = null;

export function onChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Batches every mutation from one tick into a single re-render. */
export function notify(kind: ChangeKind = "full") {
  if (pendingKind === null || kind === "full") {
    pendingKind = kind;
  }
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const flushed: ChangeKind = pendingKind ?? "full";
    pendingKind = null;
    for (const listener of listeners) listener(flushed);
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

function isCurrentDatabase(connId: string, db: number, version: number): boolean {
  return browserContextVersion === version && currentConnection()?.id === connId && currentDb() === db;
}

export function selectKey(key: string | null) {
  if (state.selectedKey === key) return;
  keySelectionVersion += 1;
  valueRequestVersion += 1;
  state.selectedKey = key;
  state.value = null;
  state.valueMode = "raw";
  state.valueLoading = false;
  state.valueError = "";
}

// A request belongs to one visit to a database, including a switch away and back.
function resetBrowserContext() {
  browserContextVersion += 1;
  scanRequestVersion += 1;
  valueRequestVersion += 1;
  keySelectionVersion += 1;
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

export function closeCliSession(index: number): void {
  const conn = currentConnection();
  if (!conn) return;
  const list = cliSessionsFor(conn);
  if (list.length <= 1) {
    if (list[0]) {
      list[0].lines = [];
      list[0].input = "";
    }
    state.cliActive[conn.id] = 0;
    notify();
    return;
  }
  if (index < 0 || index >= list.length) return;
  const prevActive = state.cliActive[conn.id] ?? 0;
  list.splice(index, 1);
  const nextActive = prevActive > index ? prevActive - 1 : Math.min(prevActive, list.length - 1);
  state.cliActive[conn.id] = Math.max(0, nextActive);
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
/* Metric windows                                                      */
/* ------------------------------------------------------------------ */

/**
 * The server reports counters, so a session open for a few seconds holds a
 * handful of samples. A panel that claims a window still needs one, so the
 * history is extended backwards from the nearest real sample and the number of
 * extrapolated samples travels with it. Extrapolation is a straight carry, not
 * invented noise: the UI labels it and draws it differently, so nothing
 * fabricated can be mistaken for a measurement.
 */
export function sampleNetKbps(sample: MetricSample | null | undefined): { inKBps: number; outKBps: number } {
  if (!sample || sample.inferred) return { inKBps: 0, outKBps: 0 };
  const sec = Math.max(0.25, (sample.intervalMs ?? 4000) / 1000);
  return { inKBps: sample.netIn / sec / 1024, outKBps: sample.netOut / sec / 1024 };
}

export function windowedHistory(hist: MetricSample[], size: number): { samples: MetricSample[]; inferred: number } {
  if (!hist.length || hist.length >= size) return { samples: hist, inferred: 0 };
  const last = hist[hist.length - 1]!;
  const first = hist[0]!;
  const step = hist.length > 1 ? Math.max(4000, Math.round((last.at - first.at) / (hist.length - 1) / 1000) * 1000) : 4000;
  // Extrapolated rows are not readings, so they carry no values; only their
  // timestamps are drawn, which keeps the scale without inventing measurements.
  const ghost: MetricSample[] = [];
  for (let i = size - hist.length; i > 0; i -= 1) {
    ghost.push({ at: first.at - step * i, ops: 0, clients: 0, used: 0, latency: 0, netIn: 0, netOut: 0, inferred: true });
  }
  return { samples: [...ghost, ...hist], inferred: ghost.length };
}

/* ------------------------------------------------------------------ */
/* Data loading                                                        */
/* ------------------------------------------------------------------ */

export async function loadAppInfo(): Promise<void> {
  if (state.appInfoLoading) return;
  if (!application.available) {
    state.appInfo = null;
    state.appInfoError = "当前为浏览器预览，软件更新仅在桌面应用中可用。";
    notify();
    return;
  }
  state.appInfoLoading = true;
  notify();
  try {
    state.appInfo = await application.getAppInfo();
    state.appInfoError = "";
  } catch (error) {
    state.appInfo = null;
    state.appInfoError = errorMessage(error);
  } finally {
    state.appInfoLoading = false;
    notify();
  }
}

export async function checkForUpdates(): Promise<void> {
  if (state.openingUpdater) return;
  if (!application.available || !state.appInfo?.updatesEnabled) {
    toast("info", "当前无法检查更新", state.appInfoError || (state.appInfo?.isDev ? "开发构建不会检查软件更新。" : "请使用支持更新的发布包，并安装到可写目录。"));
    return;
  }
  state.openingUpdater = true;
  notify();
  try {
    await application.checkForUpdates();
  } catch (error) {
    toast("err", "无法打开更新窗口", errorMessage(error));
  } finally {
    state.openingUpdater = false;
    notify();
  }
}

function normalizeCredentialMode(mode: string | undefined): CredentialStorageMode {
  return mode === "keychain" ? "keychain" : "local";
}

export async function loadCredentialStorage(): Promise<void> {
  if (!api.available) return;
  try {
    const status = await redis.getCredentialStorage();
    state.credentialStorage = normalizeCredentialMode(status.mode);
    state.credentialKeychainPending = Math.max(0, Number(status.keychainPending) || 0);
    notify();
  } catch {
    // Keep the default local mode when running in a plain browser without Go bindings.
  }
}

export async function setCredentialStorage(mode: CredentialStorageMode): Promise<boolean> {
  if (state.credentialStorageSaving) return false;
  if (!api.available) {
    notify();
    toast("err", "切换密码存储失败", "未检测到 Go 服务");
    return false;
  }
  state.credentialStorageSaving = true;
  notify();
  try {
    const status = await redis.setCredentialStorage(mode);
    state.credentialStorage = normalizeCredentialMode(status.mode);
    state.credentialKeychainPending = Math.max(0, Number(status.keychainPending) || 0);
    if (state.credentialStorage === "local") {
      if (state.credentialKeychainPending > 0) {
        toast(
          "info",
          "已切回本地加密存储",
          `仍有 ${state.credentialKeychainPending} 个旧连接的密码保留在系统钥匙串，可在编辑连接中重输密码直接落盘`,
        );
      } else {
        toast("ok", "密码存储已切换为本地加密", "应用更新后不再触发系统钥匙串授权弹窗");
      }
    } else {
      toast("ok", "密码存储已切换为系统钥匙串", "已保存的连接密码已迁移至系统凭据存储");
    }
    return true;
  } catch (error) {
    toast("err", "切换密码存储失败", errorMessage(error));
    return false;
  } finally {
    state.credentialStorageSaving = false;
    notify();
  }
}

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
      resetBrowserContext();
    }
  } catch (error) {
    state.globalError = errorMessage(error);
  } finally {
    state.loadingConnections = false;
    notify();
  }
  if (currentConnection()) await loadOverview();
}

function pushSample(connId: string, overview: OverviewSnapshot, netIn: number, netOut: number, intervalMs = 4000) {
  const sample: MetricSample = {
    at: overview.atMs || Date.now(),
    intervalMs,
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

function recordOverview(connId: string, overview: OverviewSnapshot) {
  const prev = state.overview[connId];
  const prevAt = prev?.atMs;
  const prevInfo = prev?.info;
  let netIn = 0;
  let netOut = 0;
  let intervalMs = 4000;
  if (prevAt && overview.atMs - prevAt > 0 && overview.atMs - prevAt <= 60_000) {
    intervalMs = Math.max(250, overview.atMs - prevAt);
    netIn = diff(overview.info["total_net_input_bytes"], prevInfo?.["total_net_input_bytes"]);
    netOut = diff(overview.info["total_net_output_bytes"], prevInfo?.["total_net_output_bytes"]);
  }
  state.overview[connId] = overview;
  pushSample(connId, overview, netIn, netOut, intervalMs);
}

export function loadOverview(): Promise<void> {
  const conn = currentConnection();
  if (!conn || !api.available) return Promise.resolve();
  const db = currentDb(conn);
  const version = browserContextVersion;
  const requestKey = JSON.stringify([version, conn.id, db]);
  const inFlight = overviewRequests.get(requestKey);
  if (inFlight) return inFlight;

  const request = loadOverviewRequest(conn, db, version, requestKey);
  overviewRequests.set(requestKey, request);
  return request;
}

async function loadOverviewRequest(conn: ConnectionView, db: number, version: number, requestKey: string): Promise<void> {
  let kind: ChangeKind = "full";
  try {
    const overview = await redis.getOverview(conn.id, db);
    if (!isCurrentDatabase(conn.id, db, version)) return;
    const prevConn = state.connections.find((c) => c.id === conn.id) ?? conn;
    const wasOn = prevConn.status === "on";
    recordOverview(conn.id, overview);
    updateConn(conn.id, {
      status: "on",
      version: overview.info["redis_version"] ?? prevConn.version,
      latencyMs: overview.latencyMs,
      error: undefined,
    });
    if (state.page !== "overview" && state.page !== "monitor" && wasOn) {
      kind = "metrics";
    }
    if (state.credentialKeychainPending > 0) void loadCredentialStorage();
  } catch (error) {
    if (!isCurrentDatabase(conn.id, db, version)) return;
    updateConn(conn.id, { status: "off", error: errorMessage(error) });
    if (state.credentialStorage === "local") void loadCredentialStorage();
  } finally {
    overviewRequests.delete(requestKey);
  }
  notify(kind);
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
  const version = browserContextVersion;
  const request = ++monitorRequestVersion;
  const isCurrent = () => request === monitorRequestVersion && isCurrentDatabase(conn.id, db, version);
  try {
    const snapshot = await redis.getMonitorSnapshot(conn.id, db);
    if (!isCurrent()) return;
    state.monitor[conn.id] = snapshot;
    const prevConn = state.connections.find((c) => c.id === conn.id) ?? conn;
    recordOverview(conn.id, snapshot.overview);
    updateConn(conn.id, { status: "on", version: snapshot.overview.info["redis_version"] ?? prevConn.version, latencyMs: snapshot.overview.latencyMs, error: undefined });
  } catch (error) {
    if (!isCurrent()) return;
    updateConn(conn.id, { status: "off", error: errorMessage(error) });
    toast("err", "监控数据读取失败", errorMessage(error));
  }
  notify();
}

export async function selectConnection(id: string) {
  state.connId = id;
  state.page = state.pageByConn[id] ?? "overview";
  resetBrowserContext();
  const version = browserContextVersion;
  const db = currentDb();
  notify();
  if (state.page === "monitor") await loadMonitor();
  else await loadOverview();
  if (!isCurrentDatabase(id, db, version)) return;
  if (state.page === "browser") void scanKeys({ reset: true });
}

export async function selectDatabase(db: number) {
  const conn = currentConnection();
  const next = Math.trunc(db);
  if (!conn || !Number.isFinite(next) || next < 0 || (conn.mode.toLowerCase() === "cluster" && next !== 0)) return;
  if (currentDb(conn) === next) return;
  state.dbByConn = { ...state.dbByConn, [conn.id]: next };
  resetBrowserContext();
  const version = browserContextVersion;
  delete state.overview[conn.id];
  delete state.monitor[conn.id];
  delete state.history[conn.id];
  delete state.cliSessions[conn.id];
  delete state.cliActive[conn.id];
  notify();
  if (state.page === "monitor") await loadMonitor();
  else await loadOverview();
  if (!isCurrentDatabase(conn.id, next, version)) return;
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
  const reset = options.reset || !options.append;
  if (!conn || !api.available || (state.scanning && !reset)) return;
  const db = currentDb(conn);
  const version = browserContextVersion;
  const request = ++scanRequestVersion;
  const isCurrent = () => request === scanRequestVersion && isCurrentDatabase(conn.id, db, version);
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
    if (!isCurrent()) return;
    const merged = reset ? [] : [...state.keys];
    const seen = new Set(merged.map((k) => k.key));
    for (const key of page.keys ?? []) {
      if (!seen.has(key.key)) merged.push(key);
      seen.add(key.key);
    }
    state.keys = merged.slice(0, 2000);
    state.keyCursor = page.cursor;
    state.keyDone = page.done || merged.length >= 2000;
    state.keyScanned += page.keys?.length ?? 0;
    if (state.selectedKey && !state.keys.some((k) => k.key === state.selectedKey)) {
      selectKey(state.keys[0]?.key ?? null);
    }
    if (!state.selectedKey && state.keys[0]) selectKey(state.keys[0].key);
  } catch (error) {
    if (!isCurrent()) return;
    toast("err", "SCAN 失败", errorMessage(error));
    state.keyDone = true;
  } finally {
    if (isCurrent()) {
      state.scanning = false;
      notify();
    }
  }
  if (isCurrent() && state.selectedKey && !state.value && !state.valueLoading) void openKey(state.selectedKey);
}

export async function openKey(key: string): Promise<void> {
  const conn = currentConnection();
  if (!conn || !api.available) return;
  const db = currentDb(conn);
  const version = browserContextVersion;
  selectKey(key);
  const request = ++valueRequestVersion;
  const isCurrent = () => request === valueRequestVersion && state.selectedKey === key && isCurrentDatabase(conn.id, db, version);
  state.valueLoading = true;
  state.valueError = "";
  notify();
  try {
    const value = await redis.getValue(conn.id, db, key);
    if (!isCurrent()) return;
    state.value = value;
  } catch (error) {
    if (!isCurrent()) return;
    state.valueError = errorMessage(error);
    state.value = null;
  } finally {
    if (isCurrent()) {
      state.valueLoading = false;
      notify();
    }
  }
}

export async function deleteSelectedKey(target?: KeyTarget): Promise<void> {
  const conn = currentConnection();
  const value = state.value;
  const selected = target ?? (conn && value ? { connId: conn.id, db: currentDb(conn), key: value.key } : null);
  if (!selected || !api.available) return;
  const targetConn = state.connections.find((c) => c.id === selected.connId) ?? (conn?.id === selected.connId ? conn : null);
  if (targetConn?.readOnly) {
    toast("err", "只读连接", "当前连接为只读模式，不允许修改或删除数据");
    return;
  }
  const { connId, db, key } = selected;
  const version = browserContextVersion;
  try {
    await redis.deleteKey(connId, db, key);
    toast("ok", `已删除 ${key}`);
    if (!isCurrentDatabase(connId, db, version)) return;
    scanRequestVersion += 1;
    state.scanning = false;
    if (state.selectedKey === key) selectKey(null);
    state.keys = state.keys.filter((k) => k.key !== key);
    notify();
  } catch (error) {
    toast("err", "删除失败", errorMessage(error));
  }
}

export async function saveHashField(field: string, value: string): Promise<boolean> {
  const conn = currentConnection();
  if (!conn) return false;
  if (conn.readOnly) {
    toast("err", "只读连接", "当前连接为只读模式，不允许修改或删除数据");
    return false;
  }
  const current = state.value;
  if (!current || current.type !== "hash" || state.selectedKey !== current.key || !api.available) return false;
  const db = currentDb(conn);
  const version = browserContextVersion;
  const selection = keySelectionVersion;
  try {
    await redis.hashSet(conn.id, db, current.key, field, value);
    if (isCurrentDatabase(conn.id, db, version) && selection === keySelectionVersion && state.selectedKey === current.key && state.value?.key === current.key && state.value.type === "hash") {
      valueRequestVersion += 1;
      state.valueLoading = false;
      state.valueError = "";
      const prevHash = state.value.hash ?? {};
      const isNewField = !Object.prototype.hasOwnProperty.call(prevHash, field);
      state.value = {
        ...state.value,
        hash: { ...prevHash, [field]: value },
        ...(state.value.totalCount != null ? { totalCount: state.value.totalCount + (isNewField ? 1 : 0) } : {}),
      };
      notify();
    }
    toast("ok", "字段已写入", `${current.key} · ${field}`);
    return true;
  } catch (error) {
    toast("err", "写入失败", errorMessage(error));
    return false;
  }
}

export async function removeHashField(field: string): Promise<boolean> {
  const conn = currentConnection();
  if (!conn) return false;
  if (conn.readOnly) {
    toast("err", "只读连接", "当前连接为只读模式，不允许修改或删除数据");
    return false;
  }
  const current = state.value;
  if (!current || current.type !== "hash" || state.selectedKey !== current.key || !field || !api.available) return false;
  const db = currentDb(conn);
  const version = browserContextVersion;
  const selection = keySelectionVersion;
  const key = current.key;
  try {
    await redis.hashDelete(conn.id, db, key, field);
    if (isCurrentDatabase(conn.id, db, version) && selection === keySelectionVersion && state.selectedKey === key && state.value?.key === key && state.value.type === "hash") {
      valueRequestVersion += 1;
      state.valueLoading = false;
      state.valueError = "";
      const nextHash = { ...(state.value.hash ?? {}) };
      delete nextHash[field];
      state.value = {
        ...state.value,
        hash: nextHash,
        totalCount: Math.max(0, (state.value.totalCount ?? Object.keys(nextHash).length + 1) - 1),
      };
      notify();
    }
    toast("ok", "字段已删除", `${key} · ${field}`);
    return true;
  } catch (error) {
    toast("err", "删除字段失败", errorMessage(error));
    return false;
  }
}

export async function saveKeyTtl(ttlSeconds: number): Promise<boolean> {
  const conn = currentConnection();
  if (!conn) return false;
  if (conn.readOnly) {
    toast("err", "只读连接", "当前连接为只读模式，不允许修改或删除数据");
    return false;
  }
  const current = state.value;
  if (!current || state.selectedKey !== current.key || !api.available || !Number.isFinite(ttlSeconds)) return false;
  const db = currentDb(conn);
  const version = browserContextVersion;
  const selection = keySelectionVersion;
  const key = current.key;
  const truncatedTtl = Math.trunc(ttlSeconds);
  try {
    await redis.setTTL(conn.id, db, key, truncatedTtl);
    if (isCurrentDatabase(conn.id, db, version)) {
      const nextTtlMs = truncatedTtl < 0 ? -1 : truncatedTtl * 1000;
      state.keys = state.keys.map((k) => (k.key === key ? { ...k, ttlMs: nextTtlMs } : k));
      if (selection === keySelectionVersion && state.selectedKey === key && state.value?.key === key) {
        valueRequestVersion += 1;
        state.valueLoading = false;
        state.valueError = "";
        state.value = { ...state.value, ttlMs: nextTtlMs };
      }
      notify();
    }
    toast("ok", truncatedTtl < 0 ? "已设为持久键" : "TTL 已更新", key);
    return true;
  } catch (error) {
    toast("err", "修改 TTL 失败", errorMessage(error));
    return false;
  }
}

export async function saveStringValue(newValue: string): Promise<boolean> {
  const conn = currentConnection();
  if (!conn) return false;
  if (conn.readOnly) {
    toast("err", "只读连接", "当前连接为只读模式，不允许修改或删除数据");
    return false;
  }
  const current = state.value;
  if (!current || current.type !== "string" || state.selectedKey !== current.key || !api.available) return false;
  const db = currentDb(conn);
  const version = browserContextVersion;
  const selection = keySelectionVersion;
  const key = current.key;
  try {
    await redis.setString(conn.id, db, key, newValue);
    if (isCurrentDatabase(conn.id, db, version)) {
      const byteLen = new TextEncoder().encode(newValue).byteLength;
      state.keys = state.keys.map((k) => (k.key === key ? { ...k, sizeBytes: byteLen } : k));
      if (selection === keySelectionVersion && state.selectedKey === key && state.value?.key === key && state.value.type === "string") {
        valueRequestVersion += 1;
        state.valueLoading = false;
        state.valueError = "";
        state.value = {
          ...state.value,
          stringValue: newValue,
          sizeBytes: byteLen,
          totalCount: byteLen,
          truncated: false,
        };
      }
      notify();
    }
    toast("ok", "键值已保存", key);
    return true;
  } catch (error) {
    toast("err", "保存失败", errorMessage(error));
    return false;
  }
}

export async function createNewKey(input: {
  key: string;
  type: "string" | "hash";
  value: string;
  field?: string;
  ttlSeconds?: number;
}): Promise<boolean> {
  const conn = currentConnection();
  if (!conn || !api.available) return false;
  if (conn.readOnly) {
    toast("err", "只读连接", "当前连接为只读模式，不允许修改或删除数据");
    return false;
  }
  const key = input.key.trim();
  if (!key) {
    toast("err", "创建键失败", "键名不能为空");
    return false;
  }
  const field = input.field?.trim() ?? "";
  if (input.type === "hash" && !field) {
    toast("err", "创建键失败", "Hash 字段名不能为空");
    return false;
  }
  const db = currentDb(conn);
  const version = browserContextVersion;
  const ttlSec = input.ttlSeconds && input.ttlSeconds > 0 ? Math.trunc(input.ttlSeconds) : 0;
  try {
    if (input.type === "hash") {
      await redis.hashSet(conn.id, db, key, field, input.value);
    } else {
      await redis.setString(conn.id, db, key, input.value);
    }
    if (ttlSec > 0) {
      await redis.setTTL(conn.id, db, key, ttlSec);
    }
    if (isCurrentDatabase(conn.id, db, version)) {
      const meta: ConnectionKey = {
        key,
        type: input.type,
        ttlMs: ttlSec > 0 ? ttlSec * 1000 : -1,
        sizeBytes: new TextEncoder().encode(input.value).byteLength,
        encoding: "",
      };
      const existingIdx = state.keys.findIndex((k) => k.key === key);
      if (existingIdx >= 0) {
        state.keys = state.keys.map((k, idx) => (idx === existingIdx ? meta : k));
      } else {
        state.keys = [meta, ...state.keys];
      }
      await openKey(key);
    }
    toast("ok", "已创建键", key);
    return true;
  } catch (error) {
    toast("err", "创建键失败", errorMessage(error));
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
  session.input = "";
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
  const conn = currentConnection();
  const session = activeCliSession();
  if (!session) return;
  if (!readOnly && conn?.readOnly) {
    toast("info", "只读连接", "当前连接已设为只读模式，不可切换为可写");
    return;
  }
  session.readOnly = readOnly;
  notify();
}

export async function saveConnection(conn: Connection, password: string): Promise<boolean> {
  if (!api.available) return false;
  const editor = state.connectionEditor;
  const version = browserContextVersion;
  const selectedId = state.connId;
  const selectedDb = currentDb();
  let savedVersion: number | null = null;
  try {
    await redis.saveConnection(conn, password);
    if (state.connectionEditor === editor && browserContextVersion === version && state.connId === selectedId && currentDb() === selectedDb) {
      state.connId = conn.id;
      state.connectionEditor = null;
      resetBrowserContext();
      savedVersion = browserContextVersion;
    }
    await refreshConnections();
    void loadCredentialStorage();
    if (savedVersion != null && isCurrentDatabase(conn.id, currentDb(), savedVersion) && state.page === "browser") {
      void scanKeys({ reset: true });
    }
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
    if (state.connId === id) {
      state.connId = state.connections[0]?.id ?? null;
      resetBrowserContext();
    }
    void loadCredentialStorage();
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
    if (state.connectionEditor || state.confirm || document.hidden) return;
    if (state.page === "monitor") void loadMonitor();
    else void loadOverview();
  }, 4000);
}

export function stopPolling() {
  if (timer != null) window.clearInterval(timer);
  timer = null;
}
