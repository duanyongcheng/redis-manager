/* C · Console 数据工作台风 */
(function () {
  const D = window.DATA, A = window.APP, I = window.icon;
  const fmt = A.fmt;
  const root = document.getElementById('root');
  const S = { page: 'overview', palette: false, lock: false, theme: 'dark' };

  const TYPE = { hash: 'hash', string: 'string', zset: 'zset', set: 'set', stream: 'stream', list: 'list' };

  function conn() { return A.connections.find((c) => c.id === 'order'); }

  /* ------------------------------------------------------------- shell */
  function topbar() {
    return `
    <header class="k-top">
      <div class="k-lights"><i></i><i></i><i></i></div>
      <div class="k-brand"><span class="k-mark">R</span><b>Redis Manager</b><span>0.1.0</span></div>
      <div class="k-cmd" data-action="palette">
        ${I('search', 14)}<span>搜索连接、键或执行命令…</span><kbd>⌘K</kbd>
      </div>
      <div class="k-top-right">
        <div class="k-icon-btn" data-action="theme" title="切换主题">${I(S.theme === 'dark' ? 'sun' : 'moon', 15)}</div>
        <div class="k-icon-btn" data-action="lock" title="锁定">${I('lock', 15)}</div>
        <div class="k-icon-btn" title="CLI" data-tab="cli">${I('terminal', 15)}</div>
        <button class="k-btn primary" data-action="open-connections">${I('plus', 14)} 新建连接</button>
      </div>
    </header>`;
  }

  function sidebar() {
    const groups = ['Production', 'Staging', 'Local'];
    return `
    <aside class="k-side">
      <div class="k-side-head">
        <span>连接</span><span class="grow"></span>
        <div class="k-icon-btn" style="width:22px;height:22px">${I('refresh', 13)}</div>
        <div class="k-icon-btn" style="width:22px;height:22px">${I('plus', 13)}</div>
      </div>
      <div class="k-side-list">
        ${groups.map((g) => `
          <div class="k-group">${g}</div>
          ${A.connections.filter((c) => c.group === g).map((c) => `
            <div class="k-conn ${c.id === 'order' ? 'on' : ''}" data-conn="${c.id}">
              <span class="dot ${c.status}"></span>
              <div class="body">
                <div class="nm">${c.name}</div>
                <div class="addr">${c.host}:${c.port}/db${c.db}</div>
              </div>
              <span class="ver">${c.version}</span>
            </div>`).join('')}
        `).join('')}
      </div>
      <div class="k-side-foot">
        <div class="k-foot" data-tab="connections">${I('plug', 14)} 连接管理</div>
        <div class="k-foot">${I('shield', 14)} SSH 隧道 <span class="k-pill" style="margin-left:auto">2</span></div>
        <div class="k-foot" data-tab="settings">${I('settings', 14)} 设置 <kbd style="margin-left:auto" class="faint">⌘,</kbd></div>
      </div>
    </aside>`;
  }

  function tabs(page) {
    const list = [['overview', '总览', ''], ['browser', '键浏览', '74.9k'], ['cli', 'CLI', ''], ['monitor', '监控', 'LIVE'], ['connections', '连接', ''], ['settings', '设置', '']];
    return `
    <div class="k-tabs">
      ${list.map(([id, label, badge]) => `
        <div class="k-tab ${id === page ? 'on' : ''}" data-tab="${id}">${label}${badge ? `<span class="badge">${badge}</span>` : ''}</div>`).join('')}
    </div>`;
  }

  function ctx() {
    const c = conn();
    return `
    <div class="k-ctx">
      <span class="k-pill green">● 已连接</span>
      <span class="host"><b>${c.name}</b> · ${c.host}:${c.port} · db${c.db} · redis 7.2.4</span>
      <span class="spacer"></span>
      <span class="k-pill">延迟 0.6 ms</span>
      <span class="k-pill">ops 12.4k/s</span>
      <span class="k-pill">clients 318</span>
    </div>`;
  }

  function statusbar() {
    return `
    <footer class="k-status">
      <span><span class="dot"></span>connected</span>
      <span>redis <b>7.2.4</b></span>
      <span>ping <b>0.6ms</b></span>
      <span>db <b>0</b></span>
      <span class="grow"></span>
      <span>keys <b>74,897</b></span>
      <span>mem <b>3.42G</b>/6G</span>
      <span>hit <b>98.7%</b></span>
      <span style="color:var(--green)">● live</span>
    </footer>`;
  }

  /* ------------------------------------------------------------ cards */
  function card(title, right, body, cls) {
    return `
    <section class="k-card ${cls || ''}">
      <div class="k-card-head"><h3>${title}</h3><span class="grow"></span>${right || ''}</div>
      ${body}
    </section>`;
  }

  /* ----------------------------------------------------------- overview */
  function overview() {
    const kpis = [
      { lab: 'QPS 吞吐', fig: '12,442', u: 'ops/s', data: D.overview.ops, color: 'var(--coral)', foot: `<span class="up">▲ 4.2%</span> 较上一小时` },
      { lab: '连接客户端', fig: '318', u: '个', data: D.monitor.clients, color: 'var(--blue)', foot: '阻塞 0 · 峰值 412' },
      { lab: '内存占用', fig: '3.42', u: 'GB', data: D.monitor.memory, color: 'var(--violet)', foot: '上限 6 GB · 57%' },
      { lab: '平均延迟', fig: '0.82', u: 'ms', data: D.monitor.latencyP99, color: 'var(--green)', foot: 'P99 1.4 ms · 慢查询 4' },
    ];
    const kpiHtml = kpis.map((k) => `
      <div class="k-kpi">
        <span class="accent" style="background:${k.color}"></span>
        <div class="lab">${k.lab}</div>
        <div class="fig">${k.fig}<small>${k.u}</small></div>
        ${spark(k.data, { w: 220, h: 30, color: k.color })}
        <div class="foot">${k.foot}</div>
      </div>`).join('');

    const chart = `
      <section class="k-card">
        <div class="k-card-head">
          <h3>吞吐与延迟</h3>
          <span class="k-pill">最近 60s</span>
          <span class="grow"></span>
          <div class="k-legend"><span><i style="background:var(--coral)"></i>ops/s</span><span><i style="background:var(--blue)"></i>hits/s</span></div>
          <div class="k-seg"><button class="on">60s</button><button>5m</button><button>1h</button><button>24h</button></div>
        </div>
        <div class="k-card-body">
          <div class="k-chart" data-chart-root>
            ${lineChart({
              w: 660, h: 180, yFormat: (v) => (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v),
              xLabels: ['-60s', '-45s', '-30s', '-15s', '-5s', 'now'], min: 0,
              series: [
                { values: D.overview.ops, color: 'var(--coral)', label: 'ops/s' },
                { values: D.monitor.ops.map((v, i) => v * 0.78 + (D.overview.ops[i] - D.monitor.ops[i]) * 0.3), color: 'var(--blue)', label: 'hits/s' },
              ],
            })}
            <div class="chart-tooltip"></div>
          </div>
        </div>
      </section>`;

    const alerts = card('告警与建议', '<span class="k-pill amber">3</span>', `
      <div class="k-card-body">
        <div class="k-alert warn"><span class="ic">!</span><span class="txt">内存已用 <b>57%</b>，<code>allkeys-lru</code> 已驱逐 <b>18,402</b> 次</span><span class="go">调整</span></div>
        <div class="k-alert warn"><span class="ic">!</span><span class="txt">检测到 <code>KEYS *</code>（8.81 ms），建议改用 <code>SCAN</code></span><span class="go">查看</span></div>
        <div class="k-alert info"><span class="ic">i</span><span class="txt">db1 全部键均带 TTL，持久化恢复后可能为空</span><span class="go">详情</span></div>
      </div>`);

    const cmds = card('热门命令', '<span class="k-pill">calls/s</span>', `
      <div class="k-card-body">
        <div class="k-bars">
          ${A.cmds.map((c) => `
            <div class="k-bar-row">
              <span class="nm">${c.name}</span>
              <span class="track"><i style="width:${c.pct}%;background:${c.name === 'GET' ? 'var(--green)' : c.name === 'HGETALL' ? 'var(--blue)' : c.name === 'SETEX' ? 'var(--violet)' : c.name === 'ZRANGE' ? 'var(--amber)' : c.name === 'HSET' ? 'var(--pink)' : 'var(--coral)'}"></i></span>
              <span class="vl">${fmt(c.calls)}</span>
            </div>`).join('')}
        </div>
      </div>`);

    const dbs = card('键空间分布', '<span class="k-pill">74,897 keys</span>', `
      <div class="k-card-body">
        ${A.dbs.map((d) => `
          <div class="k-db">
            <span class="db">db${d.db}</span>
            <span class="track"><i style="width:${d.pct}%"></i></span>
            <span class="num">${fmt(d.keys)}</span>
            <span class="num muted">${d.bytes}</span>
            <span class="num muted">${d.ew}%ttl</span>
          </div>`).join('')}
      </div>`);

    return `
    <div class="k-page">
      <div class="k-kpis">${kpiHtml}</div>
      <div class="k-row" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
        ${chart}
        ${alerts}
      </div>
      <div class="k-row" style="grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)">
        ${dbs}
        ${cmds}
      </div>
    </div>`;
  }

  /* ------------------------------------------------------------ browser */
  function browser() {
    const groups = [
      ['user:', 11790, A.keys.filter((k) => k.k.startsWith('user:')).map((k) => [k.k.slice(5), k])],
      ['session:', 8008, A.keys.filter((k) => k.k.startsWith('session:')).map((k) => [k.k.slice(8), k])],
      ['cache:', 24109, A.keys.filter((k) => k.k.startsWith('cache:')).map((k) => [k.k.slice(6), k])],
    ];
    const rows = groups.map(([dir, more, keys]) => `
      <div class="k-krow dir"><span class="kk">▾ ${dir}*</span><span class="meta">${fmt(more)}</span></div>
      ${keys.map(([short, k]) => `
        <div class="k-krow ${k.k === 'user:1002' ? 'on' : ''}" data-krow>
          <span class="kk" style="padding-left:12px">${short}</span>
          <span class="meta">${k.ttl}<span class="t ${k.t}">${k.t}</span></span>
        </div>`).join('')}
      <div class="k-krow more"><span class="kk">… +${fmt(more)} more</span><span class="meta">scan</span></div>
    `).join('') + A.keys.filter((k) => !/:/.test(k.k)).map((k) => `
      <div class="k-krow"><span class="kk">${k.k}</span><span class="meta">${k.ttl}<span class="t ${k.t}">${k.t}</span></span></div>`).join('');

    const h = A.hash;
    return `
    <div class="k-browser">
      <div class="k-keys">
        <div class="k-keys-toolbar">
          <div class="k-search">${I('search', 13)}<input placeholder="过滤键名 / glob…" /></div>
          <div class="k-filters">
            <span class="k-chip on">全部</span><span class="k-chip">String</span><span class="k-chip">Hash</span><span class="k-chip">List</span><span class="k-chip">Set</span><span class="k-chip">ZSet</span>
          </div>
        </div>
        <div class="k-keys-body keep-scroll">${rows}</div>
        <div class="k-keys-foot"><span>74,897 keys</span><span class="grow"></span><span>cursor 10240 →</span></div>
      </div>
      <div class="k-value">
        <div class="k-value-head">
          <span class="k-type ${h.type}">${h.type}</span>
          <span class="kn">${h.key}</span>
          <span class="meta"><span>TTL <b>${h.ttl}</b></span><span>大小 <b>${h.bytes}</b></span><span>编码 <b>${h.encoding}</b></span></span>
          <span class="grow"></span>
          <button class="k-btn sm ghost">${I('copy', 13)}</button>
          <button class="k-btn sm ghost">${I('refresh', 13)} 重载</button>
          <button class="k-btn sm" style="color:var(--red)">${I('trash', 13)} 删除</button>
        </div>
        <div class="k-vtabs">
          <span class="k-vtab on">${I('table', 13)} 字段 <span class="c">${h.fields.length}</span></span>
          <span class="k-vtab">${I('code', 13)} 原始 RESP</span>
          <span class="k-vtab">${I('history', 13)} 历史</span>
          <span class="grow"></span>
          <span class="k-vtab">${I('download', 13)} 导出</span>
        </div>
        <div class="k-value-body keep-scroll">
          ${h.fields.map(([f, v], i) => `
            <div class="k-field">
              <span class="f">${f}</span>
              <span class="v ${i === 3 ? 'edited' : ''}">${v}</span>
              <span class="a"><span>编辑</span><span>删除</span></span>
            </div>`).join('')}
        </div>
        <div class="k-value-foot">
          <span class="faint mono">HSET</span>
          <input class="f" placeholder="field" />
          <input class="v" placeholder="value" />
          <button class="k-btn sm primary">${I('plus', 13)} 写入</button>
          <span class="faint" style="font-size:11px">⌘S 保存</span>
        </div>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- cli */
  function cli() {
    return `
    <div class="k-cli">
      <div class="k-cli-bar">
        <span class="k-sess on"><span class="db">[0]</span> 10.20.1.10:6379</span>
        <span class="k-sess"><span class="db">[2]</span> 10.20.1.10:6379</span>
        <span class="k-sess">+ 新会话</span>
        <span class="grow"></span>
        <span class="k-pill green">${I('lock', 11)} 只读</span>
        <div class="k-seg"><button class="on">只读</button><button>可写</button></div>
      </div>
      <div class="k-term keep-scroll">
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
        <div class="out"><span class="e">(error) ERR KEYS 在 74,897 键的实例上会导致阻塞，已被保护策略拦截</span>
<span class="e">        → 使用 SCAN 0 MATCH user:100* COUNT 1000</span></div>
        <div class="cmd"><span class="p">10.20.1.10:6379<span class="db">[0]</span>&gt;</span> SCAN 0 MATCH user:100* COUNT 3</div>
        <div class="out">1) <span class="s">"10240"</span>
2) 1) <span class="s">"user:1001"</span>
   2) <span class="s">"user:1002"</span>
   3) <span class="s">"user:1003"</span></div>
      </div>
      <div class="k-cli-sugg">
        <span class="k-sugg best">SCAN</span><span class="k-sugg">SCARD</span><span class="k-sugg">SCRIPT</span><span class="k-sugg">SELECT</span><span class="k-sugg">SET</span><span class="k-sugg">SETEX</span><span class="k-sugg">SETRANGE</span>
        <span class="grow" style="flex:1"></span><span class="faint" style="font-size:11px;align-self:center">Tab 循环 · ↑↓ 历史 · ⌘K 清屏</span>
      </div>
      <div class="k-cli-input">
        <span class="p">10.20.1.10:6379<span class="db">[0]</span>&gt;</span>
        <input placeholder="输入命令…" spellcheck="false" />
        <span class="faint" style="font-size:11px">↵ 执行</span>
      </div>
    </div>`;
  }

  /* ------------------------------------------------------------ monitor */
  function monitor() {
    const stat = (lab, fig, u, data, color) => `
      <div class="s">
        <div class="lab">${lab}</div>
        <div class="fig">${fig}<small>${u}</small></div>
        ${spark(data, { w: 140, h: 20, color })}
      </div>`;
    return `
    <div class="k-mon-wrap">
    <div class="k-mon">
      ${card('命令吞吐 <span class="k-pill green" style="margin-left:6px">LIVE</span>', `
        <div class="k-legend"><span><i style="background:var(--coral)"></i>ops/s</span></div>
        <div class="k-seg"><button>1m</button><button class="on">5m</button><button>1h</button><button>6h</button></div>`, `
        <div class="k-card-body">
          <div class="k-chart" data-chart-root>
            ${lineChart({
              w: 640, h: 170, yFormat: (v) => (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : Math.round(v)),
              xLabels: ['-5m', '-4m', '-3m', '-2m', '-1m', 'now'], min: 0,
              series: [{ values: D.monitor.ops, color: 'var(--coral)', label: 'ops/s', fill: true }],
            })}
            <div class="chart-tooltip"></div>
          </div>
        </div>`, 'k-8')}

      ${card('关键指标', '<span class="k-pill">1s 采样</span>', `
        <div class="k-card-body">
          <div class="k-stat">
            ${stat('QPS', '12.4', 'k', D.monitor.ops, 'var(--coral)')}
            ${stat('P99', '1.40', 'ms', D.monitor.latencyP99, 'var(--blue)')}
            ${stat('连接', '318', '个', D.monitor.clients, 'var(--green)')}
            ${stat('内存', '3,498', 'MB', D.monitor.memory, 'var(--violet)')}
          </div>
        </div>`, 'k-4')}

      ${card('内存与网络', `
        <div class="k-legend"><span><i style="background:var(--violet)"></i>内存 MB</span><span><i style="background:var(--blue)"></i>入站</span><span><i style="background:var(--green)"></i>出站</span></div>`, `
        <div class="k-card-body">
          <div class="k-chart">
            ${lineChart({
              w: 640, h: 140, yTicks: 3, yFormat: (v) => Math.round(v), min: 0,
              xLabels: ['-5m', '-4m', '-3m', '-2m', '-1m', 'now'],
              series: [
                { values: D.monitor.memory, color: 'var(--violet)', label: '内存' },
                { values: D.monitor.netIn, color: 'var(--blue)', label: '入站' },
                { values: D.monitor.netOut, color: 'var(--green)', label: '出站' },
              ],
            })}
            <div class="chart-tooltip"></div>
          </div>
        </div>`, 'k-8')}

      ${card('主从拓扑', '<span class="k-pill green">健康</span>', `
        <div class="k-card-body">
          <div class="k-topo">
            <div class="k-node"><span class="dot"></span><span class="role">Master</span><span class="addr">10.20.1.10:6379</span><span class="grow"></span><span class="k-pill">slots 0-16383</span></div>
            <div class="k-kids">
              ${A.topo.replicas.map(([addr, lag]) => `
                <div class="k-node rep"><span class="dot"></span><span class="role">Replica</span><span class="addr">${addr}</span><span class="grow"></span><span class="k-pill">lag ${lag}</span></div>`).join('')}
            </div>
            <div class="faint" style="font-size:11px">Sentinel · ${A.topo.sentinels.join(' · ')}</div>
          </div>
        </div>`, 'k-4')}

      ${card('慢查询日志', '<span class="k-pill amber">阈值 3 ms</span><button class="k-btn sm ghost">重置</button>', `
        <div class="k-card-body" style="padding:0">
          <table class="k-tbl">
            <thead><tr><th>ID</th><th>时间</th><th class="num">耗时</th><th>命令</th><th>客户端</th></tr></thead>
            <tbody>${A.slow.map(([id, t, ms, cmd, cl]) => `
              <tr><td class="muted num">${id}</td><td class="muted">${t}</td>
              <td class="num" style="color:${Number(ms) > 8 ? 'var(--red)' : 'var(--amber)'}">${ms} ms</td>
              <td class="key">${cmd}</td><td class="muted">${cl}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>`, 'k-6')}

      ${card('客户端', '<span class="k-pill">318</span>', `
        <div class="k-card-body" style="padding:0">
          <table class="k-tbl">
            <thead><tr><th>地址</th><th>名称</th><th class="num">存活</th><th class="num">DB</th><th>命令</th></tr></thead>
            <tbody>${A.clients.map(([addr, name, age, idle, db, cmd]) => `
              <tr><td class="key">${addr}</td><td>${name}</td><td class="num muted">${age}</td><td class="num">${db}</td><td class="key" style="color:var(--blue)">${cmd}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>`, 'k-6')}

      ${card('INFO 服务器信息', '', `
        <div class="k-card-body">
          <div style="display:grid;grid-template-columns:repeat(3, minmax(0,1fr));gap:0 20px">
            ${A.info.map(([k, v]) => `<div class="k-fact"><span class="k mono">${k}</span><span class="v">${v}</span></div>`).join('')}
          </div>
        </div>`, 'k-12')}
    </div>
    </div>`;
  }

  /* -------------------------------------------------------- connections */
  function connections() {
    const c = A.connections.find((x) => x.id === 'cache');
    const f = (label, input, wide, hint) => `
      <div class="k-f ${wide ? 'wide' : ''}"><label>${label}</label>${input}${hint ? `<span class="h">${hint}</span>` : ''}</div>`;
    return `
    <div class="k-form-page">
      <div class="k-form">
        <div class="k-test">
          <span class="ic">${I('check', 13)}</span>
          <div class="info">
            <span>连接成功 · <b>0.6 ms</b></span><span>版本 <b>7.2.4</b></span><span>模式 <b>sentinel</b></span><span>数据库 <b>16</b></span>
          </div>
          <span class="grow" style="flex:1"></span>
          <button class="k-btn sm ghost">重新测试</button>
        </div>

        <div class="k-section">
          <div class="k-section-head">基本信息</div>
          <div class="k-section-body">
            ${f('连接名称', `<input value="${c.name}" />`, true)}
            ${f('分组', `<input value="Production" />`)}
            ${f('数据库', `<select><option>db0</option><option>db1</option><option selected>db2</option></select>`)}
            ${f('主机', `<input class="mono" value="${c.host}" />`)}
            ${f('端口', `<input class="mono" value="${c.port}" />`)}
            ${f('部署模式', `<div class="k-seg" style="align-self:flex-start"><button>Standalone</button><button class="on">Sentinel</button><button>Cluster</button></div>`, true)}
            ${f('哨兵 / 种子节点', `<input class="mono" value="10.20.1.20:26379, 10.20.1.21:26379" />`, true)}
          </div>
        </div>

        <div class="k-section">
          <div class="k-section-head">认证 <span class="faint">· 密码保存在系统钥匙串</span></div>
          <div class="k-section-body">
            ${f('方式', `<div class="k-seg" style="align-self:flex-start"><button class="on">密码</button><button>ACL</button><button>无认证</button></div>`, true)}
            ${f('密码', `<input type="password" value="S3cr3t-pa55w0rd" />`, true)}
          </div>
        </div>

        <div class="k-section">
          <div class="k-section-head">加密与隧道</div>
          <div class="k-section-body">
            <div class="k-f" style="flex-direction:row;align-items:center;gap:9px"><span class="k-switch on"></span><span>启用 TLS</span></div>
            <div class="k-f"></div>
            ${f('CA 证书', `<input class="mono" value="~/.redis/ca.pem" />`)}
            ${f('客户端证书', `<input class="mono" value="~/.redis/client.pem" />`)}
            <div class="k-f" style="flex-direction:row;align-items:center;gap:9px"><span class="k-switch"></span><span>通过 SSH 隧道</span></div>
            <div class="k-f"></div>
          </div>
        </div>

        <div class="row" style="gap:8px">
          <button class="k-btn" style="color:var(--red)">${I('trash', 13)} 删除连接</button>
          <span class="grow"></span>
          <button class="k-btn ghost">取消</button>
          <button class="k-btn">测试连接</button>
          <button class="k-btn primary">${I('save', 13)} 保存</button>
        </div>
      </div>

      <aside class="k-aside">
        ${card('连接串', '', `
          <div class="k-card-body">
            <div class="k-dsn">redis://<b>****</b>@${c.host}:${c.port}/2?tls=true</div>
            <button class="k-btn sm ghost" style="align-self:flex-start">${I('copy', 13)} 复制</button>
          </div>`)}
        ${card('连接详情', '', `
          <div class="k-card-body">
            <div class="k-fact"><span class="k">模式</span><span class="v">${c.mode}</span></div>
            <div class="k-fact"><span class="k">TLS</span><span class="v">启用</span></div>
            <div class="k-fact"><span class="k">上次使用</span><span class="v">今天 14:02</span></div>
            <div class="k-fact"><span class="k">连接次数</span><span class="v">12</span></div>
            <div class="k-fact"><span class="k">平均延迟</span><span class="v">0.7 ms</span></div>
          </div>`)}
      </aside>
    </div>`;
  }

  /* ----------------------------------------------------------- settings */
  function settings() {
    const row = (lab, help, ctl) => `
      <div class="k-setrow"><div><div class="lab">${lab}</div><div class="hlp">${help}</div></div><div class="ctl">${ctl}</div></div>`;
    const sw = (on) => `<span class="k-switch ${on ? 'on' : ''}"></span>`;
    return `
    <div class="k-set">
      ${card('外观', '', `<div class="k-card-body" style="padding:4px 14px 8px">
        ${row('主题', '跟随系统 / 深色 / 浅色', `<div class="k-seg"><button>跟随系统</button><button class="on">深色</button><button>浅色</button></div>`)}
        ${row('界面密度', '列表与表格的行高', `<div class="k-seg"><button>紧凑</button><button class="on">标准</button><button>宽松</button></div>`)}
        ${row('键名前缀分组', 'user:1002 自动归入 user:* 目录', sw(true))}
      </div>`)}
      ${card('数据与连接', '', `<div class="k-card-body" style="padding:4px 14px 8px">
        ${row('SCAN 每批数量', '默认 500，过大可能阻塞服务端', `<input style="width:90px;height:26px;border:1px solid var(--line);border-radius:5px;background:var(--bg-input);padding:0 8px;font-family:var(--font-mono)" value="500" />`)}
        ${row('单次最多载入键', '超出后提示继续 SCAN', `<input style="width:90px;height:26px;border:1px solid var(--line);border-radius:5px;background:var(--bg-input);padding:0 8px;font-family:var(--font-mono)" value="5000" />`)}
        ${row('危险命令二次确认', 'FLUSHALL / KEYS / CONFIG SET', sw(true))}
        ${row('凭据存储', '密码不写入明文配置', `<div class="k-seg"><button class="on">系统钥匙串</button><button>每次询问</button></div>`)}
      </div>`)}
      ${card('CLI 控制台', '', `<div class="k-card-body" style="padding:4px 14px 8px">
        ${row('默认只读', '写命令需要显式解锁', sw(true))}
        ${row('拦截阻塞型命令', 'KEYS / FLUSHALL 自动拦截并建议 SCAN', sw(true))}
        ${row('命令历史条数', '本地保存上限', `<input style="width:90px;height:26px;border:1px solid var(--line);border-radius:5px;background:var(--bg-input);padding:0 8px;font-family:var(--font-mono)" value="1000" />`)}
      </div>`)}
      ${card('关于', '', `<div class="k-card-body">
        <div class="k-fact"><span class="k">版本</span><span class="v">0.1.0 prototype</span></div>
        <div class="k-fact"><span class="k">构建</span><span class="v">Go 1.27 · MyGo 0.7</span></div>
        <div class="k-fact"><span class="k">配置</span><span class="v">~/Library/Application Support/Redis Manager/</span></div>
      </div>`)}
    </div>`;
  }

  /* ------------------------------------------------------------ overlays */
  function palette() {
    const items = [
      ['命令', 'terminal', '执行 CLI 命令…', '⌘T'],
      ['命令', 'refresh', '刷新当前连接', 'R'],
      ['连接', 'server', 'Prod · Order Svc', ''],
      ['连接', 'server', 'Prod · Session Cache', ''],
      ['键', 'key', 'user:1002', 'HSET · 10 fields'],
      ['键', 'key', 'session:a91f2c', 'STRING · 412 B'],
      ['操作', 'lock', '锁定应用', '⌘L'],
      ['操作', 'sliders', '打开偏好设置', '⌘,'],
    ];
    return `
    <div class="k-overlay" data-action="close-palette">
      <div class="k-palette">
        <div class="k-pal-input">${I('search', 16)}<input placeholder="输入键名、命令或设置…" autofocus /><kbd class="faint">Esc</kbd></div>
        <div class="k-pal-list">
          <div class="k-pal-sec">命令与跳转</div>
          ${items.map(([kind, ic, t, s], i) => `
            <div class="k-pal-item ${i === 0 ? 'sel' : ''}">
              <span class="ic">${I(ic, 13)}</span>
              <span class="t">${t}</span>
              <span class="faint" style="font-size:11px">${kind}</span>
              ${s ? `<kbd>${s}</kbd>` : ''}
            </div>`).join('')}
        </div>
        <div class="k-pal-foot"><span>↑↓ 选择</span><span>↵ 打开</span><span>Esc 关闭</span><span style="margin-left:auto">模糊匹配 · 支持 SCAN 前缀</span></div>
      </div>
    </div>`;
  }

  function lock() {
    return `
    <div class="k-lock">
      <div class="k-lock-card">
        <div class="mark">R</div>
        <h2>应用已锁定</h2>
        <p>为保护生产环境的连接与凭据，请输入密码解锁</p>
        <div class="pw">
          <input type="password" value="my-master-password" />
          <button data-action="unlock">解锁</button>
        </div>
        <div class="hint">或使用 <b>Touch ID</b> · 上次解锁 <b>2 小时前</b></div>
      </div>
    </div>`;
  }

  /* -------------------------------------------------------------- shell */
  function renderBase() {
    const map = { overview, browser, cli, monitor, connections, settings };
    const page = map[S.page] || overview;
    const isFull = S.page === 'browser' || S.page === 'cli';
    root.innerHTML = `
    <div class="k-app">
      ${topbar()}
      <div class="k-main">
        ${sidebar()}
        <div class="k-work">
          ${tabs(S.page)}
          ${ctx()}
          <div class="k-body ${isFull ? 'k-body-full' : ''}" style="${isFull ? 'display:flex;flex-direction:column;overflow:hidden' : ''}">${page()}</div>
        </div>
      </div>
      ${statusbar()}
    </div>
    ${S.palette ? palette() : ''}
    ${S.lock ? lock() : ''}`;
    document.documentElement.dataset.theme = S.theme;
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
      else if (a === 'lock') { S.lock = true; render(); }
      else if (a === 'unlock') { S.lock = false; render(); }
      else if (a === 'theme') { S.theme = S.theme === 'dark' ? 'light' : 'dark'; render(); }
      else if (a === 'open-connections') { S.page = 'connections'; S.palette = false; render(); }
      return;
    }
    const tab = ev.target.closest('[data-tab]');
    if (tab) { S.page = tab.dataset.tab; S.palette = false; render(); return; }
    const connEl = ev.target.closest('[data-conn]');
    if (connEl) { document.querySelectorAll('[data-conn]').forEach((n) => n.classList.toggle('on', n === connEl)); return; }
    const seg = ev.target.closest('.k-seg button');
    if (seg) { seg.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === seg)); return; }
    const chip = ev.target.closest('.k-chip');
    if (chip) { chip.parentElement.querySelectorAll('.k-chip').forEach((n) => n.classList.toggle('on', n === chip)); return; }
    const sw = ev.target.closest('.k-switch');
    if (sw) { sw.classList.toggle('on'); return; }
    const kr = ev.target.closest('[data-krow]');
    if (kr) { document.querySelectorAll('[data-krow]').forEach((n) => n.classList.toggle('on', n === kr)); return; }
    const pal = ev.target.closest('.k-pal-item');
    if (pal) { document.querySelectorAll('.k-pal-item').forEach((n) => n.classList.toggle('sel', n === pal)); }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (S.palette) { S.palette = false; render(); }
      else if (S.lock) { S.lock = false; render(); }
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); S.palette = !S.palette; render(); }
  });

  const q = new URLSearchParams(location.search);
  if (q.get('page')) S.page = q.get('page');
  if (q.get('theme')) S.theme = q.get('theme');
  if (q.get('palette')) S.palette = true;
  if (q.get('lock')) S.lock = true;
  render();
})();
