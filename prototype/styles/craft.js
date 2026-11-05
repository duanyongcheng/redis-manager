/* B · Craft 雅致工具风 */
(function () {
  const D = window.DATA, A = window.APP, I = window.icon;
  const fmt = A.fmt;
  const root = document.getElementById('root');
  const S = { page: 'overview', theme: 'light' };

  const PAGE_META = {
    overview: { eyebrow: 'Overview', title: '总览', idx: '概览' },
    browser: { eyebrow: 'Keyspace', title: '键浏览', idx: '键' },
    cli: { eyebrow: 'Console', title: 'CLI', idx: 'CLI' },
    monitor: { eyebrow: 'Monitor', title: '监控', idx: '监控' },
    connections: { eyebrow: 'Connections', title: '连接', idx: '连接' },
    settings: { eyebrow: 'Preferences', title: '设置', idx: '设置' },
  };

  const NAV = [
    ['overview', 'activity', '总览'],
    ['browser', 'key', '键'],
    ['cli', 'terminal', 'CLI'],
    ['monitor', 'gauge', '监控'],
    ['connections', 'plug', '连接'],
  ];

  function conn() { return A.connections.find((c) => c.id === 'order'); }

  /* -------------------------------------------------------------- shell */
  function topbar() {
    return `
    <header class="c-top">
      <div class="c-lights"><i></i><i></i><i></i></div>
      <div class="c-logo">Redis<em>·</em>Manager</div>
      <div class="c-conns">
        ${A.connections.map((c) => `
          <div class="c-conn-pill ${c.id === 'order' ? 'on' : ''}" data-conn="${c.id}">
            <span class="dot ${c.status}"></span>${c.name}
          </div>`).join('')}
        <div class="c-conn-pill" style="color:var(--ink-3)">${I('plus', 13)}</div>
      </div>
      <div class="c-top-right">
        <div class="c-search">${I('search', 13)}<input placeholder="搜索键、命令…" /><kbd>⌘K</kbd></div>
        <button class="c-btn ghost" data-action="theme" title="切换主题">${I(S.theme === 'light' ? 'moon' : 'sun', 14)}</button>
        <button class="c-btn ghost">${I('settings', 14)}</button>
      </div>
    </header>`;
  }

  function rail(page) {
    return `
    <nav class="c-rail">
      ${NAV.map(([id, ic, label]) => `<div class="c-nav ${id === page ? 'on' : ''}" data-tab="${id}">${I(ic, 17)}<span>${label}</span></div>`).join('')}
      <div class="grow"></div>
      <div class="c-nav ${page === 'settings' ? 'on' : ''}" data-tab="settings">${I('sliders', 17)}<span>偏好</span></div>
    </nav>`;
  }

  function index(page) {
    const bodies = {
      overview: overviewIndex,
      browser: browserIndex,
      cli: cliIndex,
      monitor: monitorIndex,
      connections: connectionsIndex,
      settings: settingsIndex,
    };
    const meta = PAGE_META[page];
    return `
    <aside class="c-index">
      <div class="c-index-head">
        <div class="c-eyebrow">${meta.eyebrow}</div>
        <div class="c-title">${meta.title}</div>
      </div>
      <div class="c-index-body keep-scroll">${(bodies[page] || overviewIndex)()}</div>
    </aside>`;
  }

  function group(label, right) {
    return `<div class="c-group"><span>${label}</span><span class="grow"></span>${right || ''}</div>`;
  }

  function item(key, meta, cls, attr) {
    return `<div class="c-item ${cls || ''}" ${attr || ''}><span class="k">${key}</span><span class="m">${meta || ''}</span></div>`;
  }

  /* ------------------------------------------------------------- indexes */
  function overviewIndex() {
    return `
      ${group('实例')}
      ${item('服务器信息', 'INFO')}
      ${item('性能监控', '5m')}
      ${item('客户端', '318')}
      ${item('慢查询', '4')}
      ${group('数据')}
      ${item('键空间', '74,897')}
      ${item('持久化', 'RDB')}
      ${group('诊断')}
      ${item('主从拓扑', '健康')}
      ${item('告警建议', '3')}`;
  }

  function browserIndex() {
    const list = A.keys.filter((k) => /^user:/.test(k.k));
    return `
      <div class="c-input" style="margin:0 4px 10px">${I('search', 13)}<input placeholder="过滤键名…" /></div>
      <div class="c-filters" style="padding:0 4px 8px">
        <span class="c-chip on">全部</span><span class="c-chip">String</span><span class="c-chip">Hash</span><span class="c-chip">ZSet</span>
      </div>
      ${group('user:', `${fmt(12480)} 键`)}
      ${list.map((k) => item(k.k.replace('user:', ''), k.ttl, k.k === 'user:1002' ? 'on' : '', 'data-key')).join('')}
      ${`<div class="c-item faint" style="padding-left:18px">… 另有 11,790 个键</div>`}
      ${group('session:', '8,321 键')}
      ${item('a91f2c', '29m')}${item('b70e4d', '29m')}${item('c33a1e', '28m')}
      ${group('cache:', '24,109 键')}
      ${item('home:feed', '1m 10s')}${item('product:88', '58s')}
      ${group('其他', '直接键')}
      ${item('leaderboard', 'zset')}${item('tags:hot', 'set')}${item('events:stream', 'stream')}`;
  }

  function cliIndex() {
    return `
      ${group('会话', '+ 新建')}
      ${item('[0] 10.20.1.10:6379', '活跃', 'on')}
      ${item('[2] 10.20.1.10:6379', '只读')}
      ${group('历史', '清空')}
      ${['INFO keyspace', 'HGETALL user:1002', 'TTL user:1002', 'KEYS user:100*', 'SCAN 0 MATCH user:100* COUNT 3']
        .map((c) => `<div class="c-item" style="padding-left:18px"><span class="k" style="font-size:11.5px">${c}</span></div>`).join('')}
      ${group('常用')}
      ${item('SCAN / SCARD', '遍历')}
      ${item('HGETALL / HSET', '哈希')}
      ${item('ZRANGE / ZADD', '有序集合')}
      ${group('安全')}
      ${item('只读保护', '开启', '')}
      ${item('阻塞命令拦截', '开启', '')}`;
  }

  function monitorIndex() {
    return `
      ${group('时间范围')}
      ${item('最近 1 分钟', '')}
      ${item('最近 5 分钟', '当前', 'on')}
      ${item('最近 1 小时', '')}
      ${item('最近 6 小时', '')}
      ${group('指标')}
      ${item('吞吐 ops/s', '')}
      ${item('延迟 P99', '1.4ms')}
      ${item('内存 / 网络', '')}
      ${item('命中率', '98.7%')}
      ${group('事件')}
      ${item('慢查询日志', '4')}
      ${item('客户端列表', '318')}
      ${item('主从复制', '健康')}`;
  }

  function connectionsIndex() {
    const groups = ['Production', 'Staging', 'Local'];
    return `
      <div class="c-input" style="margin:0 4px 10px">${I('search', 13)}<input placeholder="搜索连接…" /></div>
      ${groups.map((g) => `
        ${group(g, `${A.connections.filter((c) => c.group === g).length}`)}
        ${A.connections.filter((c) => c.group === g).map((c) => item(c.name, c.mode.toLowerCase(), c.id === 'cache' ? 'on' : '', `data-conn="${c.id}"`)).join('')}
      `).join('')}`;
  }

  function settingsIndex() {
    return `
      ${group('主题')}
      ${item('浅色 · 暖纸', '当前', 'on')}
      ${item('深色 · 墨绿', '')}
      ${group('跳转')}
      ${item('数据与连接', '↓')}
      ${item('CLI 控制台', '↓')}
      ${item('安全', '↓')}
      ${item('关于', '↓')}`;
  }

  /* ------------------------------------------------------------ detail -- */
  function detailHead(page, title, sub, actions) {
    return `
    <div class="c-detail-head">
      <h1>${title}</h1>
      ${sub ? `<span class="sub">${sub}</span>` : ''}
      <div class="actions">${actions || ''}</div>
    </div>`;
  }

  function sec(title, meta, body) {
    return `
    <section class="c-sec">
      <div class="c-sec-head"><h2 class="serif">${title}</h2><span class="grow"></span><span class="meta">${meta || ''}</span></div>
      ${body}
    </section>`;
  }

  /* ---------------------------------------------------------- overview -- */
  function overview() {
    const c = conn();
    const letters = [
      { lab: 'QPS 吞吐', fig: '12,442', u: 'ops/s', note: '较上一小时 ▲ 4.2%', data: D.overview.ops, color: 'var(--terracotta)' },
      { lab: '连接客户端', fig: '318', u: '个', note: '阻塞 0 · 峰值 412', data: D.monitor.clients, color: 'var(--sky)' },
      { lab: '内存占用', fig: '3.42', u: 'GB', note: '上限 6 GB · 57%', data: D.monitor.memory, color: 'var(--clay)' },
      { lab: '平均延迟', fig: '0.82', u: 'ms', note: 'P99 1.4 ms', data: D.monitor.latencyP99, color: 'var(--sage)' },
    ];
    return {
      head: detailHead('overview', c.name, `${c.host}:${c.port} · db${c.db} · ${c.mode}`,
        `<span class="c-pill" style="color:var(--sage)">● 连接正常</span>
         <button class="c-btn ghost" data-tab="browser">浏览键</button>
         <button class="c-btn ghost" data-tab="cli">CLI</button>
         <button class="c-btn" data-action="refresh">${I('refresh', 13)} 刷新</button>`),
      body: `
        <div class="c-letters">
          ${letters.map((l) => `
            <div class="c-letter">
              <div class="lab">${l.lab}</div>
              <div class="fig">${l.fig}<small>${l.u}</small></div>
              ${spark(l.data, { w: 180, h: 28, color: l.color })}
              <div class="note">${l.note}</div>
            </div>`).join('')}
        </div>

        <div class="c-cols">
          <div>
            ${sec('吞吐与延迟', `<div class="c-legend"><span><i style="background:var(--terracotta)"></i>ops/s</span><span><i style="background:var(--sky)"></i>hits/s</span></div>`, `
              <div class="c-chart" data-chart-root>
                ${lineChart({
                  w: 620, h: 190, yFormat: (v) => (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v),
                  xLabels: ['-60s', '-45s', '-30s', '-15s', '-5s', 'now'], min: 0,
                  series: [
                    { values: D.overview.ops, color: 'var(--terracotta)', label: 'ops/s' },
                    { values: D.monitor.ops.map((v, i) => v * 0.78 + (D.overview.ops[i] - D.monitor.ops[i]) * 0.3), color: 'var(--sky)', label: 'hits/s' },
                  ],
                })}
                <div class="chart-tooltip"></div>
              </div>`)}

            ${sec('热门命令', 'calls/s', `
              <div class="c-bars">
                ${A.cmds.map((cm) => `
                  <div class="c-bar-row">
                    <span class="nm">${cm.name}</span>
                    <span class="track"><i style="width:${cm.pct}%;background:var(--sage)"></i></span>
                    <span class="vl">${fmt(cm.calls)}</span>
                  </div>`).join('')}
              </div>`)}

            ${sec('键空间', '74,897 keys', `
              <table class="c-table">
                <thead><tr><th>Database</th><th>占比</th><th class="num">键</th><th class="num">内存</th><th class="num">过期</th></tr></thead>
                <tbody>
                  ${A.dbs.map((d) => `
                    <tr>
                      <td class="key">db${d.db}</td>
                      <td><span style="display:block;height:6px;border-radius:4px;background:var(--line-soft)"><i style="display:block;height:6px;border-radius:4px;width:${d.pct}%;background:var(--sage)"></i></span></td>
                      <td class="num">${fmt(d.keys)}</td>
                      <td class="num">${d.bytes}</td>
                      <td class="num">${d.ew}%</td>
                    </tr>`).join('')}
                </tbody>
              </table>`)}
          </div>

          <div>
            ${sec('值得注意', '3 条', `
              <div class="c-note"><span class="badge warn">!</span><span class="txt">内存已用 <b>57%</b>，驱逐策略 <code>allkeys-lru</code> 已生效，累计驱逐 <b>18,402</b> 次</span></div>
              <div class="c-note"><span class="badge warn">!</span><span class="txt">发现慢命令 <code>KEYS *</code> 耗时 <b>8.81 ms</b>，建议改用 <code>SCAN</code></span></div>
              <div class="c-note"><span class="badge info">i</span><span class="txt">db1 中所有键都带 TTL，若依赖持久化恢复可能丢数据</span></div>`)}

            ${sec('最近操作', '本连接', `
              <div class="c-timeline">
                ${A.history.slice(0, 4).map((h) => `
                  <div class="c-tl-item">
                    <div class="c-tl-head"><span class="who">${h.by}</span><span class="when">${h.ago}</span></div>
                    <div class="c-tl-body"><span class="op">${h.op}</span><code>${h.what}</code> · ${h.detail}</div>
                  </div>`).join('')}
              </div>`)}

            ${sec('服务器', 'INFO', `
              <div class="c-facts">
                ${A.info.slice(0, 7).map(([k, v]) => `<div class="c-fact"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}
              </div>`)}
          </div>
        </div>`,
    };
  }

  /* ----------------------------------------------------------- browser -- */
  function browser() {
    const h = A.hash;
    return {
      head: detailHead('browser', '键浏览', 'Prod · Order Svc · db0 · 74,897 keys',
        `<span class="c-pill">命中率 98.7%</span>
         <button class="c-btn ghost">${I('plus', 13)} 新建键</button>
         <button class="c-btn ghost">${I('download', 13)} 导出</button>`),
      body: `
      <div class="c-split">
        <div class="c-keys">
          <div class="c-keys-head">
            <div class="c-eyebrow" style="padding:0 4px">当前数据库 · db0</div>
            <div class="c-input">${I('search', 13)}<input placeholder="过滤键名…" /></div>
            <div class="c-filters">
              <span class="c-chip on">全部</span><span class="c-chip">String</span><span class="c-chip">Hash</span>
              <span class="c-chip">List</span><span class="c-chip">Set</span><span class="c-chip">ZSet</span><span class="c-chip">Stream</span>
            </div>
          </div>
          <div class="c-keys-body keep-scroll">
            <div class="c-krow dir"><span class="k">user:</span><span class="m">12,480</span></div>
            ${A.keys.filter((k) => /^user:/.test(k.k)).map((k) => `
              <div class="c-krow ${k.k === 'user:1002' ? 'on' : ''}" data-krow>
                <span class="k" style="padding-left:10px">${k.k.slice(5)}</span><span class="m">${k.ttl}</span>
              </div>`).join('')}
            <div class="c-krow more">… 另有 11,790 个键</div>
            <div class="c-krow dir"><span class="k">session:</span><span class="m">8,321</span></div>
            ${A.keys.filter((k) => /^session:/.test(k.k)).map((k) => `
              <div class="c-krow" data-krow><span class="k" style="padding-left:10px">${k.k.slice(8)}</span><span class="m">${k.ttl}</span></div>`).join('')}
            <div class="c-krow more">… 另有 8,008 个键</div>
            <div class="c-krow dir"><span class="k">cache:</span><span class="m">24,109</span></div>
            ${A.keys.filter((k) => /^cache:/.test(k.k)).map((k) => `
              <div class="c-krow" data-krow><span class="k" style="padding-left:10px">${k.k.slice(6)}</span><span class="m">${k.ttl}</span></div>`).join('')}
          </div>
          <div class="c-keys-foot"><span>74,897 keys</span><span class="grow"></span><span>cursor 10240 →</span></div>
        </div>

        <div class="c-value">
          <div class="c-value-head">
            <span class="c-type ${h.type}">${h.type}</span>
            <h1 class="serif">${h.key}</h1>
            <div class="meta"><span>TTL <b>${h.ttl}</b></span><span>大小 <b>${h.bytes}</b></span><span>编码 <b>${h.encoding}</b></span></div>
            <span class="grow"></span>
            <button class="c-btn ghost" title="复制">${I('copy', 14)}</button>
            <button class="c-btn danger">${I('trash', 13)} 删除</button>
          </div>
          <div class="c-value-tabs">
            <span class="on">字段 · 10</span><span>原始 RESP</span><span>历史 · 6</span><span style="margin-left:auto">导出</span>
          </div>
          <div class="c-value-body keep-scroll">
            ${h.fields.map(([f, v], i) => `
              <div class="c-field">
                <span class="f">${f}</span>
                <span class="v ${i === 3 ? 'edited' : ''}">${v}</span>
                <span class="a"><span>编辑</span><span>删除</span></span>
              </div>`).join('')}
          </div>
          <div class="c-value-foot">
            <input class="f" placeholder="字段" />
            <input class="v" placeholder="值" />
            <button class="c-btn primary">${I('plus', 13)} 添加 / 更新</button>
            <span class="c-save-hint">1 处未保存 · ⌘S 保存</span>
          </div>
        </div>
      </div>`,
    };
  }

  /* --------------------------------------------------------------- cli -- */
  function cli() {
    const c = conn();
    return {
      head: detailHead('cli', 'CLI 控制台', `${c.host}:${c.port}`,
        `<div class="c-seg"><button class="on">只读</button><button>可写</button></div>
         <button class="c-btn ghost">${I('keyboard', 14)} 命令文档</button>`),
      body: `
      <div class="c-cli">
        <div class="c-cli-sessions">
          <div class="c-sess on"><span class="db">[0]</span> 10.20.1.10:6379</div>
          <div class="c-sess"><span class="db">[2]</span> 10.20.1.10:6379</div>
          <div class="c-sess" style="border-style:dashed">+ 新会话</div>
        </div>
        <div class="c-term keep-scroll">
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
          <div class="out"><span class="e">(error) ERR KEYS 会导致阻塞，已被保护策略拦截，建议：</span>
<span class="e">  SCAN 0 MATCH user:100* COUNT 1000</span></div>
          <div class="cmd"><span class="p">10.20.1.10:6379<span class="db">[0]</span>&gt;</span> SCAN 0 MATCH user:100* COUNT 3</div>
          <div class="out">1) <span class="s">"10240"</span>
2) 1) <span class="s">"user:1001"</span>
   2) <span class="s">"user:1002"</span>
   3) <span class="s">"user:1003"</span></div>
        </div>
        <div class="c-cli-input">
          <span class="p">10.20.1.10:6379<span style="color:var(--terracotta)">[0]</span>&gt;</span>
          <input placeholder="输入命令，Tab 补全，↑↓ 翻历史" spellcheck="false" />
          <button class="c-btn primary">执行 ⏎</button>
        </div>
        <div class="c-cli-hints"><span><kbd>Tab</kbd> 补全 SCAN / SCARD / SCRIPT / SELECT / SET</span><span><kbd>⌘K</kbd> 清屏</span><span style="margin-left:auto">只读模式：写命令已锁定</span></div>
      </div>`,
    };
  }

  /* ----------------------------------------------------------- monitor -- */
  function monitor() {
    const c = conn();
    const stat = (lab, fig, u, data, color) => `
      <div class="c-stat">
        <div class="lab">${lab}</div>
        <div class="fig">${fig}<small>${u}</small></div>
        ${spark(data, { w: 150, h: 22, color })}
      </div>`;
    return {
      head: detailHead('monitor', '监控', c.name,
        `<span class="c-pill" style="color:var(--sage)">● 实时</span>
         <div class="c-seg"><button>1m</button><button class="on">5m</button><button>1h</button><button>6h</button></div>`),
      body: `
      <div class="c-mon-wrap">
      <div class="c-mon">
        <div class="c-m12">
          ${sec('吞吐', '最近 5 分钟 · 1s 采样', `
            <div class="c-chart" data-chart-root>
              ${lineChart({
                w: 900, h: 200, yFormat: (v) => (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : Math.round(v)),
                xLabels: ['-5m', '-4m', '-3m', '-2m', '-1m', 'now'], min: 0,
                series: [{ values: D.monitor.ops, color: 'var(--terracotta)', label: 'ops/s', fill: true }],
              })}
              <div class="chart-tooltip"></div>
            </div>`)}
        </div>

        <div class="c-m4">
          ${sec('关键指标', '', `
            <div class="c-statrow">
              ${stat('QPS', '12.4', 'k', D.monitor.ops, 'var(--terracotta)')}
              ${stat('P99', '1.40', 'ms', D.monitor.latencyP99, 'var(--sky)')}
              ${stat('连接数', '318', '个', D.monitor.clients, 'var(--sage)')}
              ${stat('内存', '3,498', 'MB', D.monitor.memory, 'var(--clay)')}
            </div>`)}
        </div>

        <div class="c-m8">
          ${sec('内存与网络', 'MB · MB/s', `
            <div class="c-chart">
              ${lineChart({
                w: 620, h: 150, yTicks: 3, yFormat: (v) => Math.round(v), min: 0,
                xLabels: ['-5m', '-4m', '-3m', '-2m', '-1m', 'now'],
                series: [
                  { values: D.monitor.memory, color: 'var(--clay)', label: '内存' },
                  { values: D.monitor.netIn, color: 'var(--sky)', label: '入站' },
                  { values: D.monitor.netOut, color: 'var(--sage)', label: '出站' },
                ],
              })}
              <div class="chart-tooltip"></div>
            </div>
            <div class="c-legend" style="margin-top:10px"><span><i style="background:var(--clay)"></i>内存 MB</span><span><i style="background:var(--sky)"></i>入站</span><span><i style="background:var(--sage)"></i>出站</span></div>`)}
        </div>

        <div class="c-m4">
          ${sec('主从拓扑', '健康', `
            <div class="c-topo">
              <div class="c-node"><span class="dot"></span><span class="role">Master</span><span class="addr">${A.topo.master}</span><span class="grow"></span><span class="c-pill">slots 0-16383</span></div>
              <div class="c-node-kids">
                ${A.topo.replicas.map(([addr, lag]) => `
                  <div class="c-node"><span class="dot"></span><span class="role">Replica</span><span class="addr">${addr}</span><span class="grow"></span><span class="c-pill">lag ${lag}</span></div>`).join('')}
              </div>
              <div style="font-size:11.5px;color:var(--ink-3);margin-top:4px">Sentinel · ${A.topo.sentinels.join(' / ')}</div>
            </div>`)}
        </div>

        <div class="c-m6">
          ${sec('慢查询', '阈值 3ms', `
            <table class="c-table">
              <thead><tr><th>时间</th><th class="num">耗时</th><th>命令</th></tr></thead>
              <tbody>${A.slow.map(([id, t, ms, cmd]) => `
                <tr><td class="dim">${t}</td><td class="num" style="color:${Number(ms) > 8 ? 'var(--rose)' : 'var(--ink)'}">${ms} ms</td><td class="key">${cmd}</td></tr>`).join('')}
              </tbody>
            </table>`)}
        </div>

        <div class="c-m6">
          ${sec('客户端', '318', `
            <table class="c-table">
              <thead><tr><th>地址</th><th>名称</th><th class="num">DB</th><th>命令</th></tr></thead>
              <tbody>${A.clients.map(([addr, name, age, idle, db, cmd]) => `
                <tr><td class="key">${addr}</td><td class="dim">${name}</td><td class="num">${db}</td><td class="key">${cmd}</td></tr>`).join('')}
              </tbody>
            </table>`)}
        </div>

        <div class="c-m12">
          ${sec('事件时间线', '最近 1 小时', `
            <div class="c-timeline">
              ${A.logs.map(([t, kind, msg, cls]) => `
                <div class="c-tl-item ${cls}">
                  <div class="c-tl-head"><span class="who">${kind}</span><span class="when">${t.slice(11)}</span></div>
                  <div class="c-tl-body">${msg}</div>
                </div>`).join('')}
            </div>`)}
        </div>
      </div>
      </div>`,
    };
  }

  /* ------------------------------------------------------- connections -- */
  function connections() {
    const c = A.connections.find((x) => x.id === 'cache');
    return {
      head: detailHead('connections', c.name, `${c.host}:${c.port} · ${c.mode} · TLS`,
        `<button class="c-btn ghost" data-tab="overview">在此连接上打开 →</button>
         <button class="c-btn primary">${I('plus', 13)} 新建连接</button>`),
      body: `
      <div class="c-form">
        <div>
          <div class="c-testbox">
            <span class="ic">${I('check', 13)}</span>
            <div class="grow">
              <div style="font-weight:600;margin-bottom:4px">连接成功 · 0.6 ms</div>
              <div class="lines">
                <span>版本</span><span>7.2.4</span>
                <span>模式</span><span>sentinel</span>
                <span>数据库</span><span>16 个</span>
                <span>已用内存</span><span>3.42 GB</span>
              </div>
            </div>
            <button class="c-btn ghost">重新测试</button>
          </div>

          ${sec('基本信息', '', `
            <div class="c-fgrid">
              <div class="c-fieldset wide"><label>连接名称</label><input value="${c.name}" /><span class="hint">用于侧边栏与标签页</span></div>
              <div class="c-fieldset"><label>分组</label><input value="Production" /></div>
              <div class="c-fieldset"><label>数据库</label><select><option>db0</option><option>db1</option><option selected>db2</option><option>db3</option></select></div>
              <div class="c-fieldset"><label>主机</label><input class="mono" value="${c.host}" /></div>
              <div class="c-fieldset"><label>端口</label><input class="mono" value="${c.port}" /></div>
              <div class="c-fieldset wide"><label>部署模式</label>
                <div class="c-seg"><button>Standalone</button><button class="on">Sentinel</button><button>Cluster</button></div>
              </div>
              <div class="c-fieldset wide"><label>哨兵 / 种子节点</label><input class="mono" value="10.20.1.20:26379, 10.20.1.21:26379" /></div>
            </div>`)}

          ${sec('认证', '', `
            <div class="c-fgrid">
              <div class="c-fieldset wide"><label>方式</label><div class="c-seg"><button class="on">密码</button><button>ACL 用户 + 密码</button><button>无认证</button></div></div>
              <div class="c-fieldset wide"><label>密码</label><input type="password" value="S3cr3t-pa55w0rd" /></div>
              <div class="c-fieldset wide" style="flex-direction:row;align-items:center;gap:10px"><span class="c-switch on"></span><span style="font-size:12.5px">保存到系统钥匙串</span></div>
            </div>`)}

          ${sec('加密与隧道', '', `
            <div class="c-fgrid">
              <div class="c-fieldset wide" style="flex-direction:row;align-items:center;gap:10px"><span class="c-switch on"></span><span style="font-size:12.5px">启用 TLS</span></div>
              <div class="c-fieldset"><label>CA 证书</label><input class="mono" value="~/.redis/ca.pem" /></div>
              <div class="c-fieldset"><label>客户端证书</label><input class="mono" value="~/.redis/client.pem" /></div>
              <div class="c-fieldset wide" style="flex-direction:row;align-items:center;gap:10px"><span class="c-switch"></span><span style="font-size:12.5px">通过 SSH 隧道连接</span></div>
            </div>`)}

          <div class="row" style="gap:10px;margin-top:6px">
            <button class="c-btn danger">删除连接</button>
            <span class="grow"></span>
            <button class="c-btn">取消</button>
            <button class="c-btn">测试连接</button>
            <button class="c-btn primary">保存</button>
          </div>
        </div>

        <aside class="c-aside">
          <div>
            <h3>连接预览</h3>
            <div class="minimap">
              <div><b>${c.name}</b></div>
              <div class="acc">sentinel · tls</div>
              <div>${c.host}</div>
              <div>port ${c.port} · db${c.db}</div>
              <div style="margin-top:6px;color:var(--ink-3)">redis://<b>***</b>@${c.host}:${c.port}/2</div>
            </div>
          </div>
          <div>
            <h3>说明</h3>
            <p class="muted">密码只写入系统钥匙串（macOS Keychain / Windows Credential Manager），配置文件仅保存主机、端口与模式。</p>
          </div>
          <div>
            <h3>上次使用</h3>
            <p class="muted">今天 14:02 · 12 次连接 · 平均 0.7 ms</p>
          </div>
        </aside>
      </div>`,
    };
  }

  /* ---------------------------------------------------------- settings -- */
  function settings() {
    const row = (label, help, ctl) => `
      <div class="c-setrow">
        <div><div class="lab">${label}</div><div class="hlp">${help}</div></div>
        <div class="ctl">${ctl}</div>
      </div>`;
    const sw = (on) => `<span class="c-switch ${on ? 'on' : ''}"></span>`;
    return {
      head: detailHead('settings', '设置', '偏好设置'),
      body: `
      <div class="c-set">
        ${sec('外观', '', `
          ${row('主题', '跟随系统 / 浅色 / 深色', `<div class="c-seg"><button>跟随系统</button><button class="on">浅色</button><button>深色</button></div>`)}
          ${row('字号与密度', '影响列表、表格与标签页', `<div class="c-seg"><button>紧凑</button><button class="on">标准</button><button>宽松</button></div>`)}
          ${row('键名前缀分组', '把 user:1002 自动归到 user:* 目录', sw(true))}`)}
        ${sec('数据与连接', '', `
          ${row('SCAN 每批数量', '过大可能让服务端阻塞，默认 500', `<input class="c-fieldset" style="width:90px;border:1px solid var(--line);border-radius:8px;padding:5px 8px;background:var(--paper)" value="500" />`)}
          ${row('单次最多载入键', '超出后提示继续 SCAN', `<input class="c-fieldset" style="width:90px;border:1px solid var(--line);border-radius:8px;padding:5px 8px;background:var(--paper)" value="5000" />`)}
          ${row('危险命令二次确认', 'FLUSHALL / KEYS / CONFIG SET', sw(true))}
          ${row('凭据存储', '密码不会写入配置明文', `<div class="c-seg"><button class="on">系统钥匙串</button><button>每次询问</button></div>`)}`)}
        ${sec('CLI 控制台', '', `
          ${row('命令历史条数', '保存在本地的历史上限', `<input style="width:90px;border:1px solid var(--line);border-radius:8px;padding:5px 8px;background:var(--paper)" value="1000" />`)}
          ${row('默认只读', '写命令需显式解锁', sw(true))}
          ${row('拦截阻塞型命令', 'KEYS / FLUSHALL 给出 SCAN 建议', sw(true))}`)}
        ${sec('关于', '', `
          <div class="c-facts">
            <div class="c-fact"><span class="k">版本</span><span class="v">0.1.0 (prototype)</span></div>
            <div class="c-fact"><span class="k">构建</span><span class="v">Go 1.27 · MyGo 0.7</span></div>
            <div class="c-fact"><span class="k">配置文件</span><span class="v">~/Library/Application Support/Redis Manager/</span></div>
          </div>`)}
      </div>`,
    };
  }

  /* -------------------------------------------------------------- shell */
  function render() {
    const fn = { overview, browser, cli, monitor, connections, settings }[S.page] || overview;
    const out = fn();
    const content = `
      <div class="c-main">
        ${rail(S.page)}
        ${index(S.page)}
        <section class="c-detail">
          ${out.head || ''}
          <div class="c-body keep-scroll-body">${out.body}</div>
        </section>
      </div>`;
    root.innerHTML = `
      <div class="c-app">
        ${topbar()}
        ${content}
      </div>`;
    document.documentElement.dataset.theme = S.theme;
    document.querySelectorAll('[data-chart-root]').forEach((el) => {
      const svg = el.querySelector('.chart-svg');
      if (!svg) return;
      const opts = JSON.parse(el.dataset.opts || 'null');
      if (opts) attachChartHover(el, opts);
    });
  }

  // capture chart opts keyed by the element that follows
  const origLine = window.lineChart;
  let pending = null;
  window.lineChart = function (opts) { pending = opts; return origLine(opts); };

  const origRender = render;
  render = function () {
    const opts = [];
    const spy = window.lineChart;
    window.lineChart = function (o) { opts.push(o); return origLine(o); };
    origRender();
    window.lineChart = spy;
    document.querySelectorAll('[data-chart-root]').forEach((el, i) => {
      if (opts[i]) attachChartHover(el, opts[i]);
    });
  };

  window.addEventListener('click', (ev) => {
    const nav = ev.target.closest('[data-tab]');
    if (nav) { S.page = nav.dataset.tab; render(); return; }
    const act = ev.target.closest('[data-action]');
    if (act && act.dataset.action === 'theme') {
      S.theme = S.theme === 'light' ? 'dark' : 'light';
      render();
      return;
    }
    const connEl = ev.target.closest('[data-conn]');
    if (connEl) {
      document.querySelectorAll('[data-conn]').forEach((n) => n.classList.toggle('on', n === connEl));
      return;
    }
    const seg = ev.target.closest('.c-seg button');
    if (seg) { seg.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === seg)); return; }
    const sw = ev.target.closest('.c-switch');
    if (sw) { sw.classList.toggle('on'); return; }
    const chip = ev.target.closest('.c-chip');
    if (chip) { chip.parentElement.querySelectorAll('.c-chip').forEach((n) => n.classList.toggle('on', n === chip)); return; }
    const kr = ev.target.closest('[data-krow]');
    if (kr) { document.querySelectorAll('[data-krow]').forEach((n) => n.classList.toggle('on', n === kr)); return; }
    const idx = ev.target.closest('.c-item');
    if (idx && idx.parentElement) { idx.parentElement.querySelectorAll('.c-item').forEach((n) => n.classList.toggle('on', n === idx)); }
  });

  const q = new URLSearchParams(location.search);
  if (q.get('page')) S.page = q.get('page');
  if (q.get('theme')) S.theme = q.get('theme');
  render();
})();
