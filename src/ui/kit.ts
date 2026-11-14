import { icon } from "../core/icons";
import { esc } from "../core/format";

/** Small stateless building blocks shared by every view. */

export function iconBtn(name: string, action: string, title: string, cls = "", extra = ""): string {
  return `<button class="icon-btn ${cls}" data-action="${action}" title="${esc(title)}" aria-label="${esc(title)}" ${extra}>${icon(name, 14)}</button>`;
}

export function btn(label: string, action: string, opts: { kind?: "primary" | "ghost" | "danger" | ""; iconName?: string; sm?: boolean; extra?: string; title?: string } = {}): string {
  const kinds = [opts.kind || "", opts.sm ? "sm" : ""].filter(Boolean).join(" ");
  return `<button class="btn ${kinds}" data-action="${action}" ${opts.title ? `title="${esc(opts.title)}"` : ""} ${opts.extra ?? ""}>${opts.iconName ? icon(opts.iconName, opts.sm ? 11 : 13) : ""}${esc(label)}</button>`;
}

/**
 * A horizontal readout: label, figure, unit, delta and an optional detail line
 * or segment. Metrics are never cards here — they are ruled readouts that can
 * sit in a strip above a data surface.
 */
export function readout(opts: {
  label: string;
  en?: string;
  value: string;
  unit?: string;
  delta?: { text: string; tone?: "up" | "down" | "alert" | "critical" | "" };
  sub?: string;
  extra?: string;
  active?: boolean;
}): string {
  return `<div class="read${opts.active ? " active" : ""}">
    <div class="read-label">${esc(opts.label)}${opts.en ? `<em>${esc(opts.en)}</em>` : ""}</div>
    <div class="read-line">
      <span class="read-value">${esc(opts.value)}</span>
      ${opts.unit ? `<span class="read-unit">${esc(opts.unit)}</span>` : ""}
      ${opts.delta ? `<span class="read-delta ${opts.delta.tone ?? ""}">${esc(opts.delta.text)}</span>` : ""}
    </div>
    ${opts.sub ? `<div class="read-sub" title="${esc(opts.sub)}">${esc(opts.sub)}</div>` : ""}
    ${opts.extra ?? ""}
  </div>`;
}

export function segmented(items: { id: string; label: string; iconName?: string }[], active: string, action: string, cls = "", valueKey = "data-seg-value"): string {
  return `<div class="segmented ${cls}" role="group">${items
    .map((item) => `<button class="${item.id === active ? "active" : ""}" data-seg-action="${action}" ${valueKey}="${esc(item.id)}" aria-pressed="${item.id === active}">${item.iconName ? icon(item.iconName, 11) : ""}${esc(item.label)}</button>`)
    .join("")}</div>`;
}

export function switchControl(on: boolean, action: string, label: string, extra = ""): string {
  return `<button class="switch ${on ? "on" : ""}" data-action="${action}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" title="${esc(label)}" ${extra}></button>`;
}

export function bar(percent: number, tone: "" | "ok" | "warn" | "err" = ""): string {
  const p = Math.max(0, Math.min(100, percent));
  return `<div class="bar ${tone}" role="progressbar" aria-valuenow="${p.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p}%"></i></div>`;
}

export function barList(rows: { name: string; value: number; display: string; color?: string }[], accentName = false): string {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="bar-list">${rows
    .map(
      (r, i) => `<div class="bar-row">
        <span class="bar-name" title="${esc(r.name)}">${accentName && i === 0 ? `<b>${esc(r.name)}</b>` : esc(r.name)}</span>
        <div class="bar-track"><i style="width:${Math.max(1.5, (r.value / max) * 100).toFixed(1)}%${r.color ? `;background:${r.color}` : ""}"></i></div>
        <span class="bar-val">${esc(r.display)}</span>
      </div>`,
    )
    .join("")}</div>`;
}

export function emptyState(title: string, description: string, action?: { label: string; action: string }): string {
  return `<div class="empty-state">
    <div class="empty-icon">${icon("database", 20)}</div>
    <h2>${esc(title)}</h2>
    <p>${esc(description)}</p>
    ${action ? btn(action.label, action.action, { kind: "primary", iconName: "plus" }) : ""}
  </div>`;
}

export function kvList(rows: { k: string; v: string; copy?: boolean; tone?: "ok" | "warn" | "err" | ""; version?: boolean }[]): string {
  return `<div class="kv-list">${rows
    .map(
      (row) => `<div class="kv-row"><span class="kv-k">${esc(row.k)}</span><span class="kv-v ${row.tone ?? ""}"${row.version ? " data-app-version" : ""}>${esc(row.v)}${row.copy ? `<button class="icon-btn" data-action="copy" data-copy="${esc(row.v)}" title="复制" aria-label="复制">${icon("copy", 12)}</button>` : ""}</span></div>`,
    )
    .join("")}</div>`;
}

export function notice(kind: "ok" | "warn" | "err" | "info", title: string, detail = "", actions = ""): string {
  const iconName = kind === "ok" ? "checkCircle" : kind === "err" ? "xCircle" : kind === "warn" ? "alert" : "info";
  return `<div class="notice ${kind}">${icon(iconName, 14)}<div class="notice-body"><b>${esc(title)}</b>${detail ? `<span>${esc(detail)}</span>` : ""}</div>${actions}</div>`;
}

export function pill(type: string, label?: string): string {
  const key = String(type || "none").toLowerCase();
  return `<span class="pill t-${esc(key)}">${esc(label ?? key)}</span>`;
}

/** A ruled section header: title, mono english key, meta, tools. */
export function sectionHead(title: string, opts: { meta?: string; tools?: string; en?: string; cls?: string } = {}): string {
  return `<header class="section-head ${opts.cls ?? ""}">
    <h2>${esc(title)}</h2>${opts.en ? `<span class="mlabel">${esc(opts.en)}</span>` : ""}
    ${opts.meta ? `<span class="section-meta">${opts.meta}</span>` : ""}
    <span class="spacer"></span>
    ${opts.tools ?? ""}
  </header>`;
}

/**
 * A data pane: ruled header + body. This is the only container the product
 * uses for grouped content, so nothing floats as a card.
 */
export function pane(opts: { title: string; en?: string; meta?: string; tools?: string; body: string; cls?: string; bodyCls?: string }): string {
  return `<section class="pane ${opts.cls ?? ""}">
    ${sectionHead(opts.title, { en: opts.en, meta: opts.meta, tools: opts.tools })}
    <div class="pane-body ${opts.bodyCls ?? ""}">${opts.body}</div>
  </section>`;
}

/** Joins conditional class names. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
