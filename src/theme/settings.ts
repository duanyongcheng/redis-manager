import { DEFAULT_THEME, isScheme, isThemeId, themeMeta, type Scheme, type ThemeId } from "./themes";

export interface Settings {
  theme: ThemeId;
  scheme: Scheme;
  sidebarCollapsed: boolean;
  keyGrouping: boolean;
  scanCount: number;
  maxValueBytes: number;
  cliHistoryLimit: number;
  cliReadOnlyDefault: boolean;
  maskSecrets: boolean;
  language: "zh" | "en";
}

const STORAGE_KEY = "redis-manager.settings.v2";

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME,
  scheme: themeMeta(DEFAULT_THEME).defaultScheme,
  sidebarCollapsed: false,
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

    // A scheme that the newly picked theme does not support falls back to the
    // theme's own default, so switching themes never yields an unstyled state.
    if (changed.has("theme") && isThemeId(next.theme)) {
      const meta = themeMeta(next.theme);
      if (!meta.schemes) {
        next.scheme = meta.defaultScheme;
        changed.add("scheme");
      } else if (!meta.schemes.includes(next.scheme)) {
        next.scheme = meta.defaultScheme;
        changed.add("scheme");
      }
    }

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

  /** Reflects theme + scheme on the document so CSS can do the rest. */
  applyTheme() {
    const root = document.documentElement;
    root.dataset.theme = this.current.theme;
    root.dataset.scheme = this.current.scheme;
    root.dataset.sidebar = this.current.sidebarCollapsed ? "collapsed" : "expanded";
  }

  private load(): Settings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw) as Partial<Settings>;
      const theme = isThemeId(parsed.theme) ? parsed.theme : DEFAULT_SETTINGS.theme;
      const meta = themeMeta(theme);
      const scheme = isScheme(parsed.scheme) && (!meta.schemes || meta.schemes.includes(parsed.scheme)) ? parsed.scheme : meta.defaultScheme;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        theme,
        scheme,
        scanCount: clamp(Number(parsed.scanCount) || DEFAULT_SETTINGS.scanCount, 10, 1000),
        maxValueBytes: clamp(Number(parsed.maxValueBytes) || DEFAULT_SETTINGS.maxValueBytes, 64 * 1024, 64 * 1024 * 1024),
        cliHistoryLimit: clamp(Number(parsed.cliHistoryLimit) || DEFAULT_SETTINGS.cliHistoryLimit, 50, 5000),
      };
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const settings = new SettingsStore();
