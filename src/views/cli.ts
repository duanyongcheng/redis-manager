import { icon } from "../core/icons";
import { connAddress, esc } from "../core/format";
import { activeCliSession, cliSessionsFor, currentConnection, currentDb, type CliSession, type ViewState } from "../core/store";
import { settings } from "../theme/settings";
import { emptyState } from "../ui/kit";

export function cliView(s: ViewState): string {
  const conn = currentConnection();
  if (!conn) return emptyState("还没有连接", "CLI 需要先选择一个连接。", { label: "新建连接", action: "new-connection" });
  const db = currentDb(conn);
  const sessions = cliSessionsFor(conn);
  const active = activeCliSession();
  if (!active) return "";

  const sessionTabs = sessions
    .map(
      (session, i) => `<button type="button" class="cli-session ${session === active ? "active" : ""}" data-session-tab="${i}">${esc(session.name)}${session === active ? `<span class="kbd">${i}</span>` : ""}</button>`,
    )
    .join("");

  return `<div class="cli">
    <header class="cli-bar">
      <div class="cli-sessions">${sessionTabs}<button type="button" class="cli-session add" data-cli-new title="新会话（⌘T）" data-action="new-cli-session">${icon("plus", 11)} 新会话</button></div>
      <div class="cli-mode">
        <span class="mlabel">模式</span>
        <div class="segmented">
          <button class="${active.readOnly ? "active" : ""}" data-cli-mode="readonly" aria-pressed="${active.readOnly}">${icon("lock", 10)} 只读</button>
          <button class="${active.readOnly ? "" : "active"}" data-cli-mode="write" aria-pressed="${!active.readOnly}">可写</button>
        </div>
      </div>
    </header>
    <div class="cli-rule"></div>
    <div class="cli-term scroll" id="cli-log">${logHtml(active, conn)}</div>
    <div class="cli-suggest">${suggestions(active)}</div>
    <form class="cli-prompt" id="cli-form">
      <span class="prompt mono">${esc(connAddress(conn))}[${db}]&gt;</span>
      <input id="cli-input" data-session="${esc(active.id)}" class="mono" placeholder="输入 Redis 命令，Enter 执行" autocomplete="off" spellcheck="false" aria-label="Redis 命令" value="${esc(active.input ?? "")}" />
      <span class="faint mono cli-enter">↵</span>
    </form>
  </div>`;
}

function logHtml(session: CliSession, conn: NonNullable<ReturnType<typeof currentConnection>>): string {
  const db = currentDb(conn);
  if (!session.lines.length) {
    return `<div class="cli-welcome">
      <div class="dim">Redis Manager CLI · ${esc(connAddress(conn))}/db${db}</div>
      <div class="faint">已连接 ${esc(conn.name)}，当前为${session.readOnly ? "只读" : "可写"}模式 · ↑/↓ 浏览历史 · Tab 补全命令 · ⌘K 清屏</div>
      <div class="faint">试试 <span class="acc">INFO keyspace</span>、<span class="acc">DBSIZE</span> 或 <span class="acc">SCAN 0 MATCH user:* COUNT 10</span>。</div>
    </div>`;
  }
  return session.lines
    .map((entry) => {
      const prompt = `<div class="cli-cmd mono"><span class="prompt">${esc(connAddress(conn))}[${db}]&gt;</span> <span>${esc(entry.command ?? "")}</span></div>`;
      const out = (entry.lines ?? [])
        .map((line) => `<div class="cli-line ${esc(line.kind)} mono">${colourLine(line.kind, line.text)}</div>`)
        .join("");
      return `${prompt}${out}`;
    })
    .join("");
}

/**
 * Redis' own reply tokens keep their shape; only the ones with a fixed
 * vocabulary are coloured, so values stay literal and copyable.
 */
function colourLine(kind: string, text: string): string {
  const plain = esc(text);
  const lead = text.trim();
  if (lead === "(nil)" || lead === "(empty array)" || lead === "(empty list or set)") return `<span class="tok-nil">${plain}</span>`;
  if (lead === "OK" || lead === "PONG" || lead === "QUEUED") return `<span class="tok-ok">${plain}</span>`;
  if (kind === "error" || /^\(error\)/i.test(lead)) return `<span class="tok-err">${plain}</span>`;
  return plain;
}

function suggestions(session: CliSession): string {
  if (!session.history.length) {
    return `${["INFO server", "DBSIZE", "SCAN 0 COUNT 10", "CLIENT LIST", "SLOWLOG GET 5"].map((c) => `<button class="chip" data-fill="${esc(c)}">${esc(c)}</button>`).join("")}
      <span class="spacer"></span><span class="faint mono">Tab 补全 · ↑↓ 历史 · ⌘K 清屏</span>`;
  }
  return `<span class="faint mono">最近</span>${session.history
    .slice(-6)
    .reverse()
    .map((c) => `<button class="chip mono" data-fill="${esc(c)}">${esc(c)}</button>`)
    .join("")}<span class="spacer"></span><span class="faint mono">历史 ${session.history.length}/${settings.get("cliHistoryLimit")}</span>`;
}

