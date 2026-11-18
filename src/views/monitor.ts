import { bytes, clock, duration, esc, ms, num, timeAgo } from "../core/format";
import { lineChart } from "../core/charts";
import { currentConnection, currentHistory, currentMonitor, currentOverview, sampleNetKbps, type ViewState } from "../core/store";
import { emptyState, iconBtn, pane, readout } from "../ui/kit";

/**
 * Monitor = the long-form side of the stream: trend charts, then the tables
 * that answer "who is connected" and "what is slow" when something already
 * looks wrong. Readings stay in the same ruled strip as the overview.
 */
export function monitorView(_s: ViewState): string {
  const conn = currentConnection();
  if (!conn) return emptyState("还没有连接", "监控需要实时的 INFO 采样。", { label: "新建连接", action: "new-connection" });
  const snap = currentMonitor();
  const ov = currentOverview();
  const hist = currentHistory();

  if (!snap || !ov) {
    return `<div class="state-pad">
      <div class="skeleton" style="width:100%;height:56px"></div>
      <div class="skeleton" style="width:100%;height:220px;margin-top:12px"></div>
      <div class="skeleton" style="width:100%;height:220px;margin-top:12px"></div>
    </div>`;
  }

  // Charts plot measured samples only; there is no truthful way to draw the
  // time before the first sample.
  const all = hist.filter((x) => !x.inferred);
  const pointLabels = all.map((x) => clock(x.at));
  const xLabels = all.length <= 1 ? [all[0] ? "现在" : ""] : [clock(all[0]!.at), clock(all[Math.floor(all.length / 2)]!.at), "现在"];
  const lastRate = sampleNetKbps(all[all.length - 1]);

  return `<section class="reads" aria-label="监控读数">
    ${readout({ label: "QPS", en: "ops/s", value: num(Math.round(ov.opsPerSec)), unit: "ops/s", sub: `${all.length} 个样本 · 4s 间隔` })}
    ${readout({ label: "平均延迟", en: "latency", value: ov.latencyMs.toFixed(2), unit: "ms", sub: "PING 往返" })}
    ${readout({ label: "客户端", en: "clients", value: num(ov.connectedClients), unit: "conns", sub: `阻塞 ${num(Number(ov.info["blocked_clients"] ?? 0))} · 累计 ${num(Number(ov.info["total_connections_received"] ?? 0))}` })}
    ${readout({ label: "内存", en: "used", value: bytes(ov.usedMemoryBytes), unit: ov.maxMemoryBytes ? `/ ${bytes(ov.maxMemoryBytes)}` : "无上限", sub: `碎片率 ${esc(ov.info["mem_fragmentation_ratio"] ?? "—")}` })}
  </section>
  <div class="monitor-root">
  <div class="monitor" style="overflow:auto">
    <div class="pane-grid side" style="padding-top:12px">
      ${pane({
        title: "命令吞吐",
        meta: `${all.length} 个实测样本`,
        tools: iconBtn("refresh", "refresh-monitor", "立即采样"),
        body: lineChart({
          series: [{ name: "ops/s", values: all.map((x) => x.ops), fill: true }],
          height: 176,
          yTicks: 3,
          pointLabels,
          xLabels,
        }),
        bodyCls: "flush",
      })}
      ${pane({
        title: "网络吞吐",
        meta: `in ${bytes(Math.round(lastRate.inKBps * 1024))}/s · out ${bytes(Math.round(lastRate.outKBps * 1024))}/s`,
        body: lineChart({
          series: [
            { name: "in KB/s", values: all.map((x) => sampleNetKbps(x).inKBps), fill: true },
            { name: "out KB/s", values: all.map((x) => sampleNetKbps(x).outKBps), cls: "muted" },
          ],
          height: 176,
          yTicks: 3,
          pointLabels,
          xLabels,
        }),
        bodyCls: "flush",
      })}
    </div>
    <div class="pane-grid side">
      ${pane({ title: "复制拓扑", meta: esc(snap.replication?.role ?? "—"), body: replicationBody(snap), cls: "repl-pane" })}
      ${pane({ title: "服务器信息", meta: "INFO all", body: infoGrid(ov), cls: "info-pane" })}
    </div>
    <div class="pane-grid">
      ${pane({ title: "慢查询", meta: `SLOWLOG GET 20 · ${snap.slowlog.length} 条`, body: slowlogBody(snap), cls: "slowlog-pane" })}
    </div>
    <div class="pane-grid">
      ${pane({ title: "客户端", meta: `${snap.clients.length} 个连接`, body: clientsBody(snap), cls: "clients-pane" })}
    </div>
  </div>
  </div>`;
}

