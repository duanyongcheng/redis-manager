import * as bindings from "../mygo";
import type {
  CLIResult,
  Connection,
  ConnectionTest,
  KeyPage,
  MonitorSnapshot,
  OverviewSnapshot,
  RedisValue,
} from "../mygo";

/**
 * The Go side (`RedisService`) is the only source of truth. This module is the
 * single seam where the UI talks to it, so components never import bindings
 * directly and previewing the shell without the Go runtime stays trivial.
 */
export type Service = typeof bindings.RedisService;

export interface Api {
  available: boolean;
  service: Service | null;
}

const globalService = (window as unknown as { RedisService?: Service }).RedisService;

/**
 * The generated client only works inside a MyGo window; its calls are
 * forwarded to the Go runtime through an injected bridge. Pull it in through
 * `window.RedisService` (written before this module evaluates) or the module
 * export — whichever exists.
 */
export const api: Api = {
  available: Boolean(globalService ?? bindings.RedisService),
  service: globalService ?? bindings.RedisService ?? null,
};

export class ApiUnavailableError extends Error {
  constructor() {
    super("未检测到 Go 服务：请用 `bun run dev` 启动完整应用（仅 `bun run dev:web` 时没有绑定）。");
    this.name = "ApiUnavailableError";
  }
}

function svc(): Service {
  if (!api.service) throw new ApiUnavailableError();
  return api.service;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export const redis = {
  listConnections: (): Promise<Connection[]> => svc().listConnections(),
  saveConnection: (input: Connection, password: string): Promise<void> => svc().saveConnection(input, password),
  deleteConnection: (id: string): Promise<void> => svc().deleteConnection(id),
  testConnection: (input: Connection, password: string): Promise<ConnectionTest> => svc().testConnection(input, password),
  checkConnection: (id: string): Promise<ConnectionTest> => svc().checkConnection(id),
  getOverview: (id: string, db: number): Promise<OverviewSnapshot> => svc().getOverview(id, db),
  getMonitorSnapshot: (id: string, db: number): Promise<MonitorSnapshot> => svc().getMonitorSnapshot(id, db),
  scanKeys: (id: string, db: number, pattern: string, cursor: number, count: number): Promise<KeyPage> =>
    svc().scanKeys(id, db, pattern, cursor, count),
  getValue: (id: string, key: string): Promise<RedisValue> => svc().getValue(id, key),
  deleteKey: (id: string, key: string): Promise<void> => svc().deleteKey(id, key),
  hashSet: (id: string, key: string, field: string, value: string): Promise<void> => svc().hashSet(id, key, field, value),
  execCLI: (id: string, db: number, line: string, readOnly: boolean): Promise<CLIResult> => svc().execCLI(id, db, line, readOnly),
};

export type { CLIResult, Connection, ConnectionTest, KeyPage, MonitorSnapshot, OverviewSnapshot, RedisValue };
