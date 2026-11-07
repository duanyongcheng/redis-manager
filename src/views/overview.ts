import { bytes, bytesParts, connAddress, esc, num, pct } from "../core/format";
import { lineChart, sparkline } from "../core/charts";
import { currentConnection, currentHistory, currentOverview, type ViewState } from "../core/store";
import { deriveInsights } from "../ui/insights";
import { barList, card, emptyState, iconBtn } from "../ui/kit";

export function overviewView(s: ViewState): string {
  const conn = currentConnection();
  if (!conn) {
    return emptyState("还没有连接", "保存一个 Redis 连接后，这里会显示 QPS、内存、延迟和告警建议。", { label: "新建连接", action: "new-connection" });
  }
  const ov = currentOverview();
  if (!ov) {
    return `<div class="overview-stack">
      <div class="notice info">${conn.status === "off" ? `${conn.name} 连接失败，正在等待重试` : `正在连接 ${esc(connAddress(conn))}…`}</div>
      <div class="kpi-row">${[0, 1, 2, 3].map(() => `<div class="card kpi"><div class="skeleton" style="width:40%;height:10px"></div><div class="skeleton" style="width:60%;height:26px;margin-top:8px"></div></div>`).join("")}</div>
    </div>`;
  }

  const hist = currentHistory();
  const offline = conn.status === "off";
  const hits = Number(ov.info["keyspace_hits"] ?? 0);
  const misses = Number(ov.info["keyspace_misses"] ?? 0);
  const hitRate = hits + misses > 0 ? (hits / (hits + misses)) * 100 : null;
  const insights = deriveInsights(ov);

  return `
    ${offline ? `<div class="notice err" style="margin-bottom:var(--gap)">${esc(conn.error ?? "连接已断开")} · 显示的是最后一次采样快照</div>` : ""}
    <div class="kpi-row">
      ${kpi(0, "QPS 吞吐", num(Math.round(ov.opsPerSec)), "ops/s", hist.map((x) => x.ops), `峰值 ${num(Math.max(0, ...hist.map((x) => x.ops)))}`)}
      ${kpi(1, "连接客户端", num(ov.connectedClients), "个", hist.map((x) => x.clients), `阻塞 ${num(Number(ov.info["blocked_clients"] ?? 0))}`)}
      ${kpi(2, "内存占用", bytesParts(ov.usedMemoryBytes).value, bytesParts(ov.usedMemoryBytes).unit, hist.map((x) => x.used), ov.maxMemoryBytes ? `上限 ${bytes(ov.maxMemoryBytes)} · ${pct(ov.usedMemoryBytes, ov.maxMemoryBytes).toFixed(0)}%` : `未设置上限`, ov.maxMemoryBytes ? pct(ov.usedMemoryBytes, ov.maxMemoryBytes) : undefined)}
      ${kpi(3, "平均延迟", ov.latencyMs.toFixed(2), "ms", hist.map((x) => x.latency), hitRate != null ? `命中率 ${hitRate.toFixed(1)}%` : "PING 往返")}
    </div>
    <div class="overview-grid">
      <div class="overview-stack">
        ${throughputCard(s, hist, hitRate, hist.map((x) => x.clients))}
        ${keyspaceCard(s, ov)}
      </div>
      <div class="overview-stack">
        ${insightsCard(s)}
        ${commandsCard(s, ov)}
      </div>
    </div>`;
}

const windowSizes = new Map<ViewState, number>();
export function setWindowSize(s: ViewState, size: number) {
  windowSizes.set(s, size);
}
function windowSizeOf(s: ViewState): number {
  return windowSizes.get(s) ?? 60;
}

function kpi(index: number, label: string, value: string, unit: string, series: number[], foot: string, progress?: number): string {
  const sorted = series.length > 1;
  return `<section class="card kpi kpi-${index}">
    <div class="kpi-label"><span class="acc" style="font-family:var(--font-mono)">${["~", "~", "~", "~"][index]}</span>${esc(label)}</div>
    <div class="kpi-value num">${esc(value)}<span class="kpi-unit">${esc(unit)}</span></div>
    <div class="kpi-foot">${esc(foot)}</div>
    ${progress != null ? `<div class="bar ${progress > 85 ? "err" : progress > 65 ? "warn" : "ok"}" style="margin-top:2px"><i style="width:${progress}%"></i></div>` : ""}
    ${sorted ? sparkline(series, { color: `var(--series-${index})` }) : sparkline([], {})}
  </section>`;
}