function replicationBody(snap: NonNullable<ReturnType<typeof currentMonitor>>): string {
  const r = snap.replication;
  if (!r) return `<div class="dim" style="font-size:12px">没有复制信息</div>`;
  const head = `<div class="repl-node master"><span class="status-dot on"></span><b>${r.role === "master" ? "Master" : "Replica"}</b><span class="mono faint">${esc(r.masterHost ? `${r.masterHost}:${r.masterPort}` : "本机")}</span>${r.masterLink ? `<span class="spacer"></span><span class="badge ${r.masterLink === "up" ? "ok" : "warn"}">link ${esc(r.masterLink)}</span>` : ""}</div>`;
  const replicas = (r.replicas ?? [])
    .map(
      (rep) => `<div class="repl-node"><span class="status-dot ${rep.state === "online" ? "on" : "warn"}"></span><span class="mono">${esc(rep.addr)}</span><span class="spacer"></span><span class="mono faint">lag ${rep.lag}s</span><span class="badge ${rep.state === "online" ? "ok" : "warn"}">${esc(rep.state)}</span></div>`,
    )
    .join("");
  return `${head}${replicas ? `<div class="repl-list">${replicas}</div>` : `<div class="faint" style="font-size:11.5px;margin-top:8px">没有从节点</div>`}`;
}

function infoGrid(ov: NonNullable<ReturnType<typeof currentOverview>>): string {
  const info = ov.info ?? {};
  const picks: [string, string][] = [
    ["redis_version", "版本"],
    ["os", "系统"],
    ["uptime_in_days", "运行天数"],
    ["hz", "hz"],
    ["maxmemory_policy", "驱逐策略"],
    ["mem_fragmentation_ratio", "碎片率"],
    ["total_connections_received", "累计连接"],
    ["expired_keys", "过期键"],
    ["evicted_keys", "驱逐键"],
    ["keyspace_hits", "命中"],
    ["keyspace_misses", "未命中"],
    ["aof_enabled", "AOF"],
  ];
  return `<div class="info-grid">${picks
    .filter(([k]) => info[k])
    .map(([k, label]) => `<div class="info-cell"><span class="k">${esc(label)}</span><span class="v">${esc(String(info[k]).slice(0, 40))}</span></div>`)
    .join("")}</div>`;
}

function slowlogBody(snap: NonNullable<ReturnType<typeof currentMonitor>>): string {
  const rows = (snap.slowlog ?? [])
    .map((e) => {
      const dur = e.durationUs / 1000;
      const tone = dur >= 5 ? "err" : dur >= 3 ? "warn" : "";
      return `<tr><td class="num-cell faint" style="width:64px">${e.id}</td><td class="num-cell ${tone}" style="width:90px">${ms(dur)}</td><td class="key-cell">${esc((e.command ?? []).slice(0, 4).join(" "))}</td><td class="key-cell faint">${esc(e.client || "—")}</td><td class="num-cell faint" style="width:110px">${timeAgo(e.at)}</td></tr>`;
    })
    .join("");
  return `<table class="tbl"><thead><tr><th>id</th><th style="text-align:right">耗时</th><th>命令</th><th>客户端</th><th style="text-align:right">时间</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="5">没有慢查询记录</td></tr>`}</tbody></table>`;
}

function clientsBody(snap: NonNullable<ReturnType<typeof currentMonitor>>): string {
  const rows = (snap.clients ?? [])
    .slice(0, 80)
    .map(
      (c) => `<tr><td class="num-cell faint" style="width:64px">${c.id}</td><td class="key-cell">${esc(c.addr)}</td><td class="key-cell">${esc(c.name || "—")}</td><td class="num-cell" style="width:56px">${c.db}</td><td class="key-cell">${esc(c.command || "—")}</td><td class="num-cell faint" style="width:90px">${duration(c.age)}</td><td class="num-cell faint" style="width:90px">${duration(c.idle)}</td></tr>`,
    )
    .join("");
  return `<table class="tbl"><thead><tr><th>id</th><th>addr</th><th>name</th><th style="text-align:right">db</th><th>cmd</th><th style="text-align:right">age</th><th style="text-align:right">idle</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="7">没有客户端</td></tr>`}</tbody></table>`;
}
