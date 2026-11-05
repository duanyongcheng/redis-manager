/* Mock data for the prototype. Deterministic so screenshots are stable. */
(function () {
  // -- small deterministic PRNG -------------------------------------------
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // -- series generators ---------------------------------------------------
  // A gently wandering series with occasional spikes.
  function series(n, base, amp, noise, seed, opts) {
    const r = rng(seed);
    const out = [];
    let v = base;
    let hot = 0;
    for (let i = 0; i < n; i++) {
      v += (base - v) * 0.08 + (r() - 0.5) * amp;
      let x = v + (r() - 0.5) * noise;
      if (hot > 0) { x *= 1.35 + r() * 0.5; hot--; }
      else if (r() < 0.03) hot = 2 + Math.floor(r() * 4);
      if (opts && opts.max) x = Math.min(x, opts.max);
      if (opts && opts.min !== undefined) x = Math.max(x, opts.min);
      out.push(Math.round(x * 100) / 100);
    }
    return out;
  }

  const N = 60;

  const overview = {
    cpu: series(N, 22, 3.5, 4, 11, { min: 2, max: 92 }),
    mem: series(N, 58, 1.4, 1.2, 23, { min: 40, max: 95 }),
    ops: series(N, 12400, 900, 600, 37, { min: 3000 }),
    netIn: series(N, 620, 90, 70, 41, { min: 60 }),
    netOut: series(N, 1180, 140, 110, 43, { min: 100 }),
  };

  // -- connections ---------------------------------------------------------
  const connections = [
    {
      id: 'local', name: 'Local Dev', host: '127.0.0.1', port: 6379, db: 0,
      color: '#ff5c4a', status: 'on', version: '7.4', group: 'Local',
      spark: series(20, 30, 8, 10, 5, { min: 1 }), mode: 'Standalone',
    },
    {
      id: 'prod-order', name: 'Prod · Order Svc', host: 'redis-order.prod.internal', port: 6379, db: 0,
      color: '#5aa9f7', status: 'on', version: '7.2', group: 'Production', tls: true, cluster: true,
      spark: series(20, 60, 6, 8, 9, { min: 1 }), mode: 'Cluster',
    },
    {
      id: 'prod-cache', name: 'Prod · Session Cache', host: 'redis-cache.prod.internal', port: 6380, db: 2,
      color: '#b18cf2', status: 'warn', version: '7.2', group: 'Production', tls: true,
      spark: series(20, 85, 4, 6, 13, { min: 40 }), mode: 'Sentinel',
    },
    {
      id: 'stage', name: 'Staging', host: '10.20.3.41', port: 6379, db: 1,
      color: '#46c98b', status: 'on', version: '7.0', group: 'Staging',
      spark: series(20, 18, 6, 8, 17, { min: 1 }), mode: 'Standalone',
    },
    {
      id: 'legacy', name: 'Legacy Blog', host: '10.0.0.12', port: 6379, db: 0,
      color: '#8b949e', status: 'off', version: '5.0', group: 'Staging',
      spark: series(20, 5, 2, 2, 19, { min: 0 }), mode: 'Standalone',
    },
  ];

  // -- keys ----------------------------------------------------------------
  const keyGroups = [
    {
      name: 'user:', open: true, count: 12480,
      keys: [
        { k: 'user:1001', t: 'hash', size: '8 fields', ttl: '2d 4h' },
        { k: 'user:1002', t: 'hash', size: '6 fields', ttl: '1d 11h' },
        { k: 'user:1003', t: 'hash', size: '12 fields', ttl: '-' },
        { k: 'user:1004', t: 'hash', size: '5 fields', ttl: '6h 20m' },
        { k: 'user:1005', t: 'hash', size: '9 fields', ttl: '11d' },
      ],
      more: 11790,
    },
    {
      name: 'session:', open: true, count: 8321,
      keys: [
        { k: 'session:a91f2c', t: 'string', size: '412 B', ttl: '29m' },
        { k: 'session:b70e4d', t: 'string', size: '388 B', ttl: '29m' },
        { k: 'session:c33a1e', t: 'string', size: '401 B', ttl: '28m' },
      ],
      more: 8008,
    },
    {
      name: 'cache:', open: false, count: 24109,
      keys: [
        { k: 'cache:home:feed', t: 'string', size: '48 KB', ttl: '1m 10s' },
        { k: 'cache:product:88', t: 'string', size: '6.2 KB', ttl: '58s' },
      ],
      more: 24109,
    },
    { name: 'queue:', open: false, count: 412, keys: [], more: 412 },
    { name: 'rate:', open: false, count: 2013, keys: [], more: 2013 },
    { name: 'idx:', open: false, count: 341, keys: [], more: 341 },
    { name: 'leaderboard', t: 'zset', size: '1,024 members', ttl: '-' },
    { name: 'feature:flags', t: 'string', size: '2.1 KB', ttl: '-' },
    { name: 'events:stream', t: 'stream', size: '18,240 entries', ttl: '-' },
    { name: 'tags:hot', t: 'set', size: '236 members', ttl: '-' },
  ];

  // -- the selected hash value ---------------------------------------------
  const userHash = {
    key: 'user:1002',
    type: 'hash',
    ttlMs: 97200000, // 1d 3h
    sizeBytes: 486,
    encoding: 'listpack',
    fields: [
      ['id', '1002'],
      ['name', 'Ada Lovelace'],
      ['email', 'ada@example.com'],
      ['plan', 'pro'],
      ['created_at', '2026-03-14T09:22:11Z'],
      ['last_login', '2026-11-05T07:39:02Z'],
      ['avatar', 'https://cdn.example.com/a/1002.png'],
      ['locale', 'zh-CN'],
      ['verified', 'true'],
      ['credits', '18420'],
    ],
    idleSeconds: 42,
    freq: 7,
  };

  const sessionString = {
    key: 'session:a91f2c',
    type: 'string',
    ttlMs: 1740000,
    sizeBytes: 412,
    encoding: 'embstr',
    raw: '{"uid":1002,"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMDAyIiwiZXhwIjoxNzYyNDI3MjAwfQ","ip":"203.0.113.42","ua":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)","created":1762337280,"refresh":true}',
  };

  const zsetBoard = {
    key: 'leaderboard',
    type: 'zset',
    ttlMs: -1,
    sizeBytes: 28140,
    encoding: 'skiplist',
    members: [
      ['player:8842', 98420], ['player:1190', 97310], ['player:5521', 95880],
      ['player:3307', 93115], ['player:9012', 90877], ['player:6640', 89420],
      ['player:2245', 88102], ['player:7733', 86950], ['player:1284', 84120],
      ['player:4498', 82330],
    ],
  };

  const streamEvents = {
    key: 'events:stream',
    type: 'stream',
    ttlMs: -1,
    sizeBytes: 2218400,
    length: 18240,
    groups: [
      { name: 'billing', consumers: 3, pending: 12, lag: 4 },
      { name: 'analytics', consumers: 5, pending: 0, lag: 0 },
    ],
    entries: [
      ['1762427162310-0', [['event', 'order.paid'], ['order', '83821'], ['amount', '128.00']]],
      ['1762427161802-0', [['event', 'cart.add'], ['sku', 'SKU-991'], ['qty', '2']]],
      ['1762427160921-0', [['event', 'user.signup'], ['uid', '10031']]],
      ['1762427160044-0', [['event', 'order.shipped'], ['order', '83799'], ['carrier', 'sf']]],
      ['1762427159120-0', [['event', 'inventory.sync'], ['warehouse', 'wh-2'], ['items', '42']]],
    ],
  };

  // -- server info ---------------------------------------------------------
  const info = {
    redis_version: '7.2.4',
    redis_mode: 'cluster_enabled: 1',
    os: 'Linux 6.1.0-18-amd64 x86_64',
    arch_bits: '64',
    process_id: '1421',
    uptime_in_days: '46',
    connected_clients: '318',
    blocked_clients: '0',
    used_memory_human: '3.42G',
    used_memory_peak_human: '3.88G',
    maxmemory_human: '6.00G',
    maxmemory_policy: 'allkeys-lru',
    mem_fragmentation_ratio: '1.07',
    total_commands_processed: '184,229,041',
    instantaneous_ops_per_sec: '12,408',
    keyspace_hits: '92,104,882',
    keyspace_misses: '1,204,331',
    evicted_keys: '18,402',
    rejected_connections: '0',
  };

  const slowlog = [
    { id: 1842, ts: '2026-11-05 15:31:02', usec: 12480, cmd: 'HGETALL user:*', client: '10.20.1.14:55012' },
    { id: 1841, ts: '2026-11-05 15:29:48', usec: 8810, cmd: 'KEYS *', client: '10.20.1.71:41388' },
    { id: 1840, ts: '2026-11-05 15:22:11', usec: 4210, cmd: 'ZRANGE leaderboard 0 -1', client: '10.20.1.14:55012' },
    { id: 1839, ts: '2026-11-05 15:10:03', usec: 3120, cmd: 'SMEMBERS tags:hot', client: '10.20.2.9:60822' },
    { id: 1838, ts: '2026-11-05 14:58:37', usec: 2870, cmd: 'SCAN 0 COUNT 10000', client: '10.20.1.71:41388' },
  ];

  const clients = [
    { addr: '10.20.1.14:55012', name: 'order-svc-7f9c', age: '4d', idle: '0s', db: 0, cmd: 'hgetall' },
    { addr: '10.20.1.14:55021', name: 'order-svc-7f9c', age: '4d', idle: '2s', db: 0, cmd: 'get' },
    { addr: '10.20.1.71:41388', name: 'metrics-exporter', age: '12d', idle: '14s', db: 0, cmd: 'scan' },
    { addr: '10.20.2.9:60822', name: 'web-nginx-02', age: '1d', idle: '0s', db: 2, cmd: 'smembers' },
    { addr: '10.20.2.9:60831', name: 'web-nginx-02', age: '1d', idle: '0s', db: 2, cmd: 'zrange' },
  ];

  const keyspaces = [
    { db: 0, keys: 48201, expires: 31204, avgTtl: '3.2h', bytes: '1.9G', pct: 62, ew: 39 },
    { db: 1, keys: 1204, expires: 1204, avgTtl: '12m', bytes: '84M', pct: 6, ew: 100 },
    { db: 2, keys: 24880, expires: 24880, avgTtl: '25m', bytes: '1.4G', pct: 44, ew: 100 },
    { db: 3, keys: 412, expires: 0, avgTtl: '-', bytes: '6M', pct: 2, ew: 0 },
  ];

  const commands = [
    { name: 'hgetall', calls: 4120, pct: 92, usec: 182, color: 'var(--info)' },
    { name: 'get', calls: 3010, pct: 74, usec: 64, color: 'var(--ok)' },
    { name: 'setex', calls: 2019, pct: 50, usec: 88, color: 'var(--purple)' },
    { name: 'zrange', calls: 1104, pct: 30, usec: 240, color: 'var(--warn)' },
    { name: 'hset', calls: 702, pct: 20, usec: 120, color: '#e58fb8' },
    { name: 'scan', calls: 410, pct: 12, usec: 412, color: 'var(--err)' },
  ];
  const maxCalls = 100;

  const monitor = {
    ops: series(N, 12400, 900, 600, 37, { min: 3000 }),
    latencyP99: series(N, 1.4, 0.2, 0.35, 51, { min: 0.2 }),
    clients: series(N, 318, 18, 12, 53, { min: 100 }),
    memory: series(N, 3498, 12, 18, 57, { min: 3000 }),
    netIn: series(N, 36, 6, 5, 59, { min: 5 }),
    netOut: series(N, 71, 8, 7, 61, { min: 10 }),
  };

  const topology = {
    master: { addr: '10.20.1.10:6379', role: 'master', slots: '0-16383', state: 'ok' },
    replicas: [
      { addr: '10.20.1.11:6379', role: 'replica', lag: '1.2s', state: 'ok' },
      { addr: '10.20.1.12:6379', role: 'replica', lag: '1.4s', state: 'ok' },
    ],
    sentinels: ['10.20.1.20:26379', '10.20.1.21:26379', '10.20.1.22:26379'],
  };

  const settings = {
    theme: 'dark',
    fontSize: '13',
    refresh: '2s',
    scanCount: '500',
    maxKeys: '5000',
    dangerousConfirm: true,
    telemetry: false,
  };

  window.DATA = {
    series, overview, connections, keyGroups, userHash, sessionString, zsetBoard,
    streamEvents, info, slowlog, clients, keyspaces, commands, maxCalls, monitor,
    topology, settings, totalKeys: 74897,
  };
})();
