/**
 * Preview-only fixture: injects a fake `window.RedisService` so the shell can
 * be screenshotted in a plain browser without the Go runtime. Screenshots run
 * with `?preview=1`; the real app never loads this file.
 */
(() => {
  const now = Date.now();
  const keyspace = [
    { db: 0, keys: 48201, expires: 18798, avgTtlMs: 11520000 },
    { db: 1, keys: 1204, expires: 1204, avgTtlMs: 7200000 },
    { db: 2, keys: 24880, expires: 24880, avgTtlMs: 1500000 },
    { db: 3, keys: 412, expires: 0, avgTtlMs: 0 },
  ];
  const commands = [
    { name: "hgetall", calls: 4120, usec: 900000, usecPerCall: 218, rejected: 0, failed: 0 },
    { name: "get", calls: 3010, usec: 120000, usecPerCall: 39, rejected: 0, failed: 0 },
    { name: "setex", calls: 2019, usec: 140000, usecPerCall: 69, rejected: 0, failed: 0 },
    { name: "zrange", calls: 1104, usec: 320000, usecPerCall: 289, rejected: 0, failed: 0 },
    { name: "hset", calls: 702, usec: 61000, usecPerCall: 86, rejected: 0, failed: 0 },
    { name: "scan", calls: 410, usec: 240000, usecPerCall: 2400, rejected: 0, failed: 0 },
    { name: "keys", calls: 12, usec: 96000, usecPerCall: 8000, rejected: 0, failed: 0 },
  ];
  const info = {
    redis_version: "7.2.4",
    os: "Linux 6.1 aarch64",
    uptime_in_days: "18",
    hz: "10",
    maxmemory_policy: "allkeys-lru",
    mem_fragmentation_ratio: "1.24",
    total_connections_received: "18402",
    expired_keys: "19834",
    evicted_keys: "1204",
    keyspace_hits: "890122",
    keyspace_misses: "11890",
    aof_enabled: "1",
    blocked_clients: "3",
    total_net_input_bytes: "1048576000",
    total_net_output_bytes: "2097152000",
    role: "master",
  };

  const conns = [
    { id: "prod-order", name: "Prod · Order Svc", group: "Production", host: "redis-order.prod.internal", port: 6379, db: 0, mode: "cluster", tls: true, readOnly: false, color: "" },
    { id: "prod-cache", name: "Prod · Session Cache", group: "Production", host: "redis-cache.prod.internal", port: 6380, db: 0, mode: "cluster", tls: true, readOnly: true },
    { id: "staging", name: "Staging", group: "Staging", host: "10.20.3.41", port: 6379, db: 1, mode: "sentinel", tls: false, readOnly: false },
    { id: "legacy", name: "Legacy Blog", group: "Staging", host: "10.0.0.12", port: 6379, db: 0, mode: "standalone", tls: false, readOnly: false },
    { id: "local", name: "Local Dev", group: "Local", host: "127.0.0.1", port: 6379, db: 0, mode: "standalone", tls: false, readOnly: false },
  ];

  let tick = 0;
  const overview = () => {
    tick += 1;
    const wave = Math.sin(tick / 2.2) * 1600 + Math.sin(tick / 7) * 900;
    const net = 1048576000 + tick * 2_400_000;
    return {
      atMs: Date.now(),
      opsPerSec: 12442 + wave,
      connectedClients: 318 + Math.round(Math.sin(tick / 4) * 9),
      usedMemoryBytes: 3.42 * 1024 ** 3,
      maxMemoryBytes: 6 * 1024 ** 3,
      latencyMs: 0.82 + Math.random() * 0.2,
      totalKeys: 74697,
      keyspaces: keyspace,
      commands,
      info: { ...info, total_net_input_bytes: String(net), total_net_output_bytes: String(net * 2 + tick * 1_100_000) },
    };
  };

  const keyNames = [];
  for (let i = 1001; i <= 1018; i += 1) keyNames.push(`user:${i}`);
  ["session:a91f2c", "session:b70e4d", "cache:home:feed", "cache:product:88", "leaderboard", "queue:orders", "lock:order:1002", "rate:ip:10.0.0.1"].forEach((k) => keyNames.push(k));
  const keyMeta = keyNames.map((key, i) => ({
    key,
    type: key.startsWith("user:") ? "hash" : key.startsWith("session:") ? "string" : key === "leaderboard" ? "zset" : key.startsWith("queue:") ? "list" : key.startsWith("lock:") ? "string" : "string",
    ttlMs: key.startsWith("user:") ? 3600_000 + i * 1000 : key.startsWith("cache:") ? 600000 : -1,
    sizeBytes: 486 + i * 37,
    encoding: key.startsWith("user:") ? "listpack" : "embstr",
  }));

  const hash = {};
  [
    ["id", "1002"], ["name", "Ada Lovelace"], ["email", "ada@example.com"], ["plan", "pro"],
    ["created_at", "2026-03-14T09:22:11Z"], ["last_login", "2026-11-05T07:39:02Z"],
    ["avatar", "https://cdn.example.com/a/1002.png"], ["locale", "zh-CN"], ["verified", "true"], ["credits", "18420"],
  ].forEach(([k, v]) => (hash[k] = v));

  // Lets the screenshot script type a few commands into the CLI.
  window.__RM_PREVIEW_DEMO__ = async (lines) => {
    for (const line of lines) {
      const input = document.getElementById("cli-input");
      if (!input) continue;
      input.value = line;
      await new Promise((r) => setTimeout(r, 50));
      document.getElementById("cli-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 80));
    }
  };

  window.RedisService = {
    listConnections: async () => conns,
    saveConnection: async () => {},
    deleteConnection: async () => {},
    testConnection: async () => ({ status: "ok", message: "", version: "7.2.4", mode: "standalone", latencyMs: 0.8, dbCount: 16 }),
    checkConnection: async () => ({ status: "ok", message: "", version: "7.2.4", mode: "standalone", latencyMs: 0.8, dbCount: 16 }),
    getOverview: async () => overview(),
    getMonitorSnapshot: async () => ({
      overview: overview(),
      slowlog: [
        { id: 41, at: Math.floor(now / 1000) - 120, durationUs: 8120, command: ["HGETALL", "user:1002"], client: "10.20.1.5:51244" },
        { id: 40, at: Math.floor(now / 1000) - 460, durationUs: 4310, command: ["ZRANGE", "leaderboard", "0", "-1"], client: "10.20.1.7:33112" },
        { id: 39, at: Math.floor(now / 1000) - 900, durationUs: 2240, command: ["SCAN", "0", "MATCH", "user:*", "COUNT", "1000"], client: "10.20.1.9:19002" },
      ],
      clients: Array.from({ length: 12 }, (_, i) => ({
        id: 100 + i, addr: `10.20.1.${5 + i}:${51000 + i * 7}`, name: i === 0 ? "order-svc" : "", age: 1200 + i * 330,
        idle: i % 4, db: i % 3, command: ["hgetall", "get", "setex", "scan", "zrange"][i % 5],
      })),
      replication: {
        role: "master", masterHost: "", masterPort: 0, masterLink: "up",
        replicas: [
          { id: 1, addr: "10.0.0.21:6379", state: "online", lag: 0, syncInProgress: false },
          { id: 2, addr: "10.0.0.22:6379", state: "online", lag: 1, syncInProgress: false },
        ],
      },
    }),
    scanKeys: async (_id, _db, pattern) => {
      const list = pattern && pattern !== "*" ? keyMeta.filter((k) => k.key.startsWith(pattern.replace(/\*$/, ""))) : keyMeta;
      return { keys: list, cursor: 10240, done: true };
    },
    getValue: async (_id, _db, key) => ({
      key, type: key.startsWith("user:") ? "hash" : key === "leaderboard" ? "zset" : "string",
      ttlMs: 28800_000, sizeBytes: 486, encoding: "listpack",
      stringValue: key === "leaderboard" ? "" : '{"home":{"feed":["sku:88","sku:91"]},"updated":"2026-11-06T02:11:03Z"}',
      hash: key.startsWith("user:") ? hash : undefined,
      zset: key === "leaderboard" ? [{ member: "user:1002", score: 9840 }, { member: "user:1044", score: 9112 }, { member: "user:1013", score: 8770 }] : undefined,
    }),
    deleteKey: async () => {},
    hashSet: async () => {},
    execCLI: async (_id, _db, line, readOnly) => {
      const cmd = line.trim().split(/\s+/)[0].toLowerCase();
      if (readOnly && ["set", "del", "hset", "flushall"].includes(cmd)) {
        return { lines: [{ kind: "error", text: `只读模式已拦截 ${cmd.toUpperCase()} 命令，请切换到可写模式后重试。` }], durationMs: 0.1 };
      }
      if (cmd === "keys") return { lines: [{ kind: "error", text: "KEYS 可能阻塞实例，请使用 SCAN 0 MATCH ... COUNT 1000。" }], durationMs: 0.1 };
      if (cmd === "info") return { lines: [{ kind: "string", text: "# Keyspace\ndb0:keys=48201,expires=18798\n# Stats\ntotal_connections_received:18402\n" }], durationMs: 0.4 };
      if (cmd === "dbsize") return { lines: [{ kind: "integer", text: "(integer) 74697" }], durationMs: 0.3 };
      if (cmd === "scan") return { lines: [{ kind: "array", text: '1) "10240"\n2) 1) "user:1001"\n   2) "user:1002"\n   3) "user:1003"' }], durationMs: 0.4 };
      if (cmd === "hgetall") return { lines: [{ kind: "array", text: '1) "id"\n2) "1002"\n3) "name"\n4) "Ada Lovelace"\n5) "email"\n6) "ada@example.com"' }], durationMs: 0.5 };
      return { lines: [{ kind: "status", text: "OK" }], durationMs: 0.2 };
    },
  };
})();
export {};