function throughputCard(s: ViewState, hist: { at: number; ops: number; latency: number }[], hitRate: number | null, clients: number[] = []): string {
  const windowSize = windowSizeOf(s);
  const slice = hist.slice(-Math.min(windowSize, hist.length));
  const labels = slice.map((x, i) => {
    const secs = slice.length - i - 1;
    return secs === 0 ? "现在" : `-${secs * 4}s`;
  });
  const windowSeg = [60, 180, 480, 900]
    .map((w) => `<button class="${w === windowSize ? "active pro-window" : "pro-window"}" data-window="${w}">${w <= 60 ? "60s" : w <= 180 ? "3m" : w <= 480 ? "8m" : "15m"}</button>`)
    .join("");
  return card({
    title: "吞吐与延迟",
    iconName: "activity",
    meta: `<span class="faint">最近 ${slice.length * 4}s · ${slice.length} 点</span>`,
    tools: `<div class="segmented">${windowSeg}</div>`,
    bodyCls: "",
    body: lineChart({
      series: [
        { name: "ops/s", values: slice.map((x) => x.ops), fill: true },
        { name: "clients", values: clients.slice(-slice.length), cls: "muted", axis: "right" },
      ],
      height: 232,
      xLabels: labels,
      legendExtra: hitRate != null ? `命中率 ${hitRate.toFixed(2)}%` : undefined,
    }),
  });
}

function insightsCard(s: ViewState): string {
  const ov = currentOverview();
  const list = deriveInsights(ov);
  return card({
    title: "告警与建议",
    iconName: "shield",
    meta: `<span class="badge">${list.length}</span>`,
    body: `<div style="display:flex;flex-direction:column;gap:8px">${list
      .map(
        (i) => `<div class="notice ${i.tone}">${iconOr(i.tone)}
          <div class="notice-body"><b>${esc(i.title)}</b><span class="dim" style="font-size:11.5px">${esc(i.detail)}</span></div>
          ${i.action ? `<button class="btn ghost sm" data-nav="${i.action.view}">${esc(i.action.label)}</button>` : ""}
        </div>`,
      )
      .join("")}</div>`,
    tools: iconBtn("refresh", "refresh", "重新采样"),
  });
}

function iconOr(tone: "ok" | "warn" | "err" | "info"): string {
  const name = tone === "ok" ? "checkCircle" : tone === "err" ? "xCircle" : tone === "warn" ? "alert" : "info";
  return `<svg class="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${
    { checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>', xCircle: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>', alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>' }[name]
  }</svg>`;
}

function keyspaceCard(s: ViewState, ov: NonNullable<ReturnType<typeof currentOverview>>): string {
  const spaces = ov.keyspaces ?? [];
  const rows = spaces.map((ks) => {
    const ratio = ov.totalKeys > 0 ? (ks.keys / ov.totalKeys) * 100 : 0;
    const ttlPct = ks.keys > 0 ? (ks.expires / ks.keys) * 100 : 0;
    return `<div class="kv-row" style="align-items:center">
      <span style="width:44px" class="mono dim">db${ks.db}</span>
      <div class="grow" style="display:flex;flex-direction:column;gap:4px;max-width:360px">
        <div class="bar"><i style="width:${Math.max(2, ratio).toFixed(1)}%"></i></div>
      </div>
      <span class="mono num" style="width:90px;text-align:right">${num(ks.keys)}</span>
      <span class="mono num faint" style="width:60px;text-align:right">${(ratio).toFixed(1)}%</span>
      <span class="mono num faint" style="width:64px;text-align:right" title="带 TTL 的键占比">${ttlPct.toFixed(0)}% ttl</span>
    </div>`;
  });
  return card({
    title: "键空间分布",
    iconName: "layers",
    meta: `${num(ov.totalKeys)} keys`,
    body: rows.length ? rows.join("") : `<div class="dim" style="font-size:12px">当前实例没有键</div>`,
    tools: `<button class="btn ghost sm" data-nav="browser">浏览键</button>`,
  });
}

function commandsCard(s: ViewState, ov: NonNullable<ReturnType<typeof currentOverview>>): string {
  const top = [...(ov.commands ?? [])].sort((a, b) => b.calls - a.calls).slice(0, 7);
  const total = top.reduce((sum, c) => sum + c.calls, 0);
  const rows = top.map((c) => ({ name: c.name.toUpperCase(), value: c.calls, display: num(c.calls) }));
  return card({
    title: "热门命令",
    iconName: "terminal",
    meta: `${num(total)} calls`,
    body: rows.length ? barList(rows) : `<div class="dim" style="font-size:12px">暂无 commandstats</div>`,
    tools: `<button class="btn ghost sm" data-nav="cli">CLI</button>`,
  });
}

