import { bytes, duration, esc, ms, num, timeAgo } from "../core/format";
import { lineChart, sparkline } from "../core/charts";
import { currentConnection, currentHistory, currentMonitor, currentOverview, type ViewState } from "../core/store";
import { card, emptyState, iconBtn } from "../ui/kit";

export function monitorView(s: ViewState): string {
  const conn = currentConnection();
  if (!conn) return emptyState("还没有连接", "监控需要实时的 INFO 采样。", { label: "新建连接", action: "new-connection" });
  const snap = currentMonitor();
  const ov = currentOverview();
  const hist = currentHistory();

  if (!snap || !ov) {
    return `<div class="overview-stack">
      ${[0, 1].map(() => `<div class="card"><div class="card-body"><div class="skeleton" style="width:30%;height:12px"></div><div class="skeleton" style="width:100%;height:180px;margin-top:14px"></div></div></div>`).join("")}
    </div>`;
  }

  const netIn = hist.map((x) => x.netIn);
  const netOut = hist.map((x) => x.netOut);

  return `<div class="overview-stack">
    <div class="monitor-mini">
      ${mini("QPS", num(Math.round(ov.opsPerSec)), "ops/s", hist.map((x) => x.ops))}
      ${mini("P99 / 延迟", `${(ov.latencyMs / 1000).toFixed(2)}`, "ms", hist.map((x) => x.latency))}
      ${mini("连接数", num(ov.connectedClients), "clients", hist.map((x) => x.clients))}
      ${mini("内存", bytes(ov.usedMemoryBytes), ov.maxMemoryBytes ? `/ ${bytes(ov.maxMemoryBytes)}` : "无上限", hist.map((x) => x.used))}
    </div>
    ${card({
      title: "命令吞吐",
      iconName: "activity",
      meta: `采样 ${hist.length} 点 · 4s 间隔`,
      tools: iconBtn("refresh", "refresh-monitor", "立即采样"),
      body: lineChart({
        series: [{ name: "ops/s", values: hist.map((x) => x.ops), fill: true }],
        height: 200,
        xLabels: hist.map((_, i) => (i === hist.length - 1 ? "现在" : `-${(hist.length - i - 1) * 4}s`)),
      }),
    })}
    ${card({
      title: "内存与网络",
      iconName: "network",
      meta: `mem ${bytes(ov.usedMemoryBytes)}`,
      body: lineChart({
        series: [
          { name: "in KB/s", values: netIn.map((v) => v / 1024) },
          { name: "out KB/s", values: netOut.map((v) => v / 1024) },
        ],
        height: 170,
        xLabels: hist.map((_, i) => (i === hist.length - 1 ? "现在" : `-${(hist.length - i - 1) * 4}s`)),
      }),
    })}
    <div class="monitor-grid">
      ${card({ title: "复制拓扑", iconName: "link", meta: esc(snap.replication.role), body: replicationBody(snap) })}
      ${card({ title: "服务器信息", iconName: "cpu", meta: "INFO", body: infoGrid(ov) })}
    </div>
    ${card({ title: "慢查询日志", iconName: "clock", meta: `SLOWLOG GET 20`, bodyCls: "flush", body: slowlogBody(snap) })}
    ${card({ title: "客户端", iconName: "users", meta: `CLIENT LIST · ${snap.clients.length}`, bodyCls: "flush", body: clientsBody(snap) })}
  </div>`;
}

function mini(label: string, value: string, unit: string, series: number[]): string {
  return `<div class="card monitor-cell"><div class="kpi-label">${esc(label)}</div><div class="mono num" style="font-size:17px;font-weight:600">${esc(value)} <span class="kpi-unit">${esc(unit)}</span></div>${sparkline(series, { color: "var(--series-0)" })}</div>`;
}

function replicationBody(snap: NonNullable<ReturnType<typeof currentMonitor>>): string {
  const r = snap.replication;
  if (!r) return `<div class="dim">没有复制信息</div>`;
  const head = `<div class="repl-node master"><span class="status-dot on"></span><b>${r.role === "master" ? "Master" : "Replica"}</b><span class="mono faint">${esc(r.masterHost ? `${r.masterHost}:${r.masterPort}` : "本机")}</span>${r.masterLink ? `<span class="badge ${r.masterLink === "up" ? "ok" : "warn"}">${esc(r.masterLink)}</span>` : ""}</div>`;
  const replicas = (r.replicas ?? [])
    .map(
      (rep) => `<div class="repl-node"><span class="status-dot ${rep.state === "online" ? "on" : "warn"}"></span><b class="mono">${esc(rep.addr)}</b><span class="faint mono">lag ${rep.lag}s</span><span class="badge ${rep.state === "online" ? "ok" : "warn"}">${esc(rep.state)}</span></div>`,
    )
    .join("");
  return `${head}${replicas ? `<div class="repl-list">${replicas}</div>` : `<div class="faint" style="font-size:11.5px;margin-top:8px">没有从节点</div>`}`;
}

function infoGrid(ov: NonNullable<ReturnType<typeof currentOverview>>): string {
  const info = ov.info ?? {};
  const picks = [
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
    .filter(([k]) => info[k!])
    .map(([k, label]) => `<div class="info-cell"><span class="label">${esc(label!)}</span><span class="mono num">${esc(String(info[k!]).slice(0, 40))}</span></div>`)
    .join("")}</div>`;
}

function slowlogBody(snap: NonNullable<ReturnType<typeof currentMonitor>>): string {
  const rows = (snap.slowlog ?? [])
    .map((e) => {
      const dur = e.durationUs / 1000;
      const tone = dur >= 5 ? "err" : dur >= 3 ? "warn" : "";
      return `<tr><td class="num-cell faint">${e.id}</td><td class="num-cell ${tone}">${ms(dur)}</td><td class="key-cell">${esc((e.command ?? []).slice(0, 4).join(" "))}</td><td class="mono faint">${esc(e.client || "—")}</td><td class="mono faint">${timeAgo(e.at)}</td></tr>`;
    })
    .join("");
  return `<div class="tbl-wrap" style="max-height:260px"><table class="tbl"><thead><tr><th>id</th><th style="text-align:right">耗时</th><th>命令</th><th>客户端</th><th>时间</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="5">没有慢查询记录</td></tr>`}</tbody></table></div>`;
}

function clientsBody(snap: NonNullable<ReturnType<typeof currentMonitor>>): string {
  const rows = (snap.clients ?? [])
    .slice(0, 60)
    .map(
      (c) => `<tr><td class="num-cell faint">${c.id}</td><td class="key-cell">${esc(c.addr)}</td><td class="mono">${esc(c.name || "—")}</td><td class="num-cell">${c.db}</td><td class="mono">${esc(c.command || "—")}</td><td class="num-cell faint">${duration(c.age)}</td><td class="num-cell faint">${duration(c.idle)}</td></tr>`,
    )
    .join("");
  return `<div class="tbl-wrap" style="max-height:300px"><table class="tbl"><thead><tr><th>id</th><th>addr</th><th>name</th><th style="text-align:right">db</th><th>cmd</th><th style="text-align:right">age</th><th style="text-align:right">idle</th></tr></thead><tbody>${rows || `<tr class="empty-row"><td colspan="7">没有客户端</td></tr>`}</tbody></table></div>`;
}
