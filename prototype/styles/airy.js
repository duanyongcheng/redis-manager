/* D · Airy 轻盈玻璃风 */
(function () {
  const D = window.DATA, A = window.APP, I = window.icon;
  const fmt = A.fmt;
  const root = document.getElementById('root');
  const S = { page: 'overview', palette: false };

  const TYPE = { hash: 'hash', string: 'string', zset: 'zset', set: 'set', stream: 'stream', list: 'list' };
  const TYPE_COLOR = {
    hash: '#c9b6ff', string: '#60a5fa', zset: '#ff7eb6', set: '#fbbf24', stream: '#4ade80', list: '#34d399',
  };
  const TYPE_BG = {
    hash: 'rgba(201,182,255,.14)', string: 'rgba(96,165,250,.14)', zset: 'rgba(255,126,182,.14)',
    set: 'rgba(251,191,36,.14)', stream: 'rgba(74,222,128,.14)', list: 'rgba(52,211,153,.14)',
  };

  function conn() { return A.connections.find((c) => c.id === 'order'); }

  /* ------------------------------------------------------------- shell */
  function sidebar() {
    const nav = [['overview', 'activity', '总览'], ['browser', 'key', '键浏览'], ['cli', 'terminal', 'CLI'],
      ['monitor', 'gauge', '监控'], ['connections', 'plug', '连接'], ['settings', 'sliders', '设置']];
    return `
    <aside class="a-side">
      <div class="a-titlebar"><div class="a-lights"><i></i><i></i><i></i></div></div>
      <div class="a-brand">
        <span class="a-logo">R</span>
        <div><b>Redis Manager</b><span>Go · MyGo</span></div>
      </div>
      <div class="a-search" data-action="palette">${I('search', 14)}<span>搜索或执行命令…</span><kbd>⌘K</kbd></div>
      <nav class="a-nav">
        ${nav.slice(0, 4).map(([id, ic, label]) => `
          <div class="a-nav-item ${id === S.page ? 'on' : ''}" data-tab="${id}">${I(ic, 16)}<span class="grow">${label}</span>${id === 'browser' ? '<span class="k">74.9k</span>' : ''}${id === 'monitor' ? '<span class="k">live</span>' : ''}</div>`).join('')}
      </nav>
      <div class="a-side-label">连接</div>
      <div class="a-conns">
        ${A.connections.map((c) => `
          <div class="a-conn ${c.id === 'order' ? 'on' : ''}" data-conn="${c.id}">
            <span class="dot ${c.status}"></span><span class="nm">${c.name}</span>
          </div>`).join('')}
        <div class="a-conn" style="color:var(--fg-3)">${I('plus', 15)}<span class="nm">添加连接…</span></div>
      </div>
      <div class="a-side-foot">
        <div class="a-nav-item ${S.page === 'connections' ? 'on' : ''}" data-tab="connections">${I('plug', 16)}<span class="grow">连接管理</span></div>
        <div class="a-nav-item ${S.page === 'settings' ? 'on' : ''}" data-tab="settings">${I('sliders', 16)}<span class="grow">设置</span><kbd class="k">⌘,</kbd></div>
      </div>
    </aside>`;
  }

  function topbar() {
    const tabs = [['overview', '本机情况'], ['browser', '键'], ['cli', 'CLI'], ['monitor', '监控']];
    const c = conn();
    return `
    <header class="a-top">
      <div class="a-tabs">
        ${tabs.map(([id, l]) => `<div class="a-tab ${id === S.page ? 'on' : ''}" data-tab="${id}">${l}</div>`).join('')}
      </div>
      <span class="spacer"></span>
      <span class="a-chip">${I('checkCircle', 12)} ${c.mode.toLowerCase()} · 0.6 ms</span>
      <button class="a-btn ghost" data-action="refresh">${I('refresh', 15)}</button>
      <button class="a-btn grad">${I('plus', 14)} 新建连接</button>
      <span class="a-avatar">AD</span>
    </header>`;
  }

  function statusbar() {
    return `
    <footer class="a-status">
      <span><span class="dot"></span>已连接 · ${conn().name}</span>
      <span>redis <b>7.2.4</b></span>
      <span class="grow"></span>
      <span>ops <b>12,442/s</b></span>
      <span>mem <b>3.42 GB</b></span>
      <span>keys <b>74,897</b></span>
      <span>hit <b>98.7%</b></span>
    </footer>`;
  }

  function card(title, right, body, cls, extra) {
    return `
    <section class="a-card ${cls || ''}" ${extra || ''}>
      ${title ? `<div class="a-card-head"><h3>${title}</h3><span class="grow"></span>${right || ''}</div>` : ''}
      ${body}
    </section>`;
  }

  /* ----------------------------------------------------------- overview */
  function overview() {
    const kpis = [
      { lab: 'QPS 吞吐', fig: '12,442', u: 'ops/s', data: D.overview.ops, c1: '#8b7cff', c2: '#c17bff', trend: '<b>▲ 4.2%</b> 较上一小时' },
      { lab: '在线客户端', fig: '318', u: '个', data: D.monitor.clients, c1: '#60a5fa', c2: '#8b7cff', trend: '阻塞 0 · 峰值 412' },
      { lab: '内存占用', fig: '3.42', u: 'GB', data: D.monitor.memory, c1: '#ff7eb6', c2: '#c17bff', trend: '上限 6 GB · 57%' },
      { lab: '平均延迟', fig: '0.82', u: 'ms', data: D.monitor.latencyP99, c1: '#4ade80', c2: '#60a5fa', trend: 'P99 1.4 ms' },
    ];
    return `
    <div class="a-body">
      <div class="a-hello">
        <h1>早上好，Adam <span class="grad">/</span> Prod · Order Svc</h1>
        <p>${conn().host}:${conn().port} · db${conn().db} · Cluster · redis 7.2.4 <span class="a-chip">全部健康</span></p>
      </div>

      <div class="a-kpis">
        ${kpis.map((k) => `
          <div class="a-kpi">
            <div class="lab">${k.lab}</div>
            <div class="big">${k.fig}<small>${k.u}</small></div>
            ${sparkGrad(k.data, k.c1, k.c2)}
            <div class="trend">${k.trend}</div>
          </div>`).join('')}
      </div>

      <div class="a-grid">
        <div>
          ${card('吞吐与延迟', `<div class="a-seg"><button class="on">60s</button><button>5m</button><button>1h</button><button>24h</button></div>`, `
            <div class="a-chart" data-chart-root>
              ${lineChart({
                w: 640, h: 210, yFormat: (v) => (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v),
                xLabels: ['-60s', '-45s', '-30s', '-15s', '-5s', 'now'], min: 0,
                series: [
                  { values: D.overview.ops, color: '#8b7cff', label: 'ops/s' },
                  { values: D.monitor.ops.map((v, i) => v * 0.78 + (D.overview.ops[i] - D.monitor.ops[i]) * 0.3), color: '#ff7eb6', label: 'hits/s' },
                ],
              })}
              <div class="chart-tooltip"></div>
            </div>`)}
          ${card('命令分布', '<span class="faint" style="font-size:11.5px">calls/s</span>', `
            <div class="a-bars">
              ${A.cmds.map((c, i) => `
                <div class="a-bar-row">
                  <span class="nm">${c.name}</span>
                  <span class="track"><i style="width:${c.pct}%;background:linear-gradient(90deg, ${['#8b7cff', '#c17bff', '#ff7eb6', '#60a5fa', '#4ade80', '#fbbf24'][i]}, rgba(255,255,255,.08))"></i></span>
                  <span class="vl">${fmt(c.calls)}</span>
                </div>`).join('')}
            </div>`)}
        </div>

        <div>
          ${card('智能提醒', '<span class="a-chip" style="background:rgba(251,191,36,.12);color:var(--amber)">3 条</span>', `
            <div class="a-insight warn"><span class="ic">${I('alert', 14)}</span><span class="txt">内存已用 <b>57%</b>，<code>allkeys-lru</code> 已驱逐 <b>18,402</b> 次</span><span class="go">调整→</span></div>
            <div class="a-insight warn"><span class="ic">${I('zap', 14)}</span><span class="txt">检测到慢命令 <code>KEYS *</code>，建议改用 <code>SCAN</code></span><span class="go">查看→</span></div>
            <div class="a-insight info"><span class="ic">${I('info', 14)}</span><span class="txt">db1 全部键均带 TTL，持久化恢复后可能为空</span><span class="go">详情→</span></div>`)}
          ${card('键空间', '74,897 keys', `
            ${A.dbs.map((d) => `
              <div class="a-db">
                <span class="db">db${d.db}</span>
                <span class="track"><i style="width:${d.pct}%"></i></span>
                <span class="num">${fmt(d.keys)}</span>
              </div>`).join('')}
            <div class="row" style="gap:16px;margin-top:14px;font-size:11px;color:var(--fg-3)">
              <span><i style="display:inline-block;width:8px;height:8px;border-radius:3px;background:var(--grad);margin-right:6px"></i>键数占比</span>
              <span class="grow"></span><span>总内存 3.42 GB</span>
            </div>`)}
        </div>
      </div>
    </div>`;
  }

  function sparkGrad(data, c1, c2, size) {
    const [min, max] = [Math.min.apply(null, data), Math.max.apply(null, data)];
    const w = 200, h = size || 34, n = data.length;
    const pts = data.map((v, i) => [1 + (i / (n - 1)) * (w - 2), h - 2 - ((v - min) / (max - min || 1)) * (h - 6)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const id = 'sg' + Math.random().toString(36).slice(2, 7);
    return `
    <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
        <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c2}" stop-opacity=".3"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></linearGradient>
      </defs>
      <path d="${d} L${w - 1} ${h - 1} L1 ${h - 1} Z" fill="url(#${id}f)"/>
      <path d="${d}" fill="none" stroke="url(#${id})" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="${pts[n - 1][0].toFixed(1)}" cy="${pts[n - 1][1].toFixed(1)}" r="2.2" fill="${c2}"/>
    </svg>`;
  }

  /* ------------------------------------------------------------ browser */
  function browser() {
    const groups = [
      ['user:', 11790, A.keys.filter((k) => k.k.startsWith('user:')).map((k) => [k.k.slice(5), k])],
      ['session:', 8008, A.keys.filter((k) => k.k.startsWith('session:')).map((k) => [k.k.slice(8), k])],
      ['cache:', 24109, A.keys.filter((k) => k.k.startsWith('cache:')).map((k) => [k.k.slice(6), k])],
    ];
    const rows = groups.map(([dir, more, keys]) => `
      <div class="a-krow dir"><span class="kk">▾ ${dir}*</span><span class="meta">${fmt(more)}</span></div>
      ${keys.map(([short, k]) => `
        <div class="a-krow ${k.k === 'user:1002' ? 'on' : ''}" data-krow>
          <span class="kk" style="padding-left:14px">${short}</span>
          <span class="meta">${k.ttl}<span class="ty" style="color:${TYPE_COLOR[k.t]};background:${TYPE_BG[k.t]}">${k.t}</span></span>
        </div>`).join('')}
      <div class="a-krow more"><span class="kk">… 另有 ${fmt(more)} 个键</span><span class="meta">继续 SCAN</span></div>
    `).join('') + A.keys.filter((k) => !/:/.test(k.k)).map((k) => `
      <div class="a-krow"><span class="kk">${k.k}</span><span class="meta">${k.ttl}<span class="ty" style="color:${TYPE_COLOR[k.t]};background:${TYPE_BG[k.t]}">${k.t}</span></span></div>`).join('');

    const h = A.hash;
    return `
    <div class="a-browser">
      <div class="a-b-area">
        <div class="a-b-head">
          <div class="a-searchbig">${I('search', 15)}<input placeholder="搜索键名，支持 glob：user:*" /><kbd class="faint" style="font-size:10px">⌘F</kbd></div>
          <button class="a-btn">${I('plus', 14)} 新建</button>
        </div>
        <div class="a-filters">
          <span class="a-chipf on">全部</span><span class="a-chipf">String</span><span class="a-chipf">Hash</span>
          <span class="a-chipf">List</span><span class="a-chipf">Set</span><span class="a-chipf">ZSet</span><span class="a-chipf">Stream</span>
        </div>
        <div class="a-keys keep-scroll">${rows}</div>
        <div class="a-keys-foot"><span>74,897 keys</span><span class="grow" style="flex:1"></span><span>cursor 10240 →</span></div>
      </div>

      <div class="a-value">
        <div class="a-v-head">
          <div class="a-v-title">
            <h2>${h.key}</h2>
            <span class="ty" style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:7px;color:${TYPE_COLOR[h.type]};background:${TYPE_BG[h.type]}">${h.type}</span>
            <span class="grow"></span>
            <button class="a-btn ghost" title="复制">${I('copy', 15)}</button>
            <button class="a-btn ghost" style="color:var(--red)">${I('trash', 15)}</button>
          </div>
          <div class="a-v-sub"><span>TTL <b>${h.ttl}</b></span><span>大小 <b>${h.bytes}</b></span><span>编码 <b>${h.encoding}</b></span></div>
        </div>
        <div class="a-v-tabs">
          <span class="a-vt on">${I('table', 14)} 字段 · ${h.fields.length}</span>
          <span class="a-vt">${I('code', 14)} 原始 RESP</span>
          <span class="a-vt">${I('history', 14)} 历史</span>
          <span class="grow"></span>
          <span class="a-vt">${I('download', 14)} 导出</span>
        </div>
        <div class="a-v-body keep-scroll">
          ${h.fields.map(([f, v], i) => `
            <div class="a-field">
              <span class="f">${f}</span>
              <span class="v ${i === 3 ? 'edited' : ''}">${v}</span>
              <span class="a"><span>编辑</span><span>删除</span></span>
            </div>`).join('')}
        </div>
        <div class="a-v-foot">
          <input class="f" placeholder="字段" />
          <input class="v" placeholder="值" />
          <button class="a-btn grad">${I('plus', 14)} 添加</button>
        </div>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- cli */
  function cli() {
    return `
    <div class="a-body" style="display:flex;flex-direction:column;overflow:hidden;padding:18px 26px 0">
      <div class="a-cli">
        <div class="a-cli-top">
          <div class="a-sess on"><span class="db">[0]</span> 10.20.1.10:6379</div>
          <div class="a-sess"><span class="db">[2]</span> 10.20.1.10:6379</div>
          <div class="a-sess" style="border-style:dashed">+ 新会话</div>
          <span class="grow" style="flex:1"></span>
          <span class="a-chip" style="background:rgba(74,222,128,.12)">${I('lock', 12)} 只读模式</span>
          <div class="a-seg"><button class="on">只读</button><button>可写</button></div>
        </div>
        <div class="a-term keep-scroll">
          <div class="cmd"><span class="p">10.20.1.10:6379<span class="db">[0]</span>&gt;</span> INFO keyspace</div>
          <div class="out"><span class="c"># Keyspace</span>
db0:keys=48201,expires=31204,avg_ttl=11520000
db1:keys=1204,expires=1204,avg_ttl=720000
db2:keys=24880,expires=24880,avg_ttl=1500000</div>
          <div class="cmd"><span class="p">10.20.1.10:6379<span class="db">[0]</span>&gt;</span> HGETALL user:1002</div>
          <div class="out">1) <span class="s">"id"</span>
2) <span class="s">"1002"</span>
3) <span class="s">"name"</span>
4) <span class="s">"Ada Lovelace"</span>
5) <span class="s">"email"</span>
6) <span class="s">"ada@example.com"</span>
<span class="c">… (4 more)</span></div>
          <div class="cmd"><span class="p">10.20.1.10:6379<span class="db">[0]</span>&gt;</span> TTL user:1002</div>
          <div class="out"><span class="n">(integer) 126000</span></div>
          <div class="cmd"><span class="p">10.20.1.10:6379<span class="db">[0]</span>&gt;</span> KEYS user:100*</div>
          <div class="out"><span class="e">(error) ERR KEYS 会导致阻塞，已被保护策略拦截，建议改用 SCAN</span></div>
          <div class="cmd"><span class="p">10.20.1.10:6379<span class="db">[0]</span>&gt;</span> SCAN 0 MATCH user:100* COUNT 3</div>
          <div class="out">1) <span class="s">"10240"</span>
