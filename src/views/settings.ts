import { icon } from "../core/icons";
import { bytes, esc } from "../core/format";
import { THEMES, themeMeta, type ThemeId } from "../theme/themes";
import { settings } from "../theme/settings";
import { btn, card, switchControl } from "../ui/kit";

export function settingsView(): string {
  const current = settings.get();
  return `<div class="settings">
    <div class="page-head"><h1>设置</h1><span class="sub">主题 · 浏览 · CLI · 凭据</span></div>
    <div class="settings-stack">
      ${card({ title: "外观 · 主题", iconName: "layers", meta: "切换后会立即应用并记住", body: themePicker(current.theme, current.scheme) })}
      ${card({
        title: "浏览",
        iconName: "listTree",
        body: `<div class="setting-row"><div><b>按前缀分组键</b><span class="hint">把 user:1001 归到 user: 组下折叠显示</span></div>${switchControl(current.keyGrouping, "set-key-grouping", "按前缀分组键")}</div>
          <div class="setting-row"><div><b>SCAN 批量</b><span class="hint">每次 SCAN 的 COUNT，越大单次越快但越占带宽</span></div>
            <select class="select" data-setting="scanCount">${[50, 100, 200, 500, 1000].map((n) => `<option value="${n}" ${current.scanCount === n ? "selected" : ""}>${n}</option>`).join("")}</select>
          </div>
          <div class="setting-row"><div><b>单次载入值上限</b><span class="hint">超过上限的值只渲染前 200 KB，避免界面卡死</span></div>
            <select class="select" data-setting="maxValueBytes">${[
              [256 * 1024, "256 KB"],
              [1024 * 1024, "1 MB"],
              [2 * 1024 * 1024, "2 MB"],
              [8 * 1024 * 1024, "8 MB"],
              [32 * 1024 * 1024, "32 MB"],
            ]
              .map(([v, label]) => `<option value="${v}" ${current.maxValueBytes === v ? "selected" : ""}>${label}</option>`)
              .join("")}</select>
          </div>`,
      })}
      ${card({
        title: "CLI",
        iconName: "terminal",
        body: `<div class="setting-row"><div><b>新会话默认只读</b><span class="hint">写命令会被拦截，需要手动切到可写</span></div>${switchControl(current.cliReadOnlyDefault, "set-cli-readonly", "新会话默认只读")}</div>
          <div class="setting-row"><div><b>历史条数</b><span class="hint">会话内 ↑↓ 可翻阅的命令条数</span></div>
            <select class="select" data-setting="cliHistoryLimit">${[100, 200, 500, 1000].map((n) => `<option value="${n}" ${current.cliHistoryLimit === n ? "selected" : ""}>${n}</option>`).join("")}</select>
          </div>`,
      })}
      ${card({
        title: "凭据与安全",
        iconName: "shield",
        body: `<div class="setting-row"><div><b>密码存储</b><span class="hint">MyGo 系统凭据存储，不可用时回退到 0600 权限的配置文件</span></div><span class="badge ok">${icon("lock", 11)} 系统凭据</span></div>
          <div class="setting-row"><div><b>危险命令保护</b><span class="hint">KEYS / FLUSHALL 等会拦截并要求改用安全替代</span></div><span class="badge acc">已启用</span></div>
          <div class="setting-row"><div><b>连接配置文件</b><span class="hint">非敏感字段保存在应用支持目录</span></div><span class="mono faint" style="font-size:11px">connections.json</span></div>`,
      })}
      ${card({
        title: "关于",
        iconName: "info",
        body: `<div class="kv-list">
          <div class="kv-row"><span class="kv-k">版本</span><span class="kv-v">0.1.0</span></div>
          <div class="kv-row"><span class="kv-k">运行时</span><span class="kv-v">Go + MyGo 0.7.4 · WebView</span></div>
          <div class="kv-row"><span class="kv-k">Redis 客户端</span><span class="kv-v">go-redis v9</span></div>
          <div class="kv-row"><span class="kv-k">单次载入上限</span><span class="kv-v">${bytes(current.maxValueBytes)}</span></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px">${btn("恢复默认设置", "reset-settings", { kind: "ghost", iconName: "refresh" })}</div>`,
      })}
    </div>
  </div>`;
}

function themePicker(active: ThemeId, scheme: "dark" | "light"): string {
  const cards = THEMES.map((theme) => {
    const selected = theme.id === active;
    return `<button class="theme-card ${selected ? "selected" : ""}" data-pick-theme="${theme.id}" aria-pressed="${selected}">
      ${thumb(theme.id)}
      <div class="theme-card-text">
        <div class="theme-card-name">${esc(theme.name)} <span class="faint" style="font-weight:400">${esc(theme.tagline)}</span></div>
        <div class="theme-card-desc">${esc(theme.description)}</div>
      </div>
      ${selected ? `<span class="theme-check">${icon("check", 12)}</span>` : ""}
    </button>`;
  }).join("");

  const meta = themeMeta(active);
  const schemeRow = meta.schemes
    ? `<div class="theme-scheme">
        <span class="label">深浅色</span>
        <div class="segmented">${meta.schemes
          .map((s) => `<button class="${scheme === s ? "active" : ""}" data-pick-scheme="${s}">${s === "dark" ? `${icon("moon", 11)} 深色` : `${icon("sun", 11)} 浅色`}</button>`)
          .join("")}</div>
        <span class="faint" style="font-size:11px">${meta.name} ${meta.schemes.length > 1 ? "支持深浅两套配色" : "只提供深色配色"}</span>
      </div>`
    : `<div class="theme-scheme"><span class="label">深浅色</span><span class="faint" style="font-size:11px">${meta.name} 是单配色主题</span></div>`;

  return `<div class="theme-picker">${cards}</div>${schemeRow}`;
}

/** Tiny static mock of the shell, painted in each theme's real palette. */
function thumb(id: ThemeId): string {
  const presets: Record<ThemeId, { bg: string; panel: string; line: string; fg: string; acc: string; radius: number; mono?: boolean; grad?: boolean }> = {
    terminal: { bg: "#0a0c0b", panel: "#0d100e", line: "#2b3731", fg: "#ff9f1c", acc: "#ff9f1c", radius: 0, mono: true },
    craft: { bg: "#f6f3ec", panel: "#fffdf9", line: "#e3dccf", fg: "#3f7d5b", acc: "#c25c43", radius: 3 },
    console: { bg: "#0b0c0e", panel: "#15181d", line: "#2e343d", fg: "#e6e9ee", acc: "#ff6b5a", radius: 3 },
    airy: { bg: "#0a0b10", panel: "#161821", line: "#33354a", fg: "#c17bff", acc: "#ff7eb6", radius: 8, grad: true },
  };
  const p = presets[id];
  const fill = p.grad ? `url(#g-${id})` : p.acc;
  return `<svg class="theme-thumb" viewBox="0 0 168 104" aria-hidden="true">
    <defs><linearGradient id="g-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#8b7cff"/><stop offset="100%" stop-color="#ff7eb6"/></linearGradient></defs>
    <rect x="0" y="0" width="168" height="104" rx="${id === "airy" ? 10 : 0}" fill="${p.bg}"/>
    <rect x="${id === "airy" ? 6 : 0}" y="${id === "airy" ? 6 : 0}" width="${id === "airy" ? 44 : 42}" height="${id === "airy" ? 92 : 104}" rx="${p.radius}" fill="${p.panel}" stroke="${p.line}"/>
    <rect x="${id === "airy" ? 56 : 50}" y="${id === "airy" ? 12 : 8}" width="106" height="${id === "airy" ? 84 : 60}" rx="${p.radius}" fill="${p.panel}" stroke="${p.line}"/>
    <rect x="60" y="12" width="52" height="4" rx="2" fill="${p.acc}"/>
    ${[0, 1, 2, 3]
      .map((i) => `<rect x="${60 + i * 24}" y="22" width="20" height="16" rx="${p.radius}" fill="${p.bg}" stroke="${p.line}"/>`)
      .join("")}
    <rect x="60" y="44" width="98" height="${id === "airy" ? 46 : 20}" rx="${p.radius}" fill="${p.bg}" stroke="${p.line}"/>
    <path d="M64 ${id === "airy" ? 80 : 58} L76 ${id === "airy" ? 62 : 50} L88 ${id === "airy" ? 72 : 54} L100 ${id === "airy" ? 54 : 48} L112 ${id === "airy" ? 66 : 52} L124 ${id === "airy" ? 50 : 46} L150 ${id === "airy" ? 58 : 50}" fill="none" stroke="${fill}" stroke-width="${id === "airy" ? 2.4 : 1.6}" stroke-linecap="${id === "airy" ? "round" : "butt"}"/>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="8" y="${18 + i * 13}" width="${20 + ((i * 7) % 14)}" height="3" rx="1.5" fill="${i === 1 ? p.acc : p.line}"/>`).join("")}
  </svg>`;
}
