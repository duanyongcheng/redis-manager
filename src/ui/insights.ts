import type { OverviewSnapshot } from "../core/api";
import { bytes, num, pct } from "../core/format";

export interface Insight {
  id: string;
  tone: "err" | "warn" | "info" | "ok";
  title: string;
  detail: string;
  action?: { label: string; view: "monitor" | "browser" | "cli" | "overview" };
}

const DANGEROUS = new Set(["KEYS", "FLUSHALL", "FLUSHDB", "DEBUG", "MONITOR", "SHUTDOWN", "CONFIG"]);

/** Translates raw INFO into a short, actionable set of findings. */
export function deriveInsights(overview: OverviewSnapshot | null): Insight[] {
  if (!overview) return [];
  const info = overview.info ?? {};
  const out: Insight[] = [];
  const memPct = pct(overview.usedMemoryBytes, overview.maxMemoryBytes);
  const policy = info["maxmemory_policy"] ?? "";
  const evicted = Number(info["evicted_keys"] ?? 0);
  const expired = Number(info["expired_keys"] ?? 0);

  if (overview.maxMemoryBytes > 0) {
    if (memPct >= 85) {
      out.push({
        id: "mem",
        tone: "err",
        title: `内存已用 ${memPct.toFixed(0)}%`,
        detail: `上限 ${bytes(overview.maxMemoryBytes)} · 策略 ${policy || "noeviction"}${evicted ? ` · 已驱逐 ${num(evicted)} 次` : ""}`,
        action: { label: "调整策略", view: "monitor" },
      });
    } else if (memPct >= 65) {
      out.push({
        id: "mem",
        tone: "warn",
        title: `内存已用 ${memPct.toFixed(0)}%`,
        detail: `接近上限 ${bytes(overview.maxMemoryBytes)}，策略 ${policy || "—"}`,
        action: { label: "查看", view: "monitor" },
      });
    }
  } else if (overview.usedMemoryBytes > 0) {
    out.push({
      id: "mem",
      tone: "info",
      title: "未设置 maxmemory",
      detail: `当前占用 ${bytes(overview.usedMemoryBytes)}，实例没有内存上限，存在写满主机的风险`,
      action: { label: "监控", view: "monitor" },
    });
  }

  if (policy === "noeviction" && memPct >= 60) {
    out.push({ id: "policy", tone: "warn", title: "驱逐策略为 noeviction", detail: "写到上限后写命令会直接报错，建议改用 allkeys-lru 或 volatile-ttl", action: { label: "查看", view: "monitor" } });
  }

  if (evicted > 0) {
    out.push({ id: "evict", tone: "warn", title: `已驱逐 ${num(evicted)} 个键`, detail: "缓存正在被挤出，检查热点键是否缺少 TTL 或容量估算偏低" });
  }

  const slow = overview.commands.filter((c) => c.usecPerCall >= 2000).sort((a, b) => b.usecPerCall - a.usecPerCall);
  if (slow[0]) {
    out.push({
      id: "slow",
      tone: "warn",
      title: `${slow[0].name.toUpperCase()} 单次平均 ${(slow[0].usecPerCall / 1000).toFixed(1)} ms`,
      detail: "存在慢命令，可能阻塞单线程事件循环",
      action: { label: "慢日志", view: "monitor" },
    });
  }

  const blocked = Number(info["blocked_clients"] ?? 0);
  if (blocked > 0) {
    out.push({ id: "blocked", tone: "warn", title: `${num(blocked)} 个客户端处于阻塞状态`, detail: "可能来自 BLPOP / BRPOP / WAIT 等阻塞命令", action: { label: "客户端", view: "monitor" } });
  }

  const rejectedClients = Number(info["rejected_connections"] ?? 0);
  if (rejectedClients > 0) {
    out.push({ id: "rej", tone: "err", title: `被拒绝的连接 ${num(rejectedClients)} 次`, detail: "已超过 maxclients 或正在被限流", action: { label: "查看", view: "monitor" } });
  }

  const ttlSpaces = (overview.keyspaces ?? []).filter((ks) => ks.keys > 0 && ks.expires === 0);
  if (ttlSpaces.length > 0 && ttlSpaces.length === overview.keyspaces.filter((ks) => ks.keys > 0).length) {
    out.push({
      id: "ttl",
      tone: "info",
      title: `${ttlSpaces.map((ks) => `db${ks.db}`).join(" / ")} 全部键均未设置 TTL`,
      detail: "没有过期策略，持久化后恢复时数据量可能超出预期",
      action: { label: "浏览键", view: "browser" },
    });
  }

  const danger = overview.commands.filter((c) => DANGEROUS.has(c.name.toUpperCase()) && c.calls > 0);
  if (danger.length) {
    out.push({
      id: "danger",
      tone: "warn",
      title: `${danger.map((c) => c.name.toUpperCase()).join(" / ")} 使用中`,
      detail: "这类命令可能阻塞实例，建议改用 SCAN / INFO 等安全替代",
      action: { label: "CLI", view: "cli" },
    });
  }

  const frag = Number(info["mem_fragmentation_ratio"]);
  if (Number.isFinite(frag) && frag > 1.5) {
    out.push({ id: "frag", tone: "info", title: `内存碎片率 ${frag.toFixed(2)}`, detail: "RSS 明显高于数据占用，重启或开启主动碎片整理会有收益" });
  }

  if (expired > 0 && overview.keyspaces?.every((ks) => ks.expires === 0)) {
    out.push({ id: "expired", tone: "info", title: `累计过期 ${num(expired)} 个键`, detail: "说明历史数据设置过 TTL，当前键空间已基本无过期键" });
  }

  if (out.length === 0) {
    out.push({ id: "healthy", tone: "ok", title: "没有发现明显异常", detail: `内存 ${bytes(overview.usedMemoryBytes)} · 客户端 ${overview.connectedClients} · 延迟 ${overview.latencyMs.toFixed(1)} ms` });
  }
  return out.slice(0, 6);
}
