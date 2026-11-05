/* Page templates. Each renderer returns HTML for the main column. */
(function () {
  const D = window.DATA;
  const I = window.icon;

  const fmt = (n) => n.toLocaleString('en-US');

  /* ---------------------------------------------------------------- shell */
  function titlebar(opts) {
    return `
    <header class="titlebar">
      <div class="win-controls">
        <div class="traffic"><i></i><i></i><i></i></div>
      </div>
      <div class="brand"><span class="logo">R</span> Redis Manager</div>
      <div class="global-search">
        ${I('search')}
        <input placeholder="搜索连接、键、命令…" />
        <span class="kbd-hint"><kbd>⌘K</kbd></span>
      </div>
      <div class="titlebar-actions">
        <button class="btn icon" title="切换主题（原型：深/浅色）" data-action="toggle-theme">
          <span class="theme-icon">${I('sun')}</span>
        </button>
        <button class="btn icon" title="CLI" data-nav="cli">${I('terminal')}</button>
        <button class="btn primary" data-action="new-connection">${I('plus')} 新建连接</button>
      </div>
    </header>`;
  }

  function sparkMini(values, color) {
    return spark(values, { w: 34, h: 14, color: color, area: false });
  }

  function connectionRow(c) {
    const dotCls = c.status === 'on' ? 'on' : c.status === 'warn' ? 'warn' : 'off';
    return `
      <div class="conn" data-conn="${c.id}">
        <span class="status-dot ${dotCls}"></span>
        <div class="conn-main">
          <div class="conn-name">${c.name}</div>
          <div class="conn-sub">${c.host}:${c.port}<span class="faint"> /db${c.db}</span></div>
        </div>
        ${c.status === 'on' ? sparkMini(c.spark, c.status === 'on' ? 'var(--accent)' : 'var(--warn)') : ''}
        <span class="badge-ver">${c.version}</span>
      </div>`;
  }

  function sidebar(state) {
    const groups = ['Production', 'Staging', 'Local'];
    let html = `
    <aside class="sidebar">
      <div class="sidebar-head">
        <span class="sidebar-title">连接</span>
        <div class="row gap-4">
          <button class="btn ghost icon sm" title="刷新全部">${I('refresh')}</button>
          <button class="btn ghost icon sm" title="新建连接" data-action="new-connection">${I('plus')}</button>
        </div>
      </div>
      <div class="conn-list">`;
    groups.forEach((g) => {
      const list = D.connections.filter((c) => c.group === g);
      if (!list.length) return;
      html += `<div class="group-label">${I('chevronDown')} ${g} <span class="faint" style="margin-left:auto">${list.length}</span></div>`;
      list.forEach((c) => { html += connectionRow(c); });
    });
    html += `
        <div class="group-label" style="margin-top:6px">${I('chevronRight')} 未分组</div>
      </div>
      <div class="sidebar-foot">
        <button class="side-foot-btn" data-nav="connections">${I('plug')} 连接管理</button>
        <button class="side-foot-btn">${I('key')} SSH 隧道 <span class="tag" style="margin-left:auto">2</span></button>
        <button class="side-foot-btn" data-nav="settings">${I('settings')} 设置 <span class="kbd" style="margin-left:auto">⌘,</span></button>
      </div>
    </aside>`;
    return html;
  }

  function statusbar(state) {
    const c = D.connections.find((x) => x.id === (state.conn || 'prod-order')) || D.connections[1];
    const connected = c.status !== 'off';
    return `
    <footer class="statusbar">
      <span class="sb-item"><span class="status-dot ${connected ? 'on' : 'off'}"></span> ${connected ? '已连接' : '未连接'} <b>${c.name}</b></span>
      <span class="sep"></span>
      <span class="sb-item">${I('server')} redis ${c.version}.4 · ${c.mode}</span>
      <span class="sep"></span>
      <span class="sb-item">延迟 <b>0.8 ms</b></span>
      <span class="sep"></span>
      <span class="sb-item">DB 0</span>
      <span class="grow" style="flex:1"></span>
      <span class="sb-item">${I('users')} <b>318</b> 客户端</span>
      <span class="sep"></span>
      <span class="sb-item">${I('activity')} <b>12,408</b> ops/s</span>
      <span class="sep"></span>
      <span class="sb-item">${I('key')} <b>74,897</b> keys</span>
      <span class="sep"></span>
      <span class="sb-item"><span class="live-dot">实时监控</span></span>
    </footer>`;
  }

  /* --------------------------------------------------------- page header */
  function pageHead(state, head) {
    return `
    <div class="page-head">
      ${head.back ? `<button class="btn ghost icon" data-nav="${head.back}">${I('chevronRight').replace('m9 18', 'm15 18').replace('6-6-6-6', '-6-6 6-6')}</button>` : ''}
      <h1>${head.title}</h1>
      ${head.sub ? `<span class="sub">${head.sub}</span>` : ''}
      <div class="spacer"></div>
      ${head.actions || ''}
    </div>`;
  }

  /* ================================================== 1. 总览 Overview */
  function overview(state) {
    const o = D.overview;
    const c = D.connections[1];
    const last = (a) => a[a.length - 1];

    const kpis = [
      { icon: 'activity', k: 'QPS 吞吐', v: fmt(last(o.ops)), unit: 'ops/s', color: 'var(--accent)', data: o.ops, foot: `<span class="tag ok">↑ 4.2%</span> 较上一小时` },
      { icon: 'users', k: '连接客户端', v: fmt(last(o.clients || [318])), unit: '个', color: 'var(--info)', data: D.monitor.clients, foot: `其中阻塞 <b>0</b> · 峰值 412` },
      { icon: 'memory', k: '内存占用', v: '3.42', unit: 'GB', color: 'var(--purple)', data: D.monitor.memory, foot: `<div class="bar-track" style="width:70px"><i style="width:57%"></i></div> 上限 6 GB` },
      { icon: 'clock', k: '平均延迟', v: '0.82', unit: 'ms', color: 'var(--ok)', data: D.monitor.latencyP99, foot: `P99 <b>1.4ms</b>` },
    ];

    const kpiCards = kpis.map((k) => `
      <div class="card kpi">
        <div class="k">${I(k.icon, 14)} ${k.k}</div>
        <div class="v">${k.v} <small>${k.unit}</small></div>
        ${spark(k.data, { w: 220, h: 34, color: k.color })}
        <div class="foot">${k.foot}</div>
      </div>`).join('');

    const xLabels = ['', '', '', '', '', ''];
    const chart = `
      <div class="card" style="margin:0" data-chart-root>
        <div class="card-head">
          <h3 class="card-title">吞吐与延迟</h3>
          <span class="tag info">最近 60 秒</span>
          <div class="spacer"></div>
          <div class="legend">
            <span><i style="background:var(--accent)"></i>ops/s</span>
            <span><i style="background:var(--info)"></i>hits/s</span>
          </div>
          <div class="segmented" style="margin-left:10px">
            <button class="on">60s</button><button>5m</button><button>1h</button><button>24h</button>
          </div>
        </div>
        <div class="chart-wrap">
          ${lineChart({
            w: 720, h: 176, yFormat: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)),
            xLabels: ['-60s', '-45s', '-30s', '-15s', '-5s', 'now'],
            series: [
              { values: o.ops, color: 'var(--accent)' },
              { values: D.monitor.ops.map((v, i) => v * 0.78 + (o.ops[i] - D.monitor.ops[i]) * 0.3), color: 'var(--info)' },
            ],
            min: 0,
          })}
          <div class="tooltip-chart" style="display:none"></div>
        </div>
      </div>`;

    const cmdBars = D.commands.map((cm) => `
      <div class="cmd-bar-row">
        <span class="name">${cm.name.toUpperCase()}</span>
        <span class="bar"><i style="width:${cm.pct}%;background:${cm.color}"></i></span>
        <span class="val">${fmt(cm.calls)}</span>
      </div>`).join('');

    const cmdCard = `
      <div class="card">
        <div class="card-head"><h3>热门命令</h3><span class="spacer"></span><span class="tag">calls/s</span></div>
        <div class="cmds-list">${cmdBars}</div>
      </div>`;

    const dbRows = D.keyspaces.map((k) => `
      <div class="keyspace-row">
        <span class="db">db${k.db}</span>
        <span class="track"><i style="width:${k.pct}%;background:var(--accent)"></i></span>
        <span class="mono" style="text-align:right">${fmt(k.keys)}</span>
        <span class="mono faint" style="text-align:right">${k.bytes}</span>
        <span class="mono faint" style="text-align:right">${k.ew}% 过期</span>
      </div>`).join('');

    const dbCard = `
      <div class="card">
        <div class="card-head"><h3>键空间分布</h3><span class="spacer"></span><span class="tag">${fmt(D.totalKeys)} keys</span></div>
        <div style="display:grid;grid-template-columns:60px 1fr 70px 60px 70px;gap:8px;font-size:10.5px;color:var(--text-faint);padding-bottom:4px">
          <span>DB</span><span>占比</span><span style="text-align:right">键数</span><span style="text-align:right">内存</span><span style="text-align:right">过期</span>
        </div>
        ${dbRows}
      </div>`;

    const alerts = `
      <div class="card">
        <div class="card-head"><h3>告警与建议</h3><span class="spacer"></span><span class="tag warn">3 条</span></div>
        <div class="list-plain">
          <div class="li">${I('alert', 15)}<div class="grow">内存使用率 <b>57%</b>，maxmemory-policy = <code class="mono">allkeys-lru</code>，已驱逐 18,402 次</div><button class="btn sm">调整</button></div>
          <div class="li">${I('alert', 15)}<div class="grow">检测到 <code class="mono">KEYS *</code>（8.8 ms），建议改用 <code class="mono">SCAN</code></div><button class="btn sm">查看</button></div>
          <div class="li">${I('info', 15)}<div class="grow">db1 所有键均设置了 TTL，数据可能在磁盘上不可持久化</div><button class="btn sm">详情</button></div>
        </div>
      </div>`;

    return `
      <div class="page-row">
        <div class="ov-head">
          <span class="status-dot on pulse"></span>
          <h1 style="font-size:13.5px">${c.name}</h1>
          <span class="sub">${c.host}:${c.port} · db0 · ${c.mode} · redis 7.2.4</span>
          <span class="spacer" style="flex:1"></span>
          <span class="tag ok" style="height:22px">${I('checkCircle', 12)} 连接正常 · 0.6 ms</span>
          <button class="btn sm" data-nav="browser">${I('listTree', 13)} 浏览键</button>
          <button class="btn sm" data-nav="cli">${I('terminal', 13)} CLI</button>
          <button class="btn sm">${I('refresh', 13)} 刷新</button>
        </div>
        <div class="with-subnav">
        <section class="content">
          ${tabs(state, 'overview')}
          <div class="body-area">
            <div class="cards c4">${kpiCards}</div>
            <div class="cards" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);padding-top:0">
              ${chart}
              ${alerts}
            </div>
            <div class="cards c2" style="padding-top:0">
              ${dbCard}
              ${cmdCard}
            </div>
              <div style="height:24px"></div>
          </div>
        </section>
        </div>
      </div>`;
  }

  /* ---------------------------------------------------------------- tabs */
  function tabs(state, active) {
    const list = [
      { id: 'overview', label: '总览', icon: 'activity' },
      { id: 'browser', label: '键浏览', icon: 'listTree' },
      { id: 'cli', label: 'CLI', icon: 'terminal' },
      { id: 'monitor', label: '监控', icon: 'gauge' },
    ];
    return `<div class="tabs">${list.map((t) => `
      <button class="tab ${t.id === active ? 'active' : ''}" data-tab="${t.id}">
        ${I(t.icon, 13)} ${t.label}
      </button>`).join('')}
      <button class="btn ghost icon sm" style="margin-left:6px;align-self:center" title="新标签页">${I('plus')}</button>
    </div>`;
  }

  /* ================================================ 2. 键浏览 Key Browser */
  function kindLabel(t) {
    return { string: 'String', hash: 'Hash', list: 'List', set: 'Set', zset: 'ZSet', stream: 'Stream' }[t] || t;
  }

  function keyTree() {
    return D.keyGroups.map((g) => {
      if (g.keys) {
        let sub = g.keys.map((k) => `
          <div class="key-row ${k.k === 'user:1002' ? 'active' : ''}">
            <span class="k"><span class="faint">${g.name.replace(/[:*]+$/, ':')}</span>${k.k.slice(g.name.length) || k.k}</span>
            <span class="meta"><span class="ttl">${k.ttl}</span><span class="type-pill t-${k.t}">${kindLabel(k.t)}</span></span>
          </div>`).join('');
        if (g.more) sub += `<div class="key-row more"><span class="k">… 另有 ${fmt(g.more)} 个键</span><span class="meta"><span class="faint" style="font-size:9.5px;letter-spacing:.3px">SCAN</span></span></div>`;
        return `
        <div class="tree-item ${g.open ? '' : ''}" style="height:28px">
          <span class="caret ${g.open ? 'open' : ''}">${I('chevronRight')}</span>${I('folderOpen', 14)}<span class="tree-label mono" style="font-family:var(--font-mono)">${g.name}*</span><span class="tree-count">${fmt(g.count)}</span>
        </div>
        <div class="tree-children">${sub}</div>`;
      }
      return `
      <div class="key-row">
        <span class="k">${g.name}</span>
        <span class="meta"><span class="ttl">${g.ttl || ''}</span><span class="type-pill t-${g.t}">${kindLabel(g.t)}</span></span>
      </div>`;
    }).join('');
  }

  function hashValue() {
    const h = D.userHash;
    const rows = h.fields.map((f) => `
      <tr>
        <td class="cell-mono" style="width:180px;color:var(--purple)">${f[0]}</td>
        <td class="cell-mono">${f[1]}</td>
        <td style="width:64px">
          <div class="row-actions">${rowBtns()}</div>
        </td>
      </tr>`).join('');
    return `
      <div class="value-pane">
        ${valueHead(h)}
        <div class="value-tabs">
          <button class="vtab on">${I('table', 13)} 字段 <span class="count">${h.fields.length}</span></button>
          <button class="vtab">${I('code', 13)} 原始 (RESP)</button>
          <button class="vtab">${I('history', 13)} 历史</button>
          <span class="spacer" style="flex:1"></span>
          <button class="vtab">${I('download', 13)} 导出</button>
        </div>
        <div class="value-toolbar">
          <div class="search-mini filter"><input placeholder="过滤字段…"/></div>
          <span class="faint" style="font-size:11.5px">支持 glob，如 <code class="mono">user:*</code></span>
          <span class="spacer" style="flex:1"></span>
          <button class="btn sm">${I('plus')} 新增字段</button>
          <button class="btn sm">${I('clock')} 设置 TTL</button>
        </div>
        <div class="value-body">
          <table class="tbl">
            <thead><tr><th>Field</th><th>Value</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="add-row">
          <input class="input mono" placeholder="field" style="max-width:180px" />
          <input class="input mono" placeholder="value" />
          <button class="btn sm primary">${I('plus')} 添加 / 更新</button>
        </div>
      </div>`;
  }

  function rowBtns() {
    return `<button class="btn ghost icon sm" title="编辑">${I('edit', 13)}</button>
      <button class="btn ghost icon sm" title="删除">${I('trash', 13)}</button>`;
  }

  function valueHead(v) {
    const ttl = v.ttlMs < 0 ? '永久' : formatTTL(v.ttlMs);
    const size = v.sizeBytes != null ? fmtBytes(v.sizeBytes) : '';
    return `
      <div class="value-head">
        <span class="type-pill t-${v.type}">${kindLabel(v.type)}</span>
        <span class="keyname">${v.key}</span>
        <button class="btn ghost icon sm" title="复制键名">${I('copy', 13)}</button>
        <div class="spacer" style="flex:1"></div>
        <div class="value-meta">
          <span class="m">${I('clock', 12)} TTL <b>${ttl}</b></span>
          <span class="m">${I('hardDrive', 12)} <b>${size}</b></span>
          <span class="m">${I('file', 12)} <b>${v.encoding || 'listpack'}</b></span>
        </div>
        <button class="btn sm">${I('refresh')} 重载</button>
        <button class="btn sm danger" data-action="delete-key">${I('trash')} 删除</button>
      </div>`;
  }

  function formatTTL(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }

  function keylist(crumbs) {
    const filters = ['全部', 'String', 'Hash', 'List', 'Set', 'ZSet', 'Stream']
      .map((f, i) => `<span class="chip sm ${i === 0 ? 'on' : ''}">${f}</span>`).join('');
    const stat = [
      ['类型', 'all'], ['模式', 'redis 7.2'], ['命中率', '98.7%'], ['已扫描', '5,000'],
    ];
    return `
    <div class="keylist">
      <div class="keylist-toolbar">
        <div class="search-mini"><input value="" placeholder="过滤键名…" /></div>
        <div class="filters">${filters}</div>
        <div class="row gap-6">
          <select class="select" style="height:26px;font-size:11.5px;flex:1">
            <option>匹配模式 *</option><option>user:*</option><option>session:*</option>
          </select>
          <button class="btn ghost icon sm" title="使用 KEYS（危险）">${I('zap', 13)}</button>
        </div>
      </div>
      <div class="keylist-body keep-scroll">${keyTree()}</div>
      <div class="keylist-foot">
        <span>74,897 keys</span>
        <span class="grow" style="flex:1"></span>
        <span>cursor 10240</span>
        <button class="btn sm" style="height:20px">下一页 ${I('chevronRight', 11)}</button>
      </div>
    </div>`;
  }

  function browser(state) {
    const c = D.connections[1];
    return `
      <div class="page-row">
        <div class="page-head" style="height:44px">
          <span class="status-dot on"></span>
          <h1 style="font-size:13.5px">${c.name}</h1>
          <span class="sub">${c.host}:${c.port}</span>
          <span class="spacer"></span>
          <span class="tag">${I('database', 12)} db0</span>
          <span class="tag">${I('key', 12)} ${fmt(D.totalKeys)} keys</span>
          <button class="btn sm">${I('plus', 13)} 新建键</button>
          <button class="btn sm">${I('upload', 13)} 导入</button>
          <button class="btn sm">${I('download', 13)} 导出</button>
          <button class="btn sm">${I('refresh', 13)} 刷新</button>
        </div>
        <div class="with-subnav">
          ${sidebar(state)}
          <section class="content">
            ${tabs(state, 'browser')}
            <div class="body-area" style="display:flex;flex-direction:column">
              <div class="browser">
                <div class="browser-crumb">
                  <span class="dim">db0</span> <span class="sep">›</span>
                  <span class="k">user:</span> <span class="sep">›</span>
                  <span class="k">user:1002</span>
                  <span class="spacer"></span>
                  <span class="faint">命中率 98.7% · cursor 10240</span>
                </div>
                <div class="browser-split">
                  ${keylist()}
                  ${hashValue()}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>`;
  }

  /* ======================================================== 3. CLI 控制台 */
  function cliOut(rows) {
    return rows.map((r) => `<div class="cli-out ${r[0]}">${r[1]}</div>`).join('');
  }

  function cliPage(state) {
    const c = D.connections[1];
    const history = `
      <div class="cli-line"><span class="prompt">10.20.1.10:6379[0]&gt;</span><span>INFO keyspace</span></div>
      ${cliOut([['ok', '<span class="cmt"># Keyspace</span>']])}
      ${cliOut([['ok', 'db0:keys=48201,expires=31204,avg_ttl=11520000']])}
      ${cliOut([['ok', 'db1:keys=1204,expires=1204,avg_ttl=720000']])}
      ${cliOut([['ok', 'db2:keys=24880,expires=24880,avg_ttl=1500000']])}
      <div class="cli-line" style="margin-top:4px"><span class="prompt">10.20.1.10:6379[0]&gt;</span><span>GET user:1002:name</span></div>
      ${cliOut([['ok', '<span class="n">(nil)</span>']])}
      <div class="cli-line" style="margin-top:4px"><span class="prompt">10.20.1.10:6379[0]&gt;</span><span>HGETALL user:1002</span></div>
      ${cliOut([['ok', ' 1) <span class="s">"id"</span><br> 2) <span class="s">"1002"</span><br> 3) <span class="s">"name"</span><br> 4) <span class="s">"Ada Lovelace"</span><br> 5) <span class="s">"email"</span><br> 6) <span class="s">"ada@example.com"</span><br> 7) <span class="s">"plan"</span><br> 8) <span class="s">"pro"</span>']])}
      ${cliOut([['ok', '<span class="n">(8 more)</span>']])}
      <div class="cli-line" style="margin-top:4px"><span class="prompt">10.20.1.10:6379[0]&gt;</span><span>TYP user:1002</span></div>
      ${cliOut([['ok', '<span class="s">hash</span>']])}
      <div class="cli-line" style="margin-top:4px"><span class="prompt">10.20.1.10:6379[0]&gt;</span><span>KEYS user:100*</span></div>
      ${cliOut([['e', '<span class="e">(error) ERR KEYS 在 74,897 键的实例上会导致阻塞，已被保护策略拦截。使用 SCAN 0 MATCH user:100* COUNT 1000</span>']])}
      <div class="cli-line" style="margin-top:4px"><span class="prompt">10.20.1.10:6379[0]&gt;</span><span>SCAN 0 MATCH user:100* COUNT 5</span></div>
      ${cliOut([['ok', '1) <span class="s">"10240"</span><br>2) 1) <span class="s">"user:1001"</span><br>   2) <span class="s">"user:1002"</span><br>   3) <span class="s">"user:1003"</span><br>   4) <span class="s">"user:1004"</span><br>   5) <span class="s">"user:1005"</span>']])}
    `;

    return `
      <div class="page-row">
        <div class="page-head" style="height:44px">
          <span class="status-dot on"></span>
          <h1 style="font-size:13.5px">CLI 控制台</h1>
          <span class="sub">${c.host}:${c.port}</span>
          <span class="spacer"></span>
          <span class="tag">${I('lock', 12)} 只读模式</span>
          <div class="segmented"><button class="on">只读</button><button>可写</button></div>
          <button class="btn sm">${I('keyboard', 13)} 命令文档</button>
          <button class="btn sm">${I('trash', 13)} 清屏</button>
        </div>
        <div class="with-subnav">
          ${sidebar(state)}
          <section class="content">
            ${tabs(state, 'cli')}
            <div class="body-area" style="display:flex;flex-direction:column">
              <div class="cli">
                <div class="cli-head">
                  <div class="cli-tabs">
                    <button class="cli-tab on"><span class="db">[0]</span> 10.20.1.10:6379 ${I('x', 10)}</button>
                    <button class="cli-tab"><span class="db">[2]</span> 10.20.1.10:6379 ${I('x', 10)}</button>
                    <button class="cli-tab" title="新建会话">${I('plus', 12)}</button>
                  </div>
                  <span class="spacer" style="flex:1"></span>
                  <span class="hint">历史 <kbd>↑</kbd><kbd>↓</kbd> · 补全 <kbd>Tab</kbd> · 清屏 <kbd>⌘K</kbd></span>
                </div>
                <div class="cli-term keep-scroll">
                  ${history}
                </div>
                <div class="cli-suggest">
                  <span class="s best">SCAN</span><span class="s">SCARD</span><span class="s">SCRIPT</span><span class="s">SELECT</span><span class="s">SET</span><span class="s">SETEX</span><span class="s">SETRANGE</span>
                  <span class="s" style="margin-left:8px;background:transparent;color:var(--text-faint)">…</span>
                </div>
                <div class="cli-input-row">
                  <span class="prompt">10.20.1.10:6379<span class="db">[0]</span>&gt;</span>
                  <input placeholder="输入 Redis 命令，例如 SET foo bar EX 60" spellcheck="false" />
                  <span class="kbd">↵ 执行</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>`;
  }

  /* ========================================================= 4. 监控监控 */
  function monitor(state) {
    const m = D.monitor;
    const last = (a) => a[a.length - 1];

    const miniKpi = (label, val, unit, color, data) => `
      <div class="card kpi">
        <div class="k">${label}</div>
        <div class="v" style="font-size:19px">${val} <small>${unit}</small></div>
        ${spark(data, { w: 160, h: 24, color: color })}
      </div>`;

    const infoRows = [
      ['redis_version', '7.2.4'], ['redis_mode', 'cluster'], ['os', 'Linux 6.1.0-18-amd64'],
      ['arch_bits', '64'], ['uptime_in_days', '46'], ['connected_clients', '318'],
      ['used_memory_human', '3.42G'], ['maxmemory_human', '6.00G'],
      ['maxmemory_policy', 'allkeys-lru'], ['mem_fragmentation_ratio', '1.07'],
      ['total_commands_processed', '184,229,041'], ['keyspace_hits', '92,104,882'],
    ].map((r) => `<div class="kv"><span class="k">${r[0]}</span><span class="v">${r[1]}</span></div>`).join('');

    const slow = D.slowlog.map((s) => `
      <tr><td class="num">${s.id}</td><td class="mono faint">${s.ts}</td>
      <td class="num" style="color:${s.usec > 5000 ? 'var(--err)' : s.usec > 3000 ? 'var(--warn)' : 'var(--text)'}">${(s.usec / 1000).toFixed(2)} ms</td>
      <td class="cell-mono">${s.cmd}</td><td class="mono faint">${s.client}</td></tr>`).join('');

    const cl = D.clients.map((x) => `
      <tr><td class="mono">${x.addr}</td><td>${x.name}</td><td class="faint">${x.age}</td>
      <td class="faint">${x.idle}</td><td class="num">${x.db}</td><td class="cell-mono" style="color:var(--info)">${x.cmd}</td></tr>`).join('');

    const topo = `
      <div class="topology">
        <div class="topo-node master">
          <span class="status-dot on"></span>
          <div class="grow"><div class="role">Master</div><div class="addr">${D.topology.master.addr}</div></div>
          <span class="tag ok">slots 0-16383</span>
        </div>
        <div class="topo-children">
          ${D.topology.replicas.map((r) => `
            <div class="topo-node slave">
              <span class="status-dot on"></span>
              <div class="grow"><div class="role">Replica</div><div class="addr">${r.addr}</div></div>
              <span class="tag">lag ${r.lag}</span>
              <span class="tag ok">同步</span>
            </div>`).join('')}
        </div>
        <div class="divider"></div>
        <div style="font-size:11.5px;color:var(--text-faint);margin-bottom:6px">Sentinel 集群</div>
        <div class="row gap-6" style="flex-wrap:wrap">
          ${D.topology.sentinels.map((s) => `<span class="tag info mono">${s}</span>`).join('')}
        </div>
      </div>`;

    return `
      <div class="page-row">${pageHead(state, {
        title: '监控', sub: 'Prod · Order Svc',
        actions: `<span class="tag">${I('zap', 12)} 采样间隔 1s</span>
          <div class="segmented"><button>1m</button><button class="on">5m</button><button>1h</button><button>6h</button></div>
          <button class="btn sm">${I('pause')} 暂停</button>
          <button class="btn sm">${I('download')} 导出</button>`,
      })}
      <div class="with-subnav">
        ${sidebar(state)}
        <section class="content">
          ${tabs(state, 'monitor')}
          <div class="body-area">
            <div class="monitor-grid-wrap">
            <div class="monitor-grid">
              <div class="card span-8" data-chart-root>
                <div class="card-head">
                  <h3>命令吞吐</h3>
                  <span class="live-dot">LIVE</span>
                  <div class="spacer"></div>
                  <div class="legend"><span><i style="background:var(--accent)"></i>ops/s</span></div>
                </div>
                <div class="chart-wrap">
                  ${lineChart({
                    w: 640, h: 170, yFormat: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)),
                    xLabels: ['-5m', '-4m', '-3m', '-2m', '-1m', 'now'],
                    series: [{ values: m.ops, color: 'var(--accent)' }], min: 0,
                  })}
                  <div class="tooltip-chart" style="display:none"></div>
                </div>
              </div>

              <div class="span-4" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                ${miniKpi('QPS', fmt(last(m.ops)), 'ops/s', 'var(--accent)', m.ops)}
                ${miniKpi('P99 延迟', '1.40', 'ms', 'var(--info)', m.latencyP99)}
                ${miniKpi('连接数', fmt(last(m.clients)), '个', 'var(--ok)', m.clients)}
                ${miniKpi('内存', '3,498', 'MB', 'var(--purple)', m.memory)}
              </div>

              <div class="card span-8" data-chart-root>
                <div class="card-head"><h3>网络与内存</h3><div class="spacer"></div>
                  <div class="legend">
                    <span><i style="background:var(--purple)"></i>内存 (MB)</span>
                    <span><i style="background:var(--info)"></i>入站 (MB/s)</span>
                    <span><i style="background:var(--ok)"></i>出站 (MB/s)</span>
                  </div>
                </div>
                <div class="chart-wrap">
                  ${lineChart({
                    w: 640, h: 150, yTicks: 3, yFormat: (v) => Math.round(v),
                    xLabels: ['-5m', '-4m', '-3m', '-2m', '-1m', 'now'],
                    series: [
                      { values: m.memory, color: 'var(--purple)', fill: false },
                      { values: m.netIn, color: 'var(--info)', fill: false },
                      { values: m.netOut, color: 'var(--ok)', fill: false },
                    ],
                    min: 0,
                  })}
                </div>
              </div>

              <div class="card span-4">
                <div class="card-head"><h3>主从拓扑</h3><span class="spacer"></span><span class="tag ok">健康</span></div>
                ${topo}
              </div>

              <div class="card span-6">
                <div class="card-head"><h3>慢查询日志</h3><span class="spacer"></span>
                  <span class="tag warn">阈值 3 ms</span>
                  <button class="btn sm">${I('trash')} 重置</button>
                </div>
                <div class="tbl-scroll"><table class="tbl"><thead><tr><th>ID</th><th>时间</th><th class="num">耗时</th><th>命令</th><th>客户端</th></tr></thead>
                <tbody>${slow}</tbody></table></div>
              </div>

              <div class="card span-6">
                <div class="card-head"><h3>客户端</h3><span class="spacer"></span>
                  <span class="tag info">318 个</span>
                  <button class="btn sm">${I('users')} 管理</button>
                </div>
                <div class="tbl-scroll"><table class="tbl"><thead><tr><th>地址</th><th>名称</th><th>存活</th><th>空闲</th><th class="num">DB</th><th>当前命令</th></tr></thead>
                <tbody>${cl}</tbody></table></div>
              </div>

              <div class="card span-12">
                <div class="card-head"><h3>INFO 服务器信息</h3><span class="spacer"></span>
                  <div class="search-mini" style="width:200px"><input placeholder="过滤指标…"/></div>
                </div>
                <div class="kv-grid">${infoRows}</div>
              </div>
            </div>
            </div>
          </div>
        </section>
      </div>
      </div>`;
  }

  /* ================================================= 5. 连接管理 / 表单 */
  function connCard(c, activeId) {
    const dot = c.status === 'on' ? 'on' : c.status === 'warn' ? 'warn' : 'off';
    return `
      <div class="conn ${c.id === activeId ? 'selected' : ''}" data-conn="${c.id}">
        <span class="status-dot ${dot}"></span>
        <div class="conn-main">
          <div class="conn-name">${c.name}</div>
          <div class="conn-sub">${c.host}:${c.port}</div>
        </div>
        <span class="badge-ver">${c.version}</span>
      </div>`;
  }

  function connManager(state) {
    return `
      <div class="page-row">${pageHead(state, {
        title: '连接管理', sub: '3 个已连接 · 5 个连接',
        actions: `<button class="btn sm">${I('download', 13)} 导入</button>
          <button class="btn sm">${I('upload', 13)} 导出</button>
          <button class="btn primary sm" data-action="new-connection">${I('plus', 13)} 新建连接</button>`,
      })}
      <div class="with-subnav">
        ${sidebar(state)}
        <section class="content">
          ${tabs(state, 'connections')}
          <div class="body-area" style="overflow:hidden">
            <div class="conn-page">
              <div class="conn-page-list">
                <div class="head">
                  <div class="search-mini"><input placeholder="搜索…"/></div>
                  <div class="row gap-6">
                    <select class="select" style="height:26px;font-size:11.5px"><option>全部类型</option><option>Standalone</option><option>Cluster</option><option>Sentinel</option></select>
                    <button class="btn ghost icon sm" title="导入">${I('download', 13)}</button>
                  </div>
                </div>
                <div class="list">
                  <div class="group-label">${I('chevronDown')} Production</div>
                  ${D.connections.filter(c => c.group === 'Production').map(c => connCard(c, 'prod-cache')).join('')}
                  <div class="group-label">${I('chevronDown')} Staging</div>
                  ${D.connections.filter(c => c.group === 'Staging').map(c => connCard(c, 'prod-cache')).join('')}
                  <div class="group-label">${I('chevronDown')} Local</div>
                  ${D.connections.filter(c => c.group === 'Local').map(c => connCard(c, 'prod-cache')).join('')}
                </div>
              </div>

              <div class="conn-form">
                <div class="row gap-8" style="margin-bottom:16px">
                  <div style="width:38px;height:38px;border-radius:10px;background:var(--accent-soft);display:grid;place-items:center;color:var(--accent)">${I('database', 20)}</div>
                  <div class="grow">
                    <div style="font-size:15px;font-weight:620">Prod · Session Cache</div>
                    <div class="faint" style="font-size:12px">redis-cache.prod.internal:6380 · Sentinel · TLS</div>
                  </div>
                  <span class="tag ok">${I('checkCircle', 12)} 连接正常</span>
                  <button class="btn sm">${I('external', 13)} 在此连接上打开</button>
                </div>

                <div class="test-result ok">
                  <span class="icon">${I('checkCircle', 18)}</span>
                  <div class="grow">
                    <div style="font-weight:600">连接成功</div>
                    <div class="kv-mini">
                      <span>版本</span><span style="color:var(--text)">7.2.4</span>
                      <span>延迟</span><span style="color:var(--text)">0.6 ms</span>
                      <span>模式</span><span style="color:var(--text)">sentinel</span>
                      <span>数据库</span><span style="color:var(--text)">16 个</span>
                    </div>
                  </div>
                  <button class="btn sm">重新测试</button>
                </div>

                <div class="section-title" style="margin-top:22px">基本信息</div>
                <div class="form-grid">
                  <div class="field">
                    <label>连接名称</label>
                    <input class="input" value="Prod · Session Cache" />
                    <span class="hint">用于在侧边栏与标签页中识别</span>
                  </div>
                  <div class="field">
                    <label>分组</label>
                    <input class="input" value="Production" list="groups" />
                    <datalist id="groups"><option>Production</option><option>Staging</option><option>Local</option></datalist>
                  </div>
                  <div class="field">
                    <label>主机</label>
                    <input class="input mono" value="redis-cache.prod.internal" />
                  </div>
                  <div class="field">
                    <label>端口</label>
                    <input class="input mono" value="6380" />
                  </div>
                  <div class="field">
                    <label>部署模式</label>
                    <select class="select">
                      <option>Standalone 单机</option>
                      <option>Sentinel 哨兵</option>
                      <option selected>Cluster 集群</option>
                    </select>
                  </div>
                  <div class="field">
                    <label>数据库索引</label>
                    <select class="select"><option>db0</option><option>db1</option><option selected>db2</option><option>db3</option></select>
                  </div>
                  <div class="field span2">
                    <label>Sentinel / 种子节点</label>
                    <input class="input mono" value="10.20.1.20:26379, 10.20.1.21:26379" />
                    <span class="hint">多个地址用英文逗号分隔</span>
                  </div>
                </div>

                <div class="section-title">认证</div>
                <div class="form-grid">
                  <div class="field span2">
                    <div class="auth-tabs">
                      <button class="on">密码 (AUTH)</button>
                      <button>ACL 用户名 + 密码</button>
                      <button>无认证</button>
                    </div>
                    <div class="row gap-6">
                      <input class="input mono " type="password" value="S3cr3t-pa55w0rd" />
                      <button class="btn icon" title="显示密码">${I('eye', 14)}</button>
                    </div>
                    <label class="row gap-6" style="font-size:12px;color:var(--text-dim);margin-top:2px">
                      <span class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg></span>
                      保存到系统钥匙串（macOS Keychain / Windows Credential Manager）
                    </label>
                  </div>
                </div>

                <div class="section-title">加密与隧道</div>
                <div class="form-grid">
                  <div class="field span2">
                    <label class="row gap-8" style="font-weight:600;font-size:12.5px;cursor:pointer">
                      <span class="switch on"></span> 启用 TLS / SSL
                    </label>
                  </div>
                  <div class="field"><label>CA 证书</label><input class="input mono" value="~/.redis/ca.pem" /></div>
                  <div class="field"><label>客户端证书</label><input class="input mono" value="~/.redis/client.pem" /></div>
                  <div class="field span2"><label class="row gap-8" style="font-weight:600;font-size:12.5px;cursor:pointer"><span class="switch"></span> 通过 SSH 隧道连接</label></div>
                </div>

                <div class="section-title">高级</div>
                <div class="form-grid">
                  <div class="field"><label>连接超时 (ms)</label><input class="input mono" value="5000" /></div>
                  <div class="field"><label>只读模式</label><select class="select"><option>否（可写入）</option><option>是（拦截写命令）</option></select></div>
                  <div class="field span2"><label>颜色标记</label>
                    <div class="row gap-6">
                      ${['#ff5c4a', '#5aa9f7', '#b18cf2', '#46c98b', '#e9b14b', '#8b949e', '#e58fb8'].map((c, i) => `<span style="width:18px;height:18px;border-radius:50%;background:${c};cursor:pointer;${i === 2 ? 'box-shadow:0 0 0 2px var(--bg-raised),0 0 0 3.5px ' + c : ''}"></span>`).join('')}
                    </div>
                  </div>
                </div>

                <div class="form-actions">
                  <button class="btn danger">${I('trash')} 删除</button>
                  <div class="right">
                    <button class="btn">取消</button>
                    <button class="btn">${I('plug')} 测试连接</button>
                    <button class="btn primary">${I('save')} 保存</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      </div>`;
  }

  /* ============================================================ 6. 设置 */
  function settingsPage(state) {
    const row = (label, desc, control) => `
      <div class="set-row">
        <div class="grow"><div class="set-label">${label}</div><div class="set-desc">${desc}</div></div>
        ${control}
      </div>`;
    return `
      <div class="page-row">${pageHead(state, { title: '设置', sub: '偏好设置' })}
      <div class="with-subnav">
        ${sidebar(state)}
        <section class="content">
          ${tabs(state, 'settings')}
          <div class="body-area">
            <div class="set-wrap"><div class="page-scroll">
              <div class="section-title">外观</div>
              <div class="card" style="padding:0 16px">
                ${row('主题', '跟随系统 / 深色 / 浅色',
                  `<div class="segmented"><button>跟随系统</button><button class="on">深色</button><button>浅色</button></div>`)}
                ${row('界面字号', '影响列表、表格与标签页',
                  `<select class="select" style="width:110px"><option>紧凑</option><option selected>标准</option><option>宽松</option></select>`)}
                ${row('键名前缀分组', '把 user:1002 自动归到 user:* 目录下显示',
                  `<span class="switch on"></span>`)}
              </div>

              <div class="section-title">连接与数据</div>
              <div class="card" style="padding:0 16px">
                ${row('默认时间格式', '慢日志、TTL、监控图的显示方式',
                  `<select class="select" style="width:130px"><option>相对时间</option><option>本地时间</option></select>`)}
                ${row('SCAN 每批数量', '过大可能让服务端阻塞，默认 500',
                  `<input class="input mono" style="width:110px" value="500" />`)}
                ${row('单次最多载入键', '超出后提示继续 SCAN，避免界面卡顿',
                  `<input class="input mono" style="width:110px" value="5000" />`)}
                ${row('危险命令二次确认', 'FLUSHALL / FLUSHDB / KEYS / CONFIG SET 等',
                  `<span class="switch on"></span>`)}
                ${row('凭据存储位置', '密码不会写入配置明文文件',
                  `<select class="select" style="width:150px"><option>系统钥匙串（推荐）</option><option>每次询问</option></select>`)}
              </div>

              <div class="section-title">CLI 控制台</div>
              <div class="card" style="padding:0 16px">
                ${row('命令历史条数', '保存在本地的历史记录上限',
                  `<input class="input mono" style="width:110px" value="1000" />`)}
                ${row('只读保护', '默认拦截写命令，需手动解锁',
                  `<span class="switch on"></span>`)}
                ${row('拦截阻塞型命令', 'KEYS / FLUSHALL 等命中时给出 SCAN 建议',
                  `<span class="switch on"></span>`)}
              </div>

              <div class="section-title">关于</div>
              <div class="card">
                <div class="list-plain">
                  <div class="li"><span class="lbl">版本</span><span class="val">0.1.0 (prototype)</span></div>
                  <div class="li"><span class="lbl">构建</span><span class="val">Go 1.27 · MyGo 0.7</span></div>
                  <div class="li"><span class="lbl">配置文件</span><span class="val dim">~/Library/Application Support/Redis Manager/connections.json</span></div>
                </div>
              </div>
            </div></div>
          </div>
        </section>
      </div>
      </div>`;
  }

  /* ================================================= 7. 新建连接对话框 */
  function newConnDialog() {
    return `
    <div class="overlay" data-overlay>
      <div class="dialog">
        <div class="dialog-head">
          <div style="width:30px;height:30px;border-radius:8px;background:var(--accent-soft);display:grid;place-items:center;color:var(--accent)">${I('plus', 16)}</div>
          <div class="grow">
            <h2>新建连接</h2>
            <div class="sub">连接已保存时自动存入系统钥匙串</div>
          </div>
          <button class="btn ghost icon" data-action="close-dialog">${I('x')}</button>
        </div>
        <div class="dialog-body">
          <div class="field"><label>连接名称</label><input class="input" placeholder="例如：本地开发 / Prod 订单服务" autofocus /></div>
          <div class="row gap-8">
            <div class="field grow"><label>主机</label><input class="input mono" value="127.0.0.1" /></div>
            <div class="field" style="width:100px"><label>端口</label><input class="input mono" value="6379" /></div>
          </div>
          <div class="row gap-8">
            <div class="field grow"><label>模式</label><select class="select"><option>Standalone</option><option>Sentinel</option><option>Cluster</option></select></div>
            <div class="field" style="width:120px"><label>数据库</label><select class="select"><option>db0</option><option>db1</option></select></div>
          </div>
          <div class="field"><label>密码（可选）</label><input class="input mono" type="password" placeholder="••••••••" /></div>
          <label class="row gap-8" style="font-size:12.5px;cursor:pointer">
            <span class="switch on"></span> 使用 TLS
          </label>
        </div>
        <div class="dialog-foot">
          <button class="btn sm">${I('plug', 13)} 测试</button>
          <div class="right">
            <button class="btn" data-action="close-dialog">取消</button>
            <button class="btn primary">保存并连接</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  window.VIEWS = {
    renderOverviewOnly(state) {
      return overview(state);
    },
    render(state) {
      const map = {
        overview, browser, cli: cliPage, monitor, connections: connManager,
        settings: settingsPage,
      };
      const fn = map[state.page] || overview;
      const html = `
        <div class="app">
          ${titlebar()}
          <div class="workarea">${fn(state)}</div>
          ${statusbar(state)}
        </div>
        ${state.dialog ? newConnDialog() : ''}
        <style>
          .kv-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 2px 24px; }
          .kv-grid .kv { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
          .kv-grid .kv .k { font-family: var(--font-mono); color: var(--text-faint); }
          .kv-grid .kv .v { font-family: var(--font-mono); color: var(--text); }
          .set-row { display: flex; align-items: center; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--border); }
          .set-row:last-child { border-bottom: 0; }
          .set-label { font-size: 12.5px; font-weight: 550; }
          .set-desc { font-size: 11.5px; color: var(--text-faint); margin-top: 2px; }
        </style>`;
      return html;
    },
  };
})();
