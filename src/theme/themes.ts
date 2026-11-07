/**
 * Theme catalog.
 *
 * A *theme* is a complete visual language: typography, spacing, radius,
 * elevation tokens **and** a handful of structural axes that every themed
 * component reads through CSS variables (`--slot-*`, `--density`…). Theming
 * never means forking a view: components are written once against tokens,
 * each theme only redefines the tokens (see `themes.css`).
 */

export type ThemeId = "terminal" | "craft" | "console" | "airy";
export type Scheme = "dark" | "light";

export interface ThemeMeta {
  id: ThemeId;
  /** Family name used in the settings picker. */
  name: string;
  /** One-line pitch. */
  tagline: string;
  /** Default colour scheme; `null` means the theme is single-scheme. */
  schemes: Scheme[] | null;
  defaultScheme: Scheme;
  /** Short description shown under the name. */
  description: string;
  /** Accent used for the swatch / thumbnail in the picker (static, not themed). */
  swatch: [string, string];
}

export const THEMES: ThemeMeta[] = [
  {
    id: "terminal",
    name: "Terminal",
    tagline: "终端极客",
    description: "全等宽字体、琥珀荧光、ASCII 方框与进度条，0 圆角。给惯用 redis-cli 的人。",
    schemes: null,
    defaultScheme: "dark",
    swatch: ["#0a0c0b", "#ff9f1c"],
  },
  {
    id: "craft",
    name: "Craft",
    tagline: "雅致工具",
    description: "暖纸色与衬线标题、1px 细线、大留白。阅读性最好，适合长时间工作。",
    schemes: ["light", "dark"],
    defaultScheme: "light",
    swatch: ["#f6f3ec", "#3f7d5b"],
  },
  {
    id: "console",
    name: "Console",
    tagline: "数据工作台",
    description: "深色高密度仪表盘、珊瑚点缀、等宽数字，常驻上下文条与 ⌘K 命令面板。",
    schemes: ["dark", "light"],
    defaultScheme: "dark",
    swatch: ["#0b0c0e", "#ff6b5a"],
  },
  {
    id: "airy",
    name: "Airy",
    tagline: "轻盈玻璃",
    description: "悬浮大圆角窗口、毛玻璃侧栏、紫粉渐变与柔和光晕，第一眼最友好。",
    schemes: ["dark", "light"],
    defaultScheme: "dark",
    swatch: ["#8b7cff", "#ff7eb6"],
  },
];

export const DEFAULT_THEME: ThemeId = "console";

export function themeMeta(id: ThemeId): ThemeMeta {
  return THEMES.find((item) => item.id === id) ?? THEMES[2]!;
}

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((item) => item.id === value);
}

export function isScheme(value: unknown): value is Scheme {
  return value === "dark" || value === "light";
}
