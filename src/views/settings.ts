import { icon } from "../core/icons";
import { bytes, esc } from "../core/format";
import type { ViewState } from "../core/store";
import { SCHEMES, type Scheme } from "../theme/themes";
import { settings } from "../theme/settings";
import { btn, kvList, pane, switchControl } from "../ui/kit";

/**
 * Settings owns the durable preferences. There is no theme gallery any more:
 * one world, two schemes, and every other row is a number the user chose.
 */
export function settingsView(s: ViewState): string {
  const current = settings.get();
  const info = s.appInfo;
  const updateStatus = s.appInfoLoading
    ? "正在读取软件版本…"
    : s.appInfoError || (info?.isDev
      ? "开发构建不会检查软件更新。"
      : info?.updatesEnabled
        ? "发现新版本时会显示更新提示，可选择安装、稍后提醒或跳过。"
        : "此构建或安装位置暂不支持自动更新。");

  return `<div class="settings">
    <div class="settings-stack">
      ${pane({
        title: "配色",
        meta: "切换后立即生效并记住",
        cls: "settings-scheme",
        body: `<div class="scheme-picker">${SCHEMES.map((sc) => schemeCard(sc.id, current.scheme === sc.id)).join("")}</div>
          <p class="hint" style="margin-top:10px">界面只有一套视觉语言，深浅色只是同一套 tokens 的两种取值；数据颜色、列宽与密度保持不变。</p>`,
      })}
      ${pane({
        title: "键浏览",
        cls: "settings-browse",
        body: `<div class="setting-row"><div><b>按前缀分组键</b><span class="hint">把 user:1001 归到 user: 组下折叠显示</span></div>${switchControl(current.keyGrouping, "set-key-grouping", "按前缀分组键")}</div>
          <div class="setting-row"><div><b>SCAN 批量</b><span class="hint">每次 SCAN 的 COUNT，越大单次越快但越占带宽</span></div>
            <select class="select" data-setting="scanCount" aria-label="SCAN 批量">${[50, 100, 200, 500, 1000].map((n) => `<option value="${n}" ${current.scanCount === n ? "selected" : ""}>${n}</option>`).join("")}</select>
          </div>
          <div class="setting-row"><div><b>单次载入值上限</b><span class="hint">超过上限的值只渲染前 200 KB，避免界面卡死</span></div>
            <select class="select" data-setting="maxValueBytes" aria-label="单次载入值上限">${[
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
      ${pane({
        title: "命令行",
        cls: "settings-cli",
        body: `<div class="setting-row"><div><b>新会话默认只读</b><span class="hint">写命令会被拦截，需要手动切到可写</span></div>${switchControl(current.cliReadOnlyDefault, "set-cli-readonly", "新会话默认只读")}</div>
          <div class="setting-row"><div><b>历史条数</b><span class="hint">会话内 ↑↓ 可翻阅的命令条数</span></div>
            <select class="select" data-setting="cliHistoryLimit" aria-label="历史条数">${[100, 200, 500, 1000].map((n) => `<option value="${n}" ${current.cliHistoryLimit === n ? "selected" : ""}>${n}</option>`).join("")}</select>
          </div>`,
      })}
      ${pane({
        title: "凭据与安全",
        cls: "settings-security",
        body: `<div class="setting-row"><div><b>密码存储</b><span class="hint">MyGo 系统凭据存储，不可用时回退到 0600 权限的配置文件</span></div><span class="badge ok">${icon("lock", 10)} 系统凭据</span></div>
          <div class="setting-row"><div><b>危险命令保护</b><span class="hint">KEYS / FLUSHALL 等会拦截并要求改用安全替代</span></div><span class="badge acc">已启用</span></div>
          <div class="setting-row"><div><b>连接配置文件</b><span class="hint">非敏感字段保存在应用支持目录</span></div><span class="mono faint" style="font-size:11px">connections.json</span></div>`,
      })}
      ${pane({
        title: "快捷键",
        cls: "settings-keys",
        body: `<div class="kv-list">
          ${[
            ["⌘K", "命令面板：搜索连接、键、视图，或直接执行命令"],
            ["⌘1 – ⌘4", "切换实例视图：总览 / 键 / 命令行 / 监控"],
            ["⌘T", "在命令行新建会话"],
            ["⌘,", "打开设置"],
            ["⌘R", "立即重新采样"],
            ["⌘L", "清空当前命令行会话"],
            ["↑ ↓", "命令行历史 · Tab 补全命令名"],
            ["Esc", "关闭面板、对话框或编辑器"],
          ]
            .map(([key, what]) => `<div class="kv-row"><span class="kv-k">${esc(key)}</span><span class="kv-v">${esc(what)}</span></div>`)
            .join("")}
        </div>`,
      })}
      ${pane({
        title: "关于",
        cls: "settings-about",
        body: `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 24px">
            ${kvList([
              { k: "版本", v: info?.version || (info?.isDev ? "开发版" : "—"), version: true },
              { k: "运行时", v: "Go + MyGo 0.7.4 · WebView" },
              { k: "Redis 客户端", v: "go-redis v9" },
              { k: "单次载入上限", v: bytes(current.maxValueBytes) },
            ])}
          </div>
          <div class="setting-row" style="margin-top:6px"><div><b>软件更新</b><span class="hint" data-update-status>${esc(updateStatus)}</span></div>
            <button class="btn" data-action="check-updates" ${!info?.updatesEnabled || s.openingUpdater ? "disabled" : ""}>${icon("refresh", 12)} ${s.openingUpdater ? "正在打开…" : "检查更新"}</button>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">${btn("恢复默认设置", "reset-settings", { kind: "ghost", iconName: "refresh" })}</div>`,
      })}
    </div>
  </div>`;
}

function schemeCard(id: Scheme, selected: boolean): string {
  const meta = SCHEMES.find((x) => x.id === id)!;
  return `<button class="scheme-card ${selected ? "selected" : ""}" data-pick-scheme="${id}" aria-pressed="${selected}">
    ${thumb(id)}
    <div class="scheme-card-text">
      <div class="scheme-card-name">${esc(meta.label)}</div>
      <div class="scheme-card-desc">${esc(meta.hint)}</div>
    </div>
    ${selected ? `<span class="scheme-check">${icon("check", 13)}</span>` : ""}
  </button>`;
}

/** A miniature of the real shell in each scheme's own tokens. */
function thumb(id: Scheme): string {
  const dark = id === "dark";
  const bg = dark ? "#101417" : "#ffffff";
  const side = dark ? "#151a1e" : "#fbfbfc";
  const line = dark ? "#262e34" : "#e3e6ea";
  const fg = dark ? "#9aa6ae" : "#5f6b76";
  const acc = dark ? "#35b8c6" : "#0f8f9e";
  return `<svg class="scheme-thumb" viewBox="0 0 84 52" aria-hidden="true">
    <rect width="84" height="52" fill="${bg}"/>
    <rect width="26" height="52" fill="${side}"/>
    <line x1="26" y1="0" x2="26" y2="52" stroke="${line}"/>
    <line x1="0" y1="9" x2="84" y2="9" stroke="${line}"/>
    <line x1="0" y1="45" x2="84" y2="45" stroke="${line}"/>
    <rect x="3" y="13" width="18" height="3" fill="${acc}" opacity=".9"/>
    <rect x="3" y="20" width="13" height="2" fill="${fg}" opacity=".55"/>
    <rect x="3" y="26" width="16" height="2" fill="${fg}" opacity=".4"/>
    <rect x="30" y="13" width="26" height="2" fill="${fg}" opacity=".5"/>
    <rect x="60" y="13" width="20" height="2" fill="${fg}" opacity=".3"/>
    <rect x="30" y="22" width="12" height="2" fill="${fg}" opacity=".7"/>
    <rect x="47" y="22" width="12" height="2" fill="${fg}" opacity=".45"/>
    <rect x="64" y="22" width="16" height="2" fill="${fg}" opacity=".45"/>
    <rect x="30" y="29" width="10" height="2" fill="${fg}" opacity=".7"/>
    <rect x="45" y="29" width="14" height="2" fill="${fg}" opacity=".45"/>
    <rect x="64" y="29" width="16" height="2" fill="${fg}" opacity=".45"/>
    <rect x="30" y="36" width="8" height="2" fill="${acc}" opacity=".9"/>
    <rect x="43" y="36" width="13" height="2" fill="${fg}" opacity=".45"/>
    <rect x="64" y="36" width="16" height="2" fill="${fg}" opacity=".45"/>
  </svg>`;
}