2) 1) <span class="s">"user:1001"</span>
   2) <span class="s">"user:1002"</span>
   3) <span class="s">"user:1003"</span></div>
        </div>
        <div class="a-cli-input">
          <span class="p">10.20.1.10:6379<span class="db">[0]</span>&gt;</span>
          <input placeholder="输入命令，Tab 补全，↑↓ 翻历史" spellcheck="false" />
          <span class="faint" style="font-size:11.5px">↵ 执行</span>
        </div>
        <div class="a-cli-hints"><span><kbd>Tab</kbd> 补全：SCAN / SCARD / SCRIPT / SELECT / SET</span><span><kbd>⌘K</kbd> 清屏</span><span style="margin-left:auto">写命令已锁定，可在右上角解锁</span></div>
      </div>
    </div>`;
  }

  /* ------------------------------------------------------------ monitor */
  function monitor() {
    return monitorBody();
  }

  function bigStat(lab, fig, u, data, c1, c2) {
    return `
      <div class="a-stat big-kpi">
        <div class="lab">${lab}</div>
        <div class="big">${fig}<small>${u}</small></div>
        ${sparkGrad(data, c1, c2, 46)}
      </div>`;
  }

  function monitorBody() {
    const stat = (lab, fig, u, data, c1, c2) => `
      <div class="a-stat">
        <div class="lab">${lab}</div>
        <div class="big">${fig}<small>${u}</small></div>
        ${sparkGrad(data, c1, c2)}
      </div>`;
    return `
    <div class="a-body">
      <div class="a-hello monitor-hello" style="display:flex;align-items:flex-end;gap:16px;margin-bottom:20px">
        <div class="grow">
          <h1>实时监控</h1>
          <p>Prod · Order Svc · 每 1 秒采样 · <span class="a-chip">● LIVE</span></p>
        </div>
        <div class="a-seg"><button>1m</button><button class="on">5m</button><button>1h</button><button>6h</button></div>
        <button class="a-btn">${I('download', 14)} 导出</button>
      </div>

      <div class="a-mon-wrap">
      <div class="a-mon">
        ${card('命令吞吐', '<span class="a-chip">ops/s</span>', `
          <div class="a-chart" data-chart-root>
            ${lineChart({
              w: 640, h: 190, yFormat: (v) => (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : Math.round(v)),
              xLabels: ['-5m', '-4m', '-3m', '-2m', '-1m', 'now'], min: 0,
              series: [{ values: D.monitor.ops, color: '#8b7cff', label: 'ops/s' }],
            })}
            <div class="chart-tooltip"></div>
          </div>`, 'a-8')}

        ${card('关键指标', '', `
          <div class="a-mon-bigkpi" style="grid-template-columns:1fr">
            ${bigStat('QPS', '12.4', 'k', D.monitor.ops, '#8b7cff', '#c17bff')}
            ${bigStat('P99 延迟', '1.40', 'ms', D.monitor.latencyP99, '#60a5fa', '#8b7cff')}
          </div>`, 'a-4')}

        ${card('内存与网络', '<div class="row" style="gap:14px;font-size:11px;color:var(--fg-3)"><span>内存</span><span>入站</span><span>出站</span></div>', `
          <div class="a-chart" data-chart-root>
            ${lineChart({
              w: 900, h: 160, yTicks: 3, yFormat: (v) => Math.round(v), min: 0,
              xLabels: ['-5m', '-4m', '-3m', '-2m', '-1m', 'now'],
              series: [
                { values: D.monitor.memory, color: '#ff7eb6', label: '内存 MB' },
                { values: D.monitor.netIn, color: '#60a5fa', label: '入站 MB/s' },
                { values: D.monitor.netOut, color: '#4ade80', label: '出站 MB/s' },
              ],
            })}
            <div class="chart-tooltip"></div>
          </div>`, 'a-8')}

        ${card('主从拓扑', '<span class="a-chip">健康</span>', `
          <div class="a-topo">
            <div class="a-node"><span class="dot"></span><span class="role">Master</span><span class="addr">10.20.1.10:6379</span><span class="grow"></span><span class="faint" style="font-size:10.5px">0-16383</span></div>
            <div class="a-kids">
              ${A.topo.replicas.map(([addr, lag]) => `
                <div class="a-node rep"><span class="dot"></span><span class="role">Replica</span><span class="addr">${addr}</span><span class="grow"></span><span class="faint" style="font-size:10.5px">${lag}</span></div>`).join('')}
            </div>
            <div class="faint" style="font-size:11px;margin-top:2px">Sentinel · ${A.topo.sentinels.join(' · ')}</div>
          </div>`, 'a-4')}

        ${card('慢查询', '<span class="faint" style="font-size:11px">阈值 3 ms</span>', `
          <table class="a-tbl">
            <thead><tr><th>时间</th><th class="num">耗时</th><th>命令</th></tr></thead>
            <tbody>${A.slow.map(([id, t, ms, cmd]) => `
              <tr><td class="muted">${t}</td><td class="num" style="color:${Number(ms) > 8 ? 'var(--red)' : 'var(--amber)'}">${ms} ms</td><td class="key">${cmd}</td></tr>`).join('')}
            </tbody>
          </table>`, 'a-6')}

        ${card('客户端', '<span class="faint" style="font-size:11px">318 个</span>', `
          <table class="a-tbl">
            <thead><tr><th>地址</th><th>名称</th><th class="num">DB</th><th>命令</th></tr></thead>
            <tbody>${A.clients.map(([addr, name, age, idle, db, cmd]) => `
              <tr><td class="key">${addr}</td><td>${name}</td><td class="num">${db}</td><td class="key">${cmd}</td></tr>`).join('')}
            </tbody>
          </table>`, 'a-6')}
      </div>
      </div>
    </div>`;
  }

  /* -------------------------------------------------------- connections */
  function connections() {
    const c = A.connections.find((x) => x.id === 'cache');
    const f = (label, input, wide, hint) => `<div class="a-f ${wide ? 'wide' : ''}"><label>${label}</label>${input}${hint ? `<span class="h">${hint}</span>` : ''}</div>`;
    return `
    <div class="a-body">
      <div class="a-hello" style="display:flex;align-items:flex-end;gap:16px">
        <div class="grow"><h1>${c.name}</h1><p>${c.host}:${c.port} · ${c.mode} · TLS · db${c.db}</p></div>
        <button class="a-btn">${I('external', 14)} 在此连接上打开</button>
        <button class="a-btn grad">${I('plus', 14)} 新建连接</button>
      </div>

      <div class="a-form">
        <div>
          <div class="a-test">
            <span class="ic">${I('check', 15)}</span>
            <div class="info"><span>连接成功 · <b>0.6 ms</b></span><span>版本 <b>7.2.4</b></span><span>模式 <b>sentinel</b></span><span>数据库 <b>16</b></span></div>
            <span class="grow" style="flex:1"></span>
            <button class="a-btn ghost">重新测试</button>
          </div>

          <div class="a-fsec">
            <h3>基本信息</h3>
            <div class="a-fgrid">
              ${f('连接名称', `<input value="${c.name}" />`, true)}
              ${f('分组', `<input value="Production" />`)}
              ${f('数据库', `<select><option>db0</option><option>db1</option><option selected>db2</option></select>`)}
              ${f('主机', `<input class="mono" value="${c.host}" />`)}
              ${f('端口', `<input class="mono" value="${c.port}" />`)}
              ${f('部署模式', `<div class="a-seg" style="align-self:flex-start"><button>Standalone</button><button class="on">Sentinel</button><button>Cluster</button></div>`, true)}
              ${f('哨兵 / 种子节点', `<input class="mono" value="10.20.1.20:26379, 10.20.1.21:26379" />`, true)}
            </div>
          </div>

          <div class="a-fsec">
            <h3>认证</h3>
            <div class="a-fgrid">
              ${f('方式', `<div class="a-seg" style="align-self:flex-start"><button class="on">密码</button><button>ACL</button><button>无认证</button></div>`, true)}
              ${f('密码', `<input type="password" value="S3cr3t-pa55w0rd" />`, true)}
              <div class="a-f wide" style="flex-direction:row;align-items:center;gap:10px"><span class="a-switch on"></span><span style="font-size:12.5px">保存到系统钥匙串</span></div>
            </div>
          </div>

          <div class="a-fsec">
            <h3>加密与隧道</h3>
            <div class="a-fgrid">
              <div class="a-f" style="flex-direction:row;align-items:center;gap:10px"><span class="a-switch on"></span><span style="font-size:12.5px">启用 TLS</span></div><div class="a-f"></div>
              ${f('CA 证书', `<input class="mono" value="~/.redis/ca.pem" />`)}
              ${f('客户端证书', `<input class="mono" value="~/.redis/client.pem" />`)}
              <div class="a-f" style="flex-direction:row;align-items:center;gap:10px"><span class="a-switch"></span><span style="font-size:12.5px">通过 SSH 隧道</span></div><div class="a-f"></div>
            </div>
          </div>

          <div class="row" style="gap:10px;margin-top:18px">
            <button class="a-btn ghost" style="color:var(--red)">删除连接</button>
            <span class="grow"></span>
            <button class="a-btn ghost">取消</button>
            <button class="a-btn">测试连接</button>
            <button class="a-btn grad">${I('save', 14)} 保存</button>
          </div>
        </div>

        <aside class="a-aside">
          <div class="a-preview">
            <h3>连接串</h3>
            <p>复制给同事或在 CLI 中使用</p>
            <div class="a-dsn">redis://<b>****</b>@${c.host}:${c.port}/2?tls=true</div>
            <button class="a-btn" style="width:100%;justify-content:center">${I('copy', 14)} 复制</button>
          </div>
          ${card('连接详情', '', `
            <div class="a-facts">
              <div class="a-fact"><span class="k">模式</span><span class="v">${c.mode}</span></div>
              <div class="a-fact"><span class="k">TLS</span><span class="v">启用</span></div>
              <div class="a-fact"><span class="k">上次使用</span><span class="v">今天 14:02</span></div>
              <div class="a-fact"><span class="k">连接次数</span><span class="v">12</span></div>
              <div class="a-fact"><span class="k">平均延迟</span><span class="v">0.7 ms</span></div>
            </div>`)}
        </aside>
      </div>
    </div>`;
  }

  /* ----------------------------------------------------------- settings */
  function settings() {
    const row = (lab, help, ctl) => `
      <div class="a-setrow"><div><div class="lab">${lab}</div><div class="hlp">${help}</div></div><div class="ctl">${ctl}</div></div>`;
    const sw = (on) => `<span class="a-switch ${on ? 'on' : ''}"></span>`;
    return `
    <div class="a-body">
      <div class="a-hello"><h1>设置</h1><p>外观、数据与安全偏好</p></div>
      <div class="a-set">
        ${card('外观', '', `${row('主题', '跟随系统 / 深色 / 浅色', `<div class="a-seg"><button>跟随系统</button><button class="on">深色</button><button>浅色</button></div>`)}
          ${row('行高与密度', '列表与表格的紧凑程度', `<div class="a-seg"><button>紧凑</button><button class="on">标准</button><button>宽松</button></div>`)}
          ${row('键名前缀分组', 'user:1002 自动归入 user:* 目录', sw(true))}`)}
        ${card('数据与连接', '', `${row('SCAN 每批数量', '默认 500，过大可能阻塞服务端', `<input style="width:96px;height:32px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.05);padding:0 10px;font-family:var(--font-mono)" value="500" />`)}
          ${row('单次最多载入键', '超出后提示继续 SCAN', `<input style="width:96px;height:32px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.05);padding:0 10px;font-family:var(--font-mono)" value="5000" />`)}
          ${row('危险命令二次确认', 'FLUSHALL / KEYS / CONFIG SET', sw(true))}
          ${row('凭据存储', '密码不写入明文配置', `<div class="a-seg"><button class="on">系统钥匙串</button><button>每次询问</button></div>`)}`)}
        ${card('安全', '', `${row('默认只读', '写命令需显式解锁', sw(true))}
          ${row('拦截阻塞型命令', 'KEYS / FLUSHALL 自动拦截', sw(true))}
          ${row('锁定快捷键', '离开时立即锁定应用', `<span class="a-seg"><button class="on">⌘⇧L</button><button>不锁定</button></span>`)}`)}
        ${card('关于', '', `${row('版本', 'prototype · Go 1.27 · MyGo 0.7', '<span class="faint" style="font-family:var(--font-mono);font-size:12px">0.1.0</span>')}`)}
      </div>
    </div>`;
  }

  /* ----------------------------------------------------------- overlays */
  function palette() {
    const items = [
      ['terminal', '执行 CLI 命令', '命令', '⌘T', true],
      ['activity', '打开 Prod · Order Svc 总览', '连接', '↵', false],
      ['key', 'user:1002', '键 · HASH', '查看', false],
      ['key', 'session:a91f2c', '键 · STRING', '查看', false],
      ['gauge', '查看慢查询日志', '监控', '', false],
      ['lock', '锁定应用', '安全', '⌘⇧L', false],
      ['sliders', '打开设置', '偏好', '⌘,', false],
    ];
    return `
    <div class="a-overlay" data-action="close-palette">
      <div class="a-palette">
        <div class="a-pal-input">${I('search', 18)}<input placeholder="搜索键、命令或设置…" autofocus /><span class="faint" style="font-size:11px">Esc</span></div>
        <div class="a-pal-list">
          <div class="a-pal-sec">操作</div>
          ${items.map(([ic, t, kind, k, sel], i) => `
            <div class="a-pal-item ${sel ? 'sel' : ''}">
              <span class="ic">${I(ic, 14)}</span><span class="t">${t}</span>
              <span class="faint" style="font-size:11px">${kind}</span>${k ? `<kbd>${k}</kbd>` : ''}
            </div>`).join('')}
        </div>
        <div class="a-pal-foot"><span>↑↓ 选择</span><span>↵ 打开</span><span>Esc 关闭</span><span class="grow" style="flex:1"></span><span>支持跨连接模糊搜索</span></div>
      </div>
    </div>`;
  }

  /* -------------------------------------------------------------- shell */
  function renderBase() {
    const w = document.createElement('div');
    const map = { overview, browser, cli, monitor, connections, settings };
    const fn = map[S.page] || overview;
    const isFull = S.page === 'browser' || S.page === 'cli';
    root.innerHTML = `
    <div class="a-desk">
      <div class="a-window">
        ${sidebar()}
        <div class="a-main">
          ${topbar()}
          <div style="${isFull ? 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden' : 'flex:1;min-height:0;overflow:auto'}">
            ${fn()}
          </div>
          ${statusbar()}
        </div>
      </div>
    </div>
    ${S.palette ? palette() : ''}`;
  }

  const origLine = window.lineChart;
  let queue = [];
  window.lineChart = function (o) { queue.push(o); return origLine(o); };
  function render() {
    queue = [];
    renderBase();
    document.querySelectorAll('[data-chart-root]').forEach((el, i) => {
      if (queue[i]) attachChartHover(el, queue[i]);
    });
  }

  document.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-action]');
    if (act) {
      const a = act.dataset.action;
      if (a === 'palette') { S.palette = true; render(); }
      else if (a === 'close-palette' && ev.target === act) { S.palette = false; render(); }
      return;
    }
    const tab = ev.target.closest('[data-tab]');
    if (tab) { S.page = tab.dataset.tab; S.palette = false; render(); return; }
    const connEl = ev.target.closest('[data-conn]');
    if (connEl) { document.querySelectorAll('.a-conn').forEach((n) => n.classList.toggle('on', n === connEl)); return; }
    const seg = ev.target.closest('.a-seg button');
    if (seg) { seg.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === seg)); return; }
    const chip = ev.target.closest('.a-chipf');
    if (chip) { chip.parentElement.querySelectorAll('.a-chipf').forEach((n) => n.classList.toggle('on', n === chip)); return; }
    const sw = ev.target.closest('.a-switch');
    if (sw) { sw.classList.toggle('on'); return; }
    const vt = ev.target.closest('.a-vt');
    if (vt && !vt.querySelector('svg[width="14"]')) { vt.parentElement.querySelectorAll('.a-vt').forEach((n) => n.classList.toggle('on', n === vt)); return; }
    const kr = ev.target.closest('[data-krow]');
    if (kr) { document.querySelectorAll('[data-krow]').forEach((n) => n.classList.toggle('on', n === kr)); return; }
    const pal = ev.target.closest('.a-pal-item');
    if (pal) { document.querySelectorAll('.a-pal-item').forEach((n) => n.classList.toggle('sel', n === pal)); }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && S.palette) { S.palette = false; render(); }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); S.palette = !S.palette; render(); }
  });

  const q = new URLSearchParams(location.search);
  if (q.get('page')) S.page = q.get('page');
  if (q.get('palette')) S.palette = true;
  render();
})();
