import { DEFAULT_SCHEME, isScheme, type Scheme } from "./themes";

export interface Settings {
  scheme: Scheme;
  keyGrouping: boolean;
  scanCount: number;
  maxValueBytes: number;
  cliHistoryLimit: number;
  cliReadOnlyDefault: boolean;
  maskSecrets: boolean;
  language: "zh" | "en";
}

const STORAGE_KEY = "redis-manager.settings.v3";
/** Pre-v3 records carried a `theme` field; only their scheme survives the redesign. */
const LEGACY_KEY = "redis-manager.settings.v2";

export const DEFAULT_SETTINGS: Settings = {
  scheme: DEFAULT_SCHEME,
  keyGrouping: true,
  scanCount: 200,
  maxValueBytes: 2 * 1024 * 1024,
  cliHistoryLimit: 500,
  cliReadOnlyDefault: true,
  maskSecrets: false,
  language: "zh",
};

type Listener = (settings: Settings, changed: ReadonlySet<keyof Settings>) => void;

class SettingsStore {
  private current: Settings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<Listener>();

  constructor() {
    this.current = this.load();
  }

  /** Returns the whole settings object, or one value when a key is given. */
  get(): Settings;
  get<K extends keyof Settings>(key: K): Settings[K];
  get<K extends keyof Settings>(key?: K): Settings | Settings[K] {
    return key === undefined ? this.current : this.current[key];
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  patch(patch: Partial<Settings>) {
    const changed = new Set<keyof Settings>();
    const next: Settings = { ...this.current };

    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      const value = patch[key];
      if (value === undefined) continue;
      if (next[key] !== value) {
        (next as unknown as Record<string, unknown>)[key] = value;
        changed.add(key);
      }
    }
    if (changed.size === 0) return;

    this.current = next;
    this.save();
    this.applyTheme();
    for (const listener of this.listeners) listener(this.current, changed);
  }

  reset() {
    this.current = { ...DEFAULT_SETTINGS };
    this.save();
    this.applyTheme();
    const all = new Set(Object.keys(this.current) as (keyof Settings)[]);
    for (const listener of this.listeners) listener(this.current, all);
  }

  /** Reflects the scheme on the document so CSS can do the rest. */
  applyTheme() {
    const root = document.documentElement;
    root.dataset.scheme = this.current.scheme;
  }

  private load(): Settings {
    try {
      const stored = readObject(STORAGE_KEY);
      if (stored) return normalize(stored);
      const legacy = readObject(LEGACY_KEY);
      // A returning user keeps the scheme they chose; the old four-theme look
      // is gone, so its `theme` field has no successor to map onto.
      if (legacy) return normalize({ ...legacy, scheme: legacy.scheme });
      return { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.current));
    } catch {
      /* localStorage can be unavailable in hardened webviews — settings then live for the session. */
    }
  }
}

function readObject(key: string): Record<string, unknown> | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
}

function normalize(parsed: Record<string, unknown>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...(parsed as Partial<Settings>),
    scheme: isScheme(parsed.scheme) ? parsed.scheme : DEFAULT_SETTINGS.scheme,
    scanCount: clamp(Number(parsed.scanCount) || DEFAULT_SETTINGS.scanCount, 10, 1000),
    maxValueBytes: clamp(Number(parsed.maxValueBytes) || DEFAULT_SETTINGS.maxValueBytes, 64 * 1024, 64 * 1024 * 1024),
    cliHistoryLimit: clamp(Number(parsed.cliHistoryLimit) || DEFAULT_SETTINGS.cliHistoryLimit, 50, 5000),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const settings = new SettingsStore();
