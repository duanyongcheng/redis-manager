import * as bindings from "../mygo";
import { isMyGo } from "mygo-runtime";
import type {
  AppInfo,
  CLIResult,
  Connection,
  ConnectionTest,
  CredentialStorageStatus,
  KeyPage,
  MonitorSnapshot,
  OverviewSnapshot,
  RedisValue,
} from "../mygo";

export type CredentialStorageMode = "local" | "keychain";

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

declare global {
  interface Window {
    AppService?: typeof bindings.AppService;
  }
}

// A browser fixture can supply AppService explicitly. Ordinary browser pages
// must not pretend that importing a generated client creates a native bridge.
const appService = window.AppService ?? (isMyGo() ? bindings.AppService : null);

export const application = {
  available: appService !== null,
  getAppInfo: (): Promise<AppInfo> => {
    if (!appService) return Promise.reject(new Error("软件更新仅在 Redis Manager 桌面应用中可用。"));
    return appService.getAppInfo();
  },
  checkForUpdates: (): Promise<void> => {
    if (!appService) return Promise.reject(new Error("软件更新仅在 Redis Manager 桌面应用中可用。"));
    return appService.checkForUpdates();
  },
};

/**
 * The generated client only works inside a MyGo window; its calls are
 * forwarded to the Go runtime through an injected bridge. Pull it in through
 * `window.RedisService` (when an external mock is injected) or the generated
 * MyGo bindings when running inside the desktop WebView.
 */
const resolvedService =
  globalService && globalService !== bindings.RedisService
    ? globalService
    : isMyGo()
      ? bindings.RedisService
      : null;

export const api: Api = {
  available: resolvedService !== null,
  service: resolvedService,
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
  getCredentialStorage: (): Promise<CredentialStorageStatus> => {
    const s = svc() as Partial<Service>;
    if (typeof s.getCredentialStorage !== "function" || (s === bindings.RedisService && !isMyGo())) {
      return Promise.resolve({ mode: "local", keychainPending: 0 });
    }
    return s.getCredentialStorage();
  },
  setCredentialStorage: (mode: CredentialStorageMode): Promise<CredentialStorageStatus> => {
    const s = svc() as Partial<Service>;
    if (typeof s.setCredentialStorage !== "function" || (s === bindings.RedisService && !isMyGo())) {
      return Promise.reject(new Error("密码存储切换仅在 Redis Manager 桌面应用中可用。"));
    }
    return s.setCredentialStorage(mode);
  },
  saveConnection: (input: Connection, password: string): Promise<void> => svc().saveConnection(input, password),
  deleteConnection: (id: string): Promise<void> => svc().deleteConnection(id),
  testConnection: (input: Connection, password: string): Promise<ConnectionTest> => svc().testConnection(input, password),
  checkConnection: (id: string): Promise<ConnectionTest> => svc().checkConnection(id),
  getOverview: (id: string, db: number): Promise<OverviewSnapshot> => svc().getOverview(id, db),
  getMonitorSnapshot: (id: string, db: number): Promise<MonitorSnapshot> => svc().getMonitorSnapshot(id, db),
  scanKeys: (id: string, db: number, pattern: string, cursor: number, count: number): Promise<KeyPage> =>
    svc().scanKeys(id, db, pattern, cursor, count),
  getValue: (id: string, db: number, key: string): Promise<RedisValue> => svc().getValue(id, db, key),
  deleteKey: (id: string, db: number, key: string): Promise<void> => svc().deleteKey(id, db, key),
  setTTL: (id: string, db: number, key: string, ttlSeconds: number): Promise<void> => {
    const s = svc() as Partial<Service>;
    if (typeof s.setTTL !== "function") {
      return Promise.reject(new Error("当前环境不支持修改 TTL"));
    }
    return s.setTTL(id, db, key, ttlSeconds);
  },
  setString: (id: string, db: number, key: string, value: string): Promise<void> => {
    const s = svc() as Partial<Service>;
    if (typeof s.setString !== "function") {
      return Promise.reject(new Error("当前环境不支持写入 String"));
    }
    return s.setString(id, db, key, value);
  },
  hashSet: (id: string, db: number, key: string, field: string, value: string): Promise<void> => svc().hashSet(id, db, key, field, value),
  hashDelete: (id: string, db: number, key: string, field: string): Promise<void> => {
    const s = svc() as Partial<Service>;
    if (typeof s.hashDelete !== "function") {
      return Promise.reject(new Error("当前环境不支持删除 Hash 字段"));
    }
    return s.hashDelete(id, db, key, field);
  },
  execCLI: (id: string, db: number, line: string, readOnly: boolean): Promise<CLIResult> => svc().execCLI(id, db, line, readOnly),
};

export type {
  AppInfo,
  CLIResult,
  Connection,
  ConnectionTest,
  CredentialStorageStatus,
  KeyPage,
  MonitorSnapshot,
  OverviewSnapshot,
  RedisValue,
};
