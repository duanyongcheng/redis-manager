import { icon } from "../core/icons";
import { connAddress, esc, modeLabel, ms } from "../core/format";
import { type Connection } from "../core/api";
import { currentConnection, currentDb, type ViewState } from "../core/store";
import { btn, card, emptyState } from "../ui/kit";

export function connectionsView(s: ViewState): string {
  if (!s.connections.length) {
    return emptyState("还没有保存的连接", "新建连接填写主机、端口与认证信息，密码会存进系统凭据存储。", { label: "新建连接", action: "new-connection" });
  }
  const active = currentConnection();
  const cards = s.connections
    .map((c) => {
      const selected = active?.id === c.id;
      return `<div class="conn-card ${selected ? "selected" : ""}">
        <div class="conn-card-head">
          <span class="status-dot ${c.status}"></span>
          <b>${esc(c.name || connAddress(c))}</b>
          ${c.readOnly ? `<span class="badge">${icon("lock", 10)} 只读</span>` : ""}
          <span class="spacer"></span>
          <span class="badge">${esc(modeLabel(c.mode))}</span>
        </div>
        <div class="conn-card-addr mono">${esc(connAddress(c))}<span class="faint">/db${active?.id === c.id ? currentDb(c) : c.db}</span></div>
        <div class="conn-card-meta">
          <span><span class="label">分组</span> ${esc(c.group || "未分组")}</span>
          <span><span class="label">版本</span> <b class="mono">${esc(c.version || "—")}</b></span>
          <span><span class="label">延迟</span> <b class="mono">${c.latencyMs ? ms(c.latencyMs) : "—"}</b></span>
          ${c.tls ? `<span class="badge ok">TLS</span>` : ""}
          ${c.username ? `<span class="badge">ACL ${esc(c.username)}</span>` : ""}
        </div>
        ${c.error ? `<div class="notice err" style="margin-top:10px;font-size:11.5px">${esc(c.error)}</div>` : ""}
        <div class="conn-card-actions">
          <button class="btn sm" data-connect="${esc(c.id)}">${icon("plug", 12)} ${selected ? "当前连接" : "切换"}</button>
          <button class="btn sm ghost" data-action="test-id" data-id="${esc(c.id)}">${icon("zap", 12)} 测试</button>
          <button class="btn sm ghost" data-action="edit-connection" data-id="${esc(c.id)}">${icon("edit", 12)} 编辑</button>
          <span class="spacer" style="flex:1"></span>
          <button class="btn sm ghost danger" data-action="delete-connection" data-id="${esc(c.id)}" title="删除连接" aria-label="删除连接">${icon("trash", 12)}</button>
        </div>
      </div>`;
    })
    .join("");

  return `<div class="connections">
    <div class="page-head">
      <h1>连接</h1>
      <span class="sub">${s.connections.length} 个已保存</span>
      <span class="spacer" style="flex:1"></span>
      ${btn("刷新", "refresh", { iconName: "refresh" })}
      ${btn("新建连接", "new-connection", { kind: "primary", iconName: "plus" })}
    </div>
    <div class="conn-grid">${cards}</div>
    ${card({
      title: "凭据与存储",
      iconName: "shield",
      body: `<div class="kv-list">
        <div class="kv-row"><span class="kv-k">配置文件</span><span class="kv-v">~/Library/Application Support/Redis Manager/connections.json</span></div>
        <div class="kv-row"><span class="kv-k">密码</span><span class="kv-v">MyGo 系统凭据存储（不可用时回退到受限文件）</span></div>
        <div class="kv-row"><span class="kv-k">传输</span><span class="kv-v">go-redis v9 · Standalone / Sentinel / Cluster</span></div>
      </div>`,
    })}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Editor dialog                                                       */
/* ------------------------------------------------------------------ */

export interface EditorDraft extends Connection {
  password?: string;
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

export function connectionDialog(s: ViewState, draft: EditorDraft, testResult: { kind: "ok" | "err"; text: string } | null): string {
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
        <div class="row"><button class="btn ghost icon" data-action="editor-close" aria-label="关闭">${icon("x", 15)}</button></div>
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
          ${draft.mode === "cluster" ? field("seedNodes", "种子节点", { full: true, placeholder: "10.0.0.1:6379, 10.0.0.2:6379" }) : ""}
          ${draft.mode === "sentinel" ? field("sentinelMaster", "Sentinel 主库名", { full: true, placeholder: "mymaster" }) : ""}
        </div>
        <div class="form-section">认证</div>
        <div class="field-grid">
          ${field("username", "ACL 用户名", { placeholder: "留空表示 default 用户" })}
          ${field("password", "密码", { type: "password", placeholder: editing ? "留空表示不修改" : "可选" })}
        </div>
        <div class="form-section">加密与偏好</div>
        <div class="field-grid">
          <label class="field" style="flex-direction:row;align-items:center;gap:10px;cursor:pointer">
            <span class="switch ${draft.tls ? "on" : ""}" data-form-toggle="tls" role="switch" aria-checked="${draft.tls}"></span>
            <span><span style="font-size:12px">启用 TLS</span><span class="hint" style="display:block">使用系统根证书校验服务端</span></span>
          </label>
          <label class="field" style="flex-direction:row;align-items:center;gap:10px;cursor:pointer">
            <span class="switch ${draft.readOnly ? "on" : ""}" data-form-toggle="readOnly" role="switch" aria-checked="${draft.readOnly}"></span>
            <span><span style="font-size:12px">只读连接</span><span class="hint" style="display:block">拦截 CLI 写命令</span></span>
          </label>
        </div>
        ${testResult ? `<div class="test-result ${testResult.kind}">${esc(testResult.text)}</div>` : ""}
      </form>
      <div class="dialog-foot">
        <button class="btn" data-action="test-connection" type="button">${icon("zap", 13)} 测试连接</button>
        <span style="flex:1"></span>
        <button class="btn ghost" data-action="editor-close" type="button">取消</button>
        <button class="btn primary" data-action="save-connection" type="button">${icon("check", 13)} ${editing ? "保存修改" : "保存连接"}</button>
      </div>
    </div>
  </div>`;
}
