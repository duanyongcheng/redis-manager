import { icon } from "../core/icons";
import { connAddress, esc, modeLabel, ms } from "../core/format";
import { type Connection } from "../core/api";
import { currentConnection, currentDb, type ViewState } from "../core/store";
import { btn, emptyState, kvList, pane } from "../ui/kit";

export function connectionsView(s: ViewState): string {
  if (!s.connections.length) {
    return emptyState("还没有保存的连接", "新建连接填写主机、端口与认证信息，密码会存进系统凭据存储。", { label: "新建连接", action: "new-connection" });
  }
  const active = currentConnection();
  // Connection management uses the same grammar as the key list: one ruled row
  // per instance, facts in fixed columns, actions on demand.
  const rows = s.connections
    .map((c) => {
      const selected = active?.id === c.id;
      const state = c.status === "on" ? "已连接" : c.status === "warn" ? "不稳定" : "未连接";
      return `<div class="conn-row ${selected ? "selected" : ""}" data-conn="${esc(c.id)}" role="row">
        <span class="conn-state ${c.status === "on" ? "on" : c.status === "warn" ? "warn" : "off"}"><span class="status-dot ${c.status}"></span>${state}</span>
        <span class="cr-name">${c.color && /^#[0-9a-f]{3,8}$/i.test(c.color) ? `<span class="conn-color pinned" style="background:${esc(c.color)}" aria-hidden="true"></span>` : ""}${esc(c.name || connAddress(c))}${c.readOnly ? `<span class="faint" title="只读连接">${icon("lock", 10)}</span>` : ""}</span>
        <span class="cr-addr mono">${esc(connAddress(c))}<span class="faint">/db${active?.id === c.id ? currentDb(c) : c.db}</span></span>
        <span class="cr-cell mono">${esc(c.group || "未分组")}</span>
        <span class="cr-cell mono">${esc(c.version || "—")}</span>
        <span class="cr-cell mono">${c.latencyMs ? ms(c.latencyMs) : "—"}</span>
        <span class="cr-cell mono">${esc(modeLabel(c.mode))}</span>
        <span class="cr-badges">${c.tls ? `<span class="badge ok">TLS</span>` : ""}${c.username ? `<span class="badge">ACL</span>` : ""}</span>
        <span class="cr-actions">
          <button class="btn sm ghost" data-connect="${esc(c.id)}" ${selected ? "disabled" : ""}>${icon("plug", 11)} ${selected ? "当前" : "切换"}</button>
          <button class="icon-btn" data-action="test-id" data-id="${esc(c.id)}" title="测试连接" aria-label="测试连接">${icon("zap", 13)}</button>
          <button class="icon-btn" data-action="edit-connection" data-id="${esc(c.id)}" title="编辑" aria-label="编辑">${icon("edit", 13)}</button>
          <button class="icon-btn danger" data-action="delete-connection" data-id="${esc(c.id)}" title="删除连接" aria-label="删除连接">${icon("trash", 13)}</button>
        </span>
        ${c.error ? `<span class="cr-error mono">${esc(c.error)}</span>` : ""}
      </div>`;
    })
    .join("");

  return `<div class="connections">
    <div class="conn-table" role="table" aria-label="连接列表">
      <div class="conn-row conn-row-head" role="row">
        <span>状态<em>state</em></span><span>名称<em>name</em></span><span>地址<em>addr</em></span>
        <span>分组<em>group</em></span><span>版本<em>ver</em></span><span>延迟<em>lat</em></span>
        <span>模式<em>mode</em></span><span></span><span></span>
      </div>
      ${rows}
    </div>
    <div class="pane-grid">
      ${pane({
        title: "凭据与存储",
        body: kvList([
          { k: "配置文件", v: "~/Library/Application Support/Redis Manager/connections.json" },
          { k: "密码", v: "MyGo 系统凭据存储（不可用时回退到受限文件）" },
          { k: "传输", v: "go-redis v9 · Standalone / Sentinel / Cluster" },
        ]),
      })}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Editor dialog                                                       */
/* ------------------------------------------------------------------ */

export interface EditorDraft extends Connection {
  password?: string;
}

/**
 * Identity colours are a small fixed set, not a free colour wheel: each one has
 * to stay legible as a 7px square on both schemes and never collide with the
 * semantic red/amber/green that mean "offline / unstable / connected".
 */
export const CONNECTION_COLORS: { value: string; label: string }[] = [
  { value: "", label: "默认" },
  { value: "#5a7d99", label: "钢蓝" },
  { value: "#7c6fa8", label: "紫灰" },
  { value: "#8a7f6a", label: "灰褐" },
  { value: "#4f8a7b", label: "青灰" },
  { value: "#a06a7e", label: "藕红" },
  { value: "#6f7b5a", label: "橄榄" },
];

function colorField(draft: EditorDraft): string {
  const current = CONNECTION_COLORS.some((c) => c.value === draft.color) ? draft.color ?? "" : "";
  return `<div class="field">
    <label id="cf-color-label">标识色</label>
    <div class="color-picker" role="radiogroup" aria-labelledby="cf-color-label">
      ${CONNECTION_COLORS.map(
        (c) => `<button type="button" class="color-swatch ${current === c.value ? "active" : ""}" data-color-pick="${esc(c.value)}"
          role="radio" aria-checked="${current === c.value}" aria-label="${esc(c.label)}" title="${esc(c.label)}"
          ${c.value ? `style="--swatch:${c.value}"` : ""}>${current === c.value ? icon("check", 10) : ""}</button>`,
      ).join("")}
    </div>
    <span class="hint">只用于左侧实例列表的标识，不影响状态点</span>
  </div>`;
}

export function editorDraft(s: ViewState): EditorDraft {
  const editor = s.connectionEditor;
  const existing = editor?.mode === "edit" ? s.connections.find((c) => c.id === editor.id) : null;
  const base: EditorDraft = existing
    ? { ...existing, password: "" }
    : {
        id: `conn-${Date.now().toString(36)}`,
        name: "",
        group: "Local",
        host: "127.0.0.1",
        port: 6379,
        db: 0,
        mode: "standalone",
        tls: false,
        readOnly: false,
        username: "",
        seedNodes: "",
        sentinelMaster: "",
        password: "",
      };
  return base;
}

export function connectionDialog(s: ViewState, draft: EditorDraft, testResult: { kind: "ok" | "err" | "info"; text: string } | null): string {
  if (!s.connectionEditor) return "";
  const editing = s.connectionEditor.mode === "edit";
  const field = (name: keyof EditorDraft, label: string, opts: { type?: string; placeholder?: string; full?: boolean; hint?: string } = {}) =>
    `<div class="field ${opts.full ? "full" : ""}">
      <label for="cf-${String(name)}">${esc(label)}</label>
      <input class="input ${opts.type === "number" ? "mono" : ""}" id="cf-${String(name)}" name="${String(name)}" data-field="${String(name)}" type="${opts.type ?? "text"}" value="${esc(draft[name] ?? "")}" placeholder="${esc(opts.placeholder ?? "")}" autocomplete="off" ${opts.type === "number" ? 'min="1"' : ""} />
      ${opts.hint ? `<span class="hint">${esc(opts.hint)}</span>` : ""}
    </div>`;

  return `<div class="dialog-scrim" data-action="editor-close">
    <div class="dialog wide" role="dialog" aria-modal="true" aria-label="${editing ? "编辑连接" : "新建连接"}" data-stop>
      <div class="dialog-head">
        <span class="dialog-title">${editing ? "编辑连接" : "新建连接"}</span>
        <div class="row"><button class="icon-btn" data-action="editor-close" aria-label="关闭">${icon("x", 14)}</button></div>
      </div>
      <form class="dialog-body" id="connection-form" data-stop>
        <div class="form-section">基本信息</div>
        <div class="field-grid">
          ${field("name", "连接名称", { placeholder: "Prod · Order Svc" })}
          ${field("group", "分组", { placeholder: "Production / Staging / Local" })}
          ${field("host", "主机")}
          ${field("port", "端口", { type: "number" })}
          ${field("db", "默认 db", { type: "number" })}
          <div class="field">
            <label for="cf-mode">部署模式</label>
            <select class="select" id="cf-mode" data-field="mode">
              ${["standalone", "sentinel", "cluster"].map((m) => `<option value="${m}" ${draft.mode === m ? "selected" : ""}>${modeLabel(m)}</option>`).join("")}
            </select>
          </div>
          ${colorField(draft)}
          <div id="connection-mode-fields" style="display:contents">
            ${draft.mode === "cluster" ? field("seedNodes", "种子节点", { full: true, placeholder: "10.0.0.1:6379, 10.0.0.2:6379" }) : ""}
            ${draft.mode === "sentinel" ? field("sentinelMaster", "Sentinel 主库名", { full: true, placeholder: "mymaster" }) : ""}
          </div>
        </div>
        <div class="form-section">认证</div>
        <div class="field-grid">
          ${field("username", "ACL 用户名", { placeholder: "留空表示 default 用户" })}
          ${field("password", "密码", { type: "password", placeholder: editing ? "留空表示不修改" : "可选" })}
        </div>
        <div class="form-section">加密与偏好</div>
        <div class="field-grid">
          <label class="field toggle-field">
            <span class="switch ${draft.tls ? "on" : ""}" data-form-toggle="tls" role="switch" aria-checked="${draft.tls}" tabindex="0"></span>
            <span><b>启用 TLS</b><span class="hint">使用系统根证书校验服务端</span></span>
          </label>
          <label class="field toggle-field">
            <span class="switch ${draft.readOnly ? "on" : ""}" data-form-toggle="readOnly" role="switch" aria-checked="${draft.readOnly}" tabindex="0"></span>
            <span><b>只读连接</b><span class="hint">拦截 CLI 写命令</span></span>
          </label>
        </div>
        <div id="connection-test-result">${testResult ? `<div class="test-result ${testResult.kind}">${esc(testResult.text)}</div>` : ""}</div>
      </form>
      <div class="dialog-foot">
        <button class="btn" data-action="test-connection" type="button">${icon("zap", 12)} 测试连接</button>
        <span style="flex:1"></span>
        <button class="btn ghost" data-action="editor-close" type="button">取消</button>
        <button class="btn primary" data-action="save-connection" type="button">${icon("check", 12)} ${editing ? "保存修改" : "保存连接"}</button>
      </div>
    </div>
  </div>`;
}
