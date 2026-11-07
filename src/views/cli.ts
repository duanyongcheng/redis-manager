import { icon } from "../core/icons";
import { connAddress, esc } from "../core/format";
import { activeCliSession, cliSessionsFor, currentConnection, type CliSession, type ViewState } from "../core/store";
import { settings } from "../theme/settings";
import { emptyState } from "../ui/kit";

export function cliView(s: ViewState): string {
  const conn = currentConnection();
  if (!conn) return emptyState("还没有连接", "CLI 需要先选择一个连接。", { label: "新建连接", action: "new-connection" });
  const sessions = cliSessionsFor(conn);
  const active = activeCliSession();
  if (!active) return "";

  const sessionTabs = sessions
    .map(
      (session, i) => `<button class="cli-session ${session === active ? "active" : ""}" data-cli-session="${i}">${esc(session.name)}${session === active ? `<span class="kbd" style="margin-left:6px">${i}</span>` : ""}</button>`,
    )
    .join("");

  return `<div class="cli">
    <header class="cli-bar">
      <div class="cli-sessions scroll">${sessionTabs}<button class="cli-session add" data-action="new-cli-session" title="新会话（⌘T）">${icon("plus", 12)} 新会话</button></div>
      <div class="cli-mode">
        <div class="segmented">
          <button class="${active.readOnly ? "active" : ""}" data-cli-mode="readonly">${icon("lock", 11)} 只读</button>
          <button class="${active.readOnly ? "" : "active"}" data-cli-mode="write">可写</button>
        </div>
      </div>
    </header>
    <div class="cli-term scroll" id="cli-log">${logHtml(active, conn)}</div>
    <div class="cli-suggest">${suggestions(active)}</div>
    <form class="cli-prompt" id="cli-form">
      <span class="prompt mono">${esc(connAddress(conn))}[${conn.db}]&gt;</span>
      <input id="cli-input" class="mono" placeholder="输入命令，Enter 执行，↑↓ 历史" autocomplete="off" spellcheck="false" />
      <button class="btn primary sm" type="submit">${icon("play", 11)} 执行</button>
    </form>
  </div>`;
}

function logHtml(session: CliSession, conn: NonNullable<ReturnType<typeof currentConnection>>): string {
  if (!session.lines.length) {
    return `<div class="cli-welcome">
      <div class="dim">Redis Manager CLI · ${esc(connAddress(conn))}/db${conn.db}</div>
      <div class="faint">已连接 ${esc(conn.name)}。当前为${session.readOnly ? "只读" : "可写"}模式，↑/↓ 浏览历史，⌘K 清屏。</div>
      <div class="faint">试试 <span class="acc">INFO server</span>、<span class="acc">DBSIZE</span> 或 <span class="acc">SCAN 0 COUNT 10</span>。</div>
    </div>`;
  }
  return session.lines
    .map((entry) => {
      const prompt = `<div class="cli-cmd mono"><span class="prompt">${esc(connAddress(conn))}[${conn.db}]&gt;</span> <span>${esc(entry.command ?? "")}</span></div>`;
      const out = (entry.lines ?? [])
        .map((line) => `<div class="cli-line ${esc(line.kind)} mono">${esc(line.text)}</div>`)
        .join("");
      return `${prompt}${out}`;
    })
    .join("");
}

function suggestions(session: CliSession): string {
  if (!session.history.length) {
    return `${["INFO server", "DBSIZE", "SCAN 0 COUNT 10", "CLIENT LIST", "SLOWLOG GET 5"].map((c) => `<button class="chip" data-fill="${esc(c)}">${esc(c)}</button>`).join("")}
      <span class="spacer"></span><span class="faint mono" style="font-size:10.5px">Tab 补全 · ↑↓ 历史 · ⌘K 清屏</span>`;
  }
  return `<span class="faint mono" style="font-size:10.5px">最近：</span>${session.history
    .slice(-6)
    .reverse()
    .map((c) => `<button class="chip mono" data-fill="${esc(c)}">${esc(c)}</button>`)
    .join("")}<span class="spacer"></span><span class="faint mono" style="font-size:10.5px">历史 ${session.history.length}/${settings.get("cliHistoryLimit")}</span>`;
}

