/**
 * Schemes.
 *
 * The product ships one visual world — a flat, ruled protocol-analyser surface
 * — in two schemes. Light is the default (the owner's choice); dark is a
 * first-class alternative for night sessions and dark rooms.
 */
export type Scheme = "dark" | "light";

export const SCHEMES: { id: Scheme; label: string; hint: string }[] = [
  { id: "light", label: "浅色", hint: "纸白底与细规线，默认配色；白天、投影和长时间阅读都更省力" },
  { id: "dark", label: "深色", hint: "暗底上低调的青色强调，适合夜间和暗环境" },
];

export const DEFAULT_SCHEME: Scheme = "light";

export function isScheme(value: unknown): value is Scheme {
  return value === "dark" || value === "light";
}
