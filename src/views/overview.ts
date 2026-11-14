import { bytes, bytesParts, connAddress, count, duration, esc, num, pct } from "../core/format";
import { lineChart } from "../core/charts";
import { currentConnection, currentHistory, currentMonitor, currentOverview, windowedHistory, type ConnectionView, type MetricSample, type ViewState } from "../core/store";
import { deriveInsights, type Insight } from "../ui/insights";
import { emptyState, iconBtn, readout, segmented } from "../ui/kit";

/**
 * Overview = the metric stream.
 *
 * The three panes are the product's signature: a list of live samples (one
 * row per 4s poll), the selected sample expanded as a field tree, and the
 * history of the sample's series underneath. Advisories sit beside the stream
 * so a finding and the sample that proves it are one glance apart.
 */
export function overviewView(s: ViewState): string {
  viewStateRef = s;
  const conn = currentConnection();
  if (!conn) {
    return emptyState("还没有连接", "保存一个 Redis 连接后，这里会按采样流显示吞吐、内存、延迟和告警。", { label: "新建连接", action: "new-connection" });
  }
  const ov = currentOverview();
  if (!ov) {
    return `<div class="state-pad">
      <div class="notice info">${conn.status === "off" ? `${esc(conn.name)} 连接失败，正在等待重试` : `正在连接 ${esc(connAddress(conn))}…`}</div>
      <div class="skeleton" style="width:100%;height:64px;margin-top:16px"></div>
      <div class="skeleton" style="width:100%;height:320px;margin-top:16px"></div>
    </div>`;
  }

  const hist = currentHistory();
  const offline = conn.status === "off";
  const insights = deriveInsights(ov);

  return `${offline ? `<div style="padding:12px var(--pad-x) 0"><div class="notice err">${esc(conn.error ?? "连接已断开")} · 以下是最后一次采样的快照</div></div>` : ""}
    <div class="overview-root">
    ${readouts(conn, hist)}${analyser(conn, insights)}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Readings strip                                                      */
/* ------------------------------------------------------------------ */

function readouts(conn: ConnectionView, hist: MetricSample[]): string {
  const ov = currentOverview()!;
  const last = hist[hist.length - 1];
  const before = hist[hist.length - 2];
  const delta = (pick: (s: MetricSample) => number, format: (v: number) => string, invert = false): { text: string; tone: "up" | "down" | "alert" | "critical" | "" } => {
    if (!last || !before) return { text: "", tone: "" };
    const diff = pick(last) - pick(before);
    if (Math.abs(diff) < 1e-9) return { text: "±0", tone: "" };
    const sign = diff > 0 ? "+" : "−";
    const tone = invert ? (diff > 0 ? "alert" : "") : diff > 0 ? "up" : "down";
    return { text: `${sign}${format(Math.abs(diff))}`, tone };
  };
  const memPct = ov.maxMemoryBytes ? pct(ov.usedMemoryBytes, ov.maxMemoryBytes) : null;
  const mem = bytesParts(ov.usedMemoryBytes);
  const evicted = Number(ov.info["evicted_keys"] ?? 0);
  return `<section class="reads" aria-label="关键读数">
    ${readout({
      label: "QPS",
      en: "ops/s",
      value: num(Math.round(ov.opsPerSec)),
      unit: "ops/s",
      delta: delta((x) => x.ops, (v) => num(Math.round(v))),
      sub: `峰值 ${num(Math.max(0, ...hist.map((x) => x.ops)))} · ${hist.length} 个样本`,
    })}
    ${readout({
      label: "客户端",
      en: "clients",
      value: num(ov.connectedClients),
      unit: "conns",
      delta: delta((x) => x.clients, (v) => num(Math.round(v))),
      sub: `阻塞 ${num(Number(ov.info["blocked_clients"] ?? 0))} · 累计 ${num(Number(ov.info["total_connections_received"] ?? 0))}`,
    })}
    ${readout({
      label: "内存",
      en: "used",
      value: mem.value,
      unit: `${mem.unit}${ov.maxMemoryBytes ? ` / ${bytes(ov.maxMemoryBytes)}` : " · 无上限"}`,
      delta: memPct != null ? { text: `${memPct.toFixed(0)}%`, tone: memPct >= 85 ? "critical" : memPct >= 65 ? "alert" : "" } : undefined,
      sub: `碎片率 ${esc(ov.info["mem_fragmentation_ratio"] ?? "—")} · 策略 ${esc(ov.info["maxmemory_policy"] ?? "—")}`,
    })}
    ${readout({
      label: "平均延迟",
      en: "latency",
      value: ov.latencyMs.toFixed(2),
      unit: "ms",
      delta: delta((x) => x.latency, (v) => `${v.toFixed(2)} ms`),
      sub: `已驱逐 ${num(evicted)} · 命中率 ${hitRate(ov).toFixed(1)}%`,
    })}
  </section>`;
}

function hitRate(ov: NonNullable<ReturnType<typeof currentOverview>>): number {
  const hits = Number(ov.info["keyspace_hits"] ?? 0);
  const misses = Number(ov.info["keyspace_misses"] ?? 0);
  return hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0;
}

const windows = [
  { id: "20", label: "20 样本" },
  { id: "45", label: "45 样本" },
  { id: "90", label: "90 样本" },
];

const windowSizes = new Map<ViewState, string>();
export function setWindowSize(s: ViewState, size: number | string) {
  windowSizes.set(s, String(size));
}
function windowSizeOf(s: ViewState): number {
  return Number(windowSizes.get(s) ?? 45);
}

/* ------------------------------------------------------------------ */
/* Analyser: stream · detail · history                                 */
/* ------------------------------------------------------------------ */

function analyser(conn: ConnectionView, insights: Insight[]): string {
  const win = windowSizeOf(viewStateRef!);
  // The stream's time span is the window's own width, ending at the newest
  // real sample: a 45-sample window always reads as the last three minutes,
  // whether or not the session has been open that long.
  const hist = currentHistory();
  const stream = displayStream(hist, win);
  const samples = stream.indexes.slice().reverse();
  const selected = selectedIndexIn(stream.samples, hist);
  const anomaly = findingsBySample(stream.samples, insights);

  const rows = samples
    .map((i) => {
      const sample = stream.samples[i]!;
      const prev = stream.samples[i - 1];
      const findings = anomaly.get(sample.at) ?? [];
      const flag = findings[0];
      const deltaOps = prev ? sample.ops - prev.ops : 0;
      return `<button class="srow ${i === selected ? "selected" : ""}${sample.inferred ? " inferred" : ""}" data-sample="${i}" tabindex="${i === selected ? "0" : "-1"}" role="row" ${findings.length ? "data-flagged" : ""} ${sample.inferred ? 'title="该样本由首个真实读数向前推算，仅用于保持时间窗连续" aria-label="推算样本"' : ""}>
        <span class="srow-bar"></span>
        <span class="srow-time">${clock(sample.at)}</span>
        <span class="srow-event">${sample.inferred ? `<span class="dash">推算</span>` : flag ? `<span class="flag ${flag.tone}">${esc(flag.label)}</span>` : `<span class="dash">—</span>`}</span>
        <span class="srow-cell strong">${sample.inferred ? "—" : count(sample.ops)}</span>
        <span class="srow-cell">${sample.inferred ? "—" : count(sample.clients)}</span>
        <span class="srow-cell">${sample.inferred ? "—" : bytes(sample.used)}</span>
        <span class="srow-cell">${sample.inferred ? "—" : `${sample.latency.toFixed(2)} ms`}</span>
        <span class="srow-cell dim">${prev && !sample.inferred && !prev.inferred ? `${deltaOps >= 0 ? "+" : "−"}${count(Math.abs(deltaOps))}` : "—"}</span>
      </button>`;
    })
    .join("");

  return `<div class="analyser">
    <div class="analyser-main">
      <div class="pane-head">
        <h2>指标流</h2>
        <span class="spacer"></span>
        ${streamChips(insights)}
        ${segmented(windows, String(win), "window", "boxed")}
      </div>
      <div class="stream" role="grid" aria-label="采样流">
        <div class="stream-head" role="row">
          <span></span><span>时间<em>time</em></span><span>事件<em>event</em></span>
          <span class="r">操作数<em>ops</em></span><span class="r">客户端<em>conns</em></span>
          <span class="r">内存<em>used</em></span><span class="r">延迟<em>lat</em></span><span class="r">Δ<em>Δops</em></span>
        </div>
        <div class="stream-body scroll">
          ${rows || `<div class="stream-empty">等待第一次采样…</div>`}
        </div>
      </div>
      ${detailPane(conn, stream.samples, selected)}
      ${historyPane(stream.samples, selected, stream.inferred, onsetMarker(anomaly))}
    </div>
    <aside class="analyser-side" aria-label="告警与建议">
      <div class="pane-head">
        <h2>告警与建议</h2>
        <span class="spacer"></span>
        <span class="count">${insights.length}</span>
        ${iconBtn("refresh", "refresh-metrics", "重新采样")}
      </div>
      <div class="findings scroll">${findingsList(insights)}</div>
    </aside>
  </div>`;
}

/** The view state of the current render, for window and selection lookups. */
let viewStateRef: ViewState | null = null;

function selectedIndex(hist: MetricSample[]): number {
  if (!hist.length) return -1;
  const at = viewStateRef?.selectedSampleAt ?? null;
  if (at != null) {
    const found = hist.findIndex((x) => x.at === at);
    if (found >= 0) return found;
  }
  return hist.length - 1;
}

interface FindingFlag {
  label: string;
  tone: "warn" | "err";
  at: number;
}

/**
 * Ties each finding to the first sample where its condition became true, so
 * the stream can show *when* something started rather than just that it is so.
 */
function findingsBySample(hist: MetricSample[], insights: Insight[]): Map<number, FindingFlag[]> {
  const out = new Map<number, FindingFlag[]>();
  const ov = currentOverview();
  if (!ov || !hist.length) return out;
  const push = (at: number, flag: FindingFlag) => {
    const list = out.get(at) ?? [];
    list.push(flag);
    out.set(at, list);
  };
  const firstAbove = (pick: (s: MetricSample) => number, threshold: number): MetricSample | null => hist.find((x) => pick(x) >= threshold) ?? null;

  if (insights.some((i) => i.watch === "evicted")) {
    const evicted = Number(ov.info["evicted_keys"] ?? 0);
    // Eviction is a server counter, not a per-sample value; attribute it to the
    // oldest sample on record so the onset is honest about what we observed.
    push(hist[0]!.at, { label: `已驱逐 ${num(evicted)}`, tone: "warn", at: hist[0]!.at });
  }
  if (insights.some((i) => i.watch === "memory") && ov.maxMemoryBytes) {
    const threshold = ov.maxMemoryBytes * 0.85;
    const hit = firstAbove((x) => x.used, threshold);
    if (hit) push(hit.at, { label: "内存 ≥85%", tone: "err", at: hit.at });
    else push(hist[hist.length - 1]!.at, { label: `内存 ${pct(ov.usedMemoryBytes, ov.maxMemoryBytes).toFixed(0)}%`, tone: "warn", at: hist[hist.length - 1]!.at });
  }
  const slow = insights.find((i) => i.watch === "slow");
  if (slow) {
    const hit = firstAbove((x) => x.latency, 1);
    push((hit ?? hist[hist.length - 1]!).at, { label: slow.title.split(" ")[0] ?? "慢命令", tone: "warn", at: 0 });
  }
  if (insights.some((i) => i.watch === "blocked")) {
    push(hist[hist.length - 1]!.at, { label: "客户端阻塞", tone: "warn", at: 0 });
  }
  return out;
}

/** Header summary of the stream: how many live samples, and what is flagged. */
function streamChips(insights: Insight[]): string {
  const flagged = insights.filter((i) => i.tone !== "ok").length;
  return `<span class="finding-chips">${flagged ? `<span class="flag ${insights.some((i) => i.tone === "err") ? "err" : "warn"}">${flagged} 条异常</span>` : `<span class="flag ok">无异常</span>`}</span>`;
}

/** Maps a live-history index to its position in the displayed stream. */
function selectedIndexIn(stream: MetricSample[], hist: MetricSample[]): number {
  const live = selectedIndex(hist);
  if (live < 0) return -1;
  const at = hist[live]?.at;
  if (at == null) return -1;
  return stream.findIndex((x) => x.at === at);
}

/** The stream a panel shows: the live history, padded to the chosen window. */
function displayStream(hist: MetricSample[], size: number): { samples: MetricSample[]; indexes: number[]; inferred: number } {
  const win = windowedHistory(hist, size);
  return { ...win, indexes: win.samples.map((_, i) => i) };
}

function findingsList(insights: Insight[]): string {
  if (!insights.length) return `<div class="findings-empty">没有发现。</div>`;
  return insights
    .map((i) => {
      const tone = i.tone === "ok" ? "ok" : i.tone === "err" ? "err" : i.tone === "info" ? "info" : "warn";
      const iconName = tone === "ok" ? "checkCircle" : tone === "err" ? "xCircle" : tone === "info" ? "info" : "alert";
      return `<article class="finding ${tone}">
        <div class="finding-top">
          <span class="finding-mark">${svgIcon(iconName)}</span>
          <span class="finding-title">${esc(i.title)}</span>
        </div>
        <p class="finding-detail">${esc(i.detail)}</p>
        ${i.action ? `<button class="finding-action" data-nav="${i.action.view}">${esc(i.action.label)} →</button>` : ""}
      </article>`;
    })
    .join("");
}

function svgIcon(name: string): string {
  const paths: Record<string, string> = {
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  };
  return `<svg class="icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function clock(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

/* ------------------------------------------------------------------ */
/* Detail pane — the selected sample as a field tree                    */
/* ------------------------------------------------------------------ */

function detailPane(conn: ConnectionView, hist: MetricSample[], index: number): string {
  const sample = hist[index];
  if (!sample) {
    return `<div class="detail"><div class="detail-col"><div class="detail-empty">采样流为空，选中任意一行查看字段。</div></div></div>`;
  }
  const prev = hist[index - 1];
  const ov = currentOverview()!;
  const keyspaces = (ov.keyspaces ?? []).filter((ks) => ks.keys > 0);
  const diff = (a: number, b: number, format: (v: number) => string) => {
    const d = a - b;
    if (Math.abs(d) < 1e-9) return "±0";
    return `${d > 0 ? "+" : "−"}${format(Math.abs(d))}`;
  };
  const kv = (k: string, v: string, opts: { leaf?: boolean; indent?: boolean; tone?: string } = {}) =>
    `<div class="kv-row ${opts.leaf ? "leaf" : ""} ${opts.indent ? "ind" : ""}"><span class="kv-k">${esc(k)}</span><span class="kv-v ${opts.tone ?? ""}">${v}</span></div>`;

  return `<div class="detail" aria-label="选中样本">
    <div class="detail-col">
      <div class="detail-head"><b>样本</b> ${clock(sample.at)}<span class="mlabel">sample</span></div>
      ${kv("ops", num(sample.ops))}
      ${kv("connected_clients", num(sample.clients))}
      ${kv("used_memory", `${bytes(sample.used)}`)}
      ${kv("latency_avg", `${sample.latency.toFixed(2)} ms`)}
      ${kv("net_in", bytes(sample.netIn))}
      ${kv("net_out", bytes(sample.netOut))}
    </div>
    <div class="detail-col">
      <div class="detail-head"><b>Δ 对比</b> ${prev ? clock(prev.at) : "—"}<span class="mlabel">delta</span></div>
      ${kv("ops", prev ? diff(sample.ops, prev.ops, (v) => num(Math.round(v))) : "—", { leaf: true })}
      ${kv("connected_clients", prev ? diff(sample.clients, prev.clients, (v) => num(Math.round(v))) : "—", { leaf: true })}
      ${kv("used_memory", prev ? diff(sample.used, prev.used, (v) => bytes(v)) : "—", { leaf: true })}
      ${kv("latency_avg", prev ? diff(sample.latency, prev.latency, (v) => `${v.toFixed(2)} ms`) : "—", { leaf: true })}
      ${kv("net_in", prev ? diff(sample.netIn, prev.netIn, (v) => bytes(v)) : "—", { leaf: true })}
    </div>
    <div class="detail-col">
      <div class="detail-head"><b>INFO</b> ${esc(connAddress(conn))}<span class="mlabel">server</span></div>
      ${kv("redis_version", esc(ov.info["redis_version"] ?? "—"))}
      ${kv("keyspaces", keyspaces.length ? `${keyspaces.length} 个库 · ${num(ov.totalKeys)} keys` : "空")}
      ${kv("maxmemory_policy", esc(ov.info["maxmemory_policy"] ?? "—"), { leaf: true, indent: true })}
      ${kv("evicted_keys", count(Number(ov.info["evicted_keys"] ?? 0)), { leaf: true, indent: true, tone: Number(ov.info["evicted_keys"] ?? 0) > 0 ? "warn" : "" })}
      ${kv("uptime", `${duration(Number(ov.info["uptime_in_days"] ?? 0) * 86_400_000)}`, { leaf: true, indent: true })}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* History pane                                                        */
/* ------------------------------------------------------------------ */

/** The first timestamped finding on record, as a marker on the history chart. */
function onsetMarker(anomaly: Map<number, FindingFlag[]>): { at: number; label: string; tone: "warn" | "err" } | null {
  const all = [...anomaly.entries()].flatMap(([at, flags]) => flags.map((f) => ({ at, label: f.label, tone: f.tone })));
  if (!all.length) return null;
  const earliest = Math.min(...all.map((x) => x.at));
  const hit = all.find((f) => f.at === earliest)!;
  return { at: hit.at, label: hit.label, tone: hit.tone };
}

function historyPane(hist: MetricSample[], selected: number, inferred = 0, onset: { at: number; label: string; tone: "warn" | "err" } | null = null): string {
  const size = windowSizeOf(viewStateRef!);
  // The chart plots measured samples only; extrapolated rows exist to keep the
  // stream's time window continuous, not to be drawn as a trend.
  const measured = hist.filter((x) => !x.inferred);
  const slice = measured.slice(-Math.min(size, measured.length));
  const labels = slice.map((x) => clock(x.at));
  const marked = selected >= 0 ? hist[selected] : null;
  const onsetIndex = onset ? slice.findIndex((x) => x.at === onset.at) : -1;
  const legend = `<div class="hist-legend"><span class="mlabel">历史</span><span class="hist-key">操作数 ops/s</span>${marked ? `<span class="hist-sel">${clock(marked.at)} · ${num(Math.round(marked.ops))} ops/s</span>` : ""}<span class="spacer"></span><span class="hist-meta">${slice.length} 个实测样本 · 每 4 秒采样${inferred ? ` · 更早的 ${inferred} 行仅用于保持列表连续` : ""}</span></div>`;
  if (!slice.length) return `<div class="hist">${legend}<div class="chart-empty" style="height:88px">等待采样…</div></div>`;
  const chart = lineChart({
    series: [{ name: "操作数", values: slice.map((x) => x.ops), fill: true }],
    height: 104,
    yTicks: 3,
    xLabels: [labels[0] ?? "", labels[Math.floor(labels.length / 2)] ?? "", labels[labels.length - 1] ?? ""],
    showLegend: false,
    // The inspected sample is marked on the chart with the accent; a finding's
    // onset is marked in its own tone, so the two never read as one line.
    marker: onsetIndex >= 0 && onset
      ? { index: onsetIndex, label: `${clock(onset.at)} ${onset.label}`, tone: onset.tone }
      : marked
        ? { index: slice.findIndex((x) => x.at === marked.at), label: clock(marked.at), tone: "focus" }
        : null,
  });
  return `<div class="hist">${legend}${chart}</div>`;
}

