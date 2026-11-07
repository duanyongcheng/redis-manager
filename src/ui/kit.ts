import { icon } from "../core/icons";
import { esc } from "../core/format";

/** Small stateless building blocks shared by every view. */

export function h(html: string): string {
  return html;
}

export function iconBtn(name: string, action: string, title: string, cls = "", extra = ""): string {
  return `<button class="btn ghost icon ${cls}" data-action="${action}" title="${esc(title)}" aria-label="${esc(title)}" ${extra}>${icon(name, 15)}</button>`;
}

export function btn(label: string, action: string, opts: { kind?: "primary" | "ghost" | "danger" | ""; iconName?: string; sm?: boolean; extra?: string; title?: string } = {}): string {
  const kinds = [opts.kind || "", opts.sm ? "sm" : ""].filter(Boolean).join(" ");
  return `<button class="btn ${kinds}" data-action="${action}" ${opts.title ? `title="${esc(opts.title)}"` : ""} ${opts.extra ?? ""}>${opts.iconName ? icon(opts.iconName, opts.sm ? 12 : 14) : ""}${esc(label)}</button>`;
}

export function card(opts: { title: string; meta?: string; tools?: string; body: string; cls?: string; bodyCls?: string; iconName?: string; titleAttr?: string }): string {
  return `<section class="card ${opts.cls ?? ""}" ${opts.titleAttr ? `data-title-attr="${esc(opts.titleAttr)}"` : ""}>
    <header class="card-head">
      <span class="card-title">${opts.iconName ? icon(opts.iconName, 13) : ""}${esc(opts.title)}</span>
      ${opts.meta ? `<span class="card-meta">${opts.meta}</span>` : ""}
      <span class="spacer"></span>
      ${opts.tools ? `<div class="card-tools">${opts.tools}</div>` : ""}
    </header>
    <div class="card-body ${opts.bodyCls ?? ""}">${opts.body}</div>
  </section>`;
}

export function segmented(items: { id: string; label: string; action: string }[], active: string, action: string): string {
  return `<div class="segmented" data-seg="${action}">${items
    .map((item) => `<button class="${item.id === active ? "active" : ""}" data-seg-action="${action}" data-seg-value="${esc(item.id)}">${esc(item.label)}</button>`)
    .join("")}</div>`;
}

export function switchControl(on: boolean, action: string, label: string, extra = ""): string {
  return `<button class="switch ${on ? "on" : ""}" data-action="${action}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" title="${esc(label)}" ${extra}></button>`;
}

export function checkbox(on: boolean, action: string, label: string): string {
  return `<button class="checkbox ${on ? "on" : ""}" data-action="${action}" role="checkbox" aria-checked="${on}" aria-label="${esc(label)}">${icon("check", 10)}</button>`;
}

export function bar(percent: number, tone: "" | "ok" | "warn" | "err" = "", label?: string): string {
  const p = Math.max(0, Math.min(100, percent));
  if (label != null) {
    // ASCII themes render the label as the bar itself (see --slot-bar).
    return `<div class="bar ${tone}" style="--ascii:'${esc(label)}'" role="progressbar" aria-valuenow="${p.toFixed(0)}"><i style="width:${p}%"></i></div>`;
  }
  return `<div class="bar ${tone}" role="progressbar" aria-valuenow="${p.toFixed(0)}"><i style="width:${p}%"></i></div>`;
}

export function barList(rows: { name: string; value: number; display: string; color?: string; ascii?: string }[]): string {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="bar-list">${rows
    .map(
      (r, i) => `<div class="bar-row">
        <span class="bar-name" title="${esc(r.name)}">${esc(r.name)}</span>
        <div class="bar-track"><i style="width:${Math.max(2, (r.value / max) * 100).toFixed(1)}%;background:${r.color ?? `var(--series-${i % 6})`}"></i></div>
        <span class="bar-val">${esc(r.display)}</span>
      </div>`,
    )
    .join("")}</div>`;
}

export function emptyState(title: string, description: string, action?: { label: string; action: string }): string {
  return `<div class="empty-state">
    <div class="empty-icon">${icon("database", 22)}</div>
    <h2>${esc(title)}</h2>
    <p>${esc(description)}</p>
    ${action ? btn(action.label, action.action, { kind: "primary", iconName: "plus" }) : ""}
  </div>`;
}

export function kvList(rows: { k: string; v: string; copy?: boolean }[]): string {
  return rows
    .map(
      (row) => `<div class="kv-row"><span class="kv-k">${esc(row.k)}</span><span class="kv-v">${esc(row.v)}${row.copy ? `<button class="btn ghost icon sm" data-action="copy" data-copy="${esc(row.v)}" title="复制">${icon("copy", 11)}</button>` : ""}</span></div>`,
    )
    .join("");
}

export function notice(kind: "ok" | "warn" | "err" | "info", title: string, detail = "", actions = ""): string {
  const iconName = kind === "ok" ? "checkCircle" : kind === "err" ? "xCircle" : kind === "warn" ? "alert" : "info";
  return `<div class="notice ${kind}">${icon(iconName, 15)}<div class="notice-body"><b>${esc(title)}</b>${detail ? esc(detail) : ""}</div>${actions}</div>`;
}

export function pill(type: string, label?: string): string {
  const key = String(type || "none").toLowerCase();
  return `<span class="pill t-${esc(key)}">${esc(label ?? key)}</span>`;
}

/** Joins conditional class names. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
