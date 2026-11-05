/* A · Terminal 终端极客风 */
(function () {
  const D = window.DATA, A = window.APP, I = window.icon;
  const fmt = A.fmt;
  const root = document.getElementById('root');
  const S = { page: 'overview', theme: 'dark' };

  const TYPE = { hash: 'hash', string: 'string', zset: 'zset', set: 'set', stream: 'stream', list: 'list' };

  /* ------------------------------------------------------------ helpers */
  function bar(pct, width) {
    width = width || 16;
    const n = Math.round((pct / 100) * width);
    return `<span class="t-bar">[<i>${'█'.repeat(n)}</i>${'░'.repeat(width - n)}]</span>`;
  }

  function conn(id) { return A.connections.find((c) => c.id === (id || 'order')); }

  function connRow(c) {
    return `
      <div class="t-conn ${c.id === 'order' ? 'sel' : ''}" data-conn="${c.id}">
        <span class="st ${c.status}">●</span>
        <span class="nm">${c.name}</span>
        <span class="ver">${c.version}</span>
        <span class="addr">${c.host}:${c.port}</span>
      </div>`;
  }

  function sidebar() {
    const groups = ['Production', 'Staging', 'Local'];
    return `
    <aside class="t-side">
      <div class="t-side-head">
        <span class="acc">▌</span><span>connections</span>
        <span class="grow"></span>
        <button title="刷新">↻</button><button title="新建">+</button>
      </div>
      <div class="t-groups">
        ${groups.map((g) => `
          <div class="t-group">${g.toLowerCase()}</div>
          ${A.connections.filter((c) => c.group === g).map(connRow).join('')}`).join('')}
      </div>
      <div class="t-side-foot">
        <div class="t-foot-link"><span class="k">:</span>connections <span class="grow"></span><span class="faint">⌘⇧C</span></div>
        <div class="t-foot-link"><span class="k">:</span>cli &nbsp;<span class="faint">新会话</span><span class="grow"></span><span class="faint">⌘T</span></div>
        <div class="t-foot-link"><span class="k">:</span>settings <span class="grow"></span><span class="faint">⌘,</span></div>
      </div>
    </aside>`;
  }

  function titlebar() {
    return `
    <header class="t-titlebar">
      <div class="t-lights"><i></i><i></i><i></i></div>
      <div class="t-brand">redis-manager<span>~/prod/order-svc</span></div>
      <div class="t-palette">
        <span class="prompt">:</span><span class="ph">搜索连接 / 键 / 命令…</span><kbd>⌘K</kbd>
      </div>
      <div class="t-tbar-right">
        <span class="t-link" data-action="theme"><span class="k">☾</span> theme</span>
        <span class="t-link"><span class="k">:</span>cli</span>
        <span class="t-link acc">[+ new]</span>
      </div>
    </header>`;
  }

  function ctx(page) {
    const c = conn();
    const paths = {
      overview: `<b>${c.name}</b><span class="sep">/</span>overview`,
      browser: `<b>${c.name}</b><span class="sep">/</span>keys<span class="sep">/</span>user:1002`,
      cli: `<b>${c.name}</b><span class="sep">/</span>cli<span class="sep">/</span>session 1`,
      monitor: `<b>${c.name}</b><span class="sep">/</span>monitor`,
      connections: `<b>connections</b><span class="sep">/</span>${c.name}`,
      settings: `<b>:settings</b>`,
    };
    return `
    <div class="t-ctx">
      <span class="path">${paths[page]}</span>
      <span class="flags">
        <span>${c.host}:${c.port}/db${c.db}</span>
        <span class="ok">● 0.6ms</span>
        <span class="dim">${c.mode}</span>
      </span>
      <span class="spacer"></span>
      <span class="t-btn" data-nav="${page === 'browser' ? 'cli' : 'browser'}">${page === 'browser' ? ':cli' : ':keys'}</span>
      <span class="t-btn">:refresh <span class="k">r</span></span>
    </div>`;
  }

  function tabs(page) {
    const list = [['overview', '总览'], ['browser', '键浏览'], ['cli', 'CLI'], ['monitor', '监控']];
    return `<div class="t-tabs">${list.map(([id, label], i) => `
      <div class="t-tab ${id === page ? 'active' : ''}" data-tab="${id}"><span class="idx">${i + 1}</span>${label}</div>`).join('')}
      <div class="t-tab" style="color:var(--fg-3)">+</div>
    </div>`;
  }

  function statusbar() {
    const c = conn();
    return `
    <footer class="t-status">
      <span class="item"><span class="dot">●</span>connected <b>${c.name}</b></span>
      <span class="item">redis <b>7.2.4</b></span>
      <span class="item">ping <b>0.6ms</b></span>
      <span class="item">db <b>0</b></span>
      <span class="grow"></span>
      <span class="item">clients <b>318</b></span>
      <span class="item">ops <b>12.4k/s</b></span>
      <span class="item">keys <b>74,897</b></span>
      <span class="item ok">● live</span>
      <span class="item"><b>UTF-8</b></span>
    </footer>`;
  }

  function section(title, meta, body, extra) {
    return `
    <section class="t-section ${extra || ''}">
      <div class="t-sec-head"><span class="title">${title}</span><span class="grow"></span><span class="meta">${meta || ''}</span></div>
      <div class="t-sec-body">${body}</div>
    </section>`;
  }

  /* ----------------------------------------------------------- overview */
  function overview() {
    const D2 = window.DATA;
    const kpis = [
      { k: 'qps', v: '12,442', u: 'ops/s', foot: '▲ 4.2% vs 1h', data: D2.overview.ops },
      { k: 'clients', v: '318', u: 'conn', foot: 'blocked 0 · peak 412', data: D2.monitor.clients },
      { k: 'memory', v: '3.42', u: 'GB', foot: '57% of 6 GB', data: D2.monitor.memory, bar: true },
      { k: 'latency', v: '0.82', u: 'ms', foot: 'P99 1.4 ms', data: D2.monitor.latencyP99 },
    ];
    const kpiHtml = kpis.map((x) => `
      <div class="t-kpi" style="border-color:var(--line)">
        <div class="k">~ ${x.k}</div>
        <div class="v">${x.v} <small>${x.u}</small></div>
        ${spark(x.data, { w: 220, h: 26, color: 'var(--acc)' })}
        <div class="foot">${x.bar ? bar(57, 12) + '&nbsp;' : ''}${x.foot.replace(/ /g, '&nbsp;')}</div>
      </div>`).join('');

    const chart = `
      <section class="t-section">
        <div class="t-sec-head"><span class="title">throughput</span><span class="meta">last 60s · 1s step</span><span class="grow"></span>
          <span class="t-tag acc">60s</span><span class="t-tag">5m</span><span class="t-tag">1h</span><span class="t-tag">24h</span>
        </div>
        <div class="t-sec-body">
          <div class="t-chart" data-chart-root>
            ${lineChart({
              w: 640, h: 180, yFormat: (v) => (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v),
              xLabels: ['-60s', '-45s', '-30s', '-15s', '-5s', 'now'], min: 0,
              series: [
                { values: D2.overview.ops, color: 'var(--acc)', label: 'ops/s' },
                { values: D2.monitor.ops.map((v, i) => v * 0.78 + (D2.overview.ops[i] - D2.monitor.ops[i]) * 0.3), color: 'var(--ttl-way)', label: 'hits/s' },
              ],
            })}
            <div class="chart-tooltip"></div>
          </div>
          <div class="row" style="margin-top:6px;color:var(--fg-3);font-size:10.5px">
            <span class="acc">■</span> ops/s &nbsp; <span style="color:var(--ttl-way)">■</span> hits/s
            <span class="grow"></span><span>hit ratio 98.7% · miss 1.3%</span>
          </div>
        </div>
      </section>`;

    const alerts = section('warnings', '3', `
      <div class="t-list">
        <div class="t-li"><span class="mark">!</span><span class="txt">内存 57%，policy <code>allkeys-lru</code>，已驱逐 18,402 次</span><span class="act">:fix</span></div>
        <div class="t-li"><span class="mark">!</span><span class="txt">慢命令 <code>KEYS *</code> 8.81 ms，建议 <code>SCAN</code></span><span class="act">:view</span></div>
        <div class="t-li"><span class="mark info">i</span><span class="txt">db1 全部键均设 TTL，持久化可能丢数据</span><span class="act">:info</span></div>
      </div>`);

    const cmds = section('top commands', 'calls/s', `
      ${A.cmds.map((c) => `
        <div class="t-cmd">
          <span class="nm">${c.name}</span>
          <span class="tr"><i>${'█'.repeat(Math.round(c.pct / 6))}</i>${'░'.repeat(17 - Math.round(c.pct / 6))}</span>
          <span class="vl">${fmt(c.calls)}</span>
        </div>`).join('')}`);

    const dbs = section('keyspace', '74,897 keys', `
      <div style="display:flex;flex-direction:column;flex:1;justify-content:space-between">
      ${A.dbs.map((d) => `
        <div class="t-dbrow">
          <span class="db">db${d.db}</span>
          <span class="tr"><i>${'█'.repeat(Math.round(d.pct / 5))}</i>${'░'.repeat(20 - Math.round(d.pct / 5))}</span>
          <span class="r">${fmt(d.keys)}</span>
          <span class="r f">${d.bytes}</span>
          <span class="r f">${d.ew}%ttl</span>
        </div>`).join('')}
      </div>`);

    return `
      <div class="t-kpis">${kpiHtml}</div>
      <div class="t-grid-2">
        <div class="t-stack" style="grid-template-rows:auto 1fr">${chart}${dbs}</div>
        <div class="t-stack" style="grid-template-rows:auto 1fr">${alerts}${cmds}</div>
      </div>
      <div style="height:12px"></div>`;
  }

  /* ------------------------------------------------------------ browser */
  function browser() {
    const groups = [
      { dir: 'user:', more: 11790, keys: A.keys.filter((k) => k.k.startsWith('user:')).map((k) => [k.k.slice(5), k]) },
      { dir: 'session:', more: 8008, keys: A.keys.filter((k) => k.k.startsWith('session:')).map((k) => [k.k.slice(8), k]) },
      { dir: 'cache:', more: 24109, keys: A.keys.filter((k) => k.k.startsWith('cache:')).map((k) => [k.k.slice(6), k]) },
    ];
    const others = A.keys.filter((k) => !/:/.test(k.k) || k.k.startsWith('queue:'));
    const keyRows = groups.map((g) => `
      <div class="t-krow dir"><span class="kk">▾ ${g.dir}*</span><span class="meta">${fmt(g.more)}</span></div>
      ${g.keys.map(([short, k]) => `
        <div class="t-krow ${k.k === 'user:1002' ? 'sel' : ''}">
          <span class="kk">&nbsp;&nbsp;${short}</span>
          <span class="meta">${k.ttl} <span class="t-type ${k.t}">${k.t}</span></span>
        </div>`).join('')}
      <div class="t-krow more"><span class="kk">&nbsp;&nbsp;… +${fmt(g.more)} more</span><span class="meta">scan</span></div>
    `).join('') + others.map((k) => `
      <div class="t-krow"><span class="kk">${k.k}</span><span class="meta">${k.ttl} <span class="t-type ${k.t}">${k.t}</span></span></div>`).join('');

    const h = A.hash;
    return `
    <div class="t-find">
      <div class="t-keys">
        <div class="t-keys-head">
          <div class="t-inputline"><span class="prompt">/</span><input placeholder="filter keys…" /><span class="faint">glob</span></div>
          <div class="t-filter-row">
            <span class="on">all</span><span>string</span><span>hash</span><span>list</span><span>set</span><span>zset</span><span>stream</span>
            <span style="margin-left:auto">⚡keys</span>
          </div>
        </div>
        <div class="t-keys-body keep-scroll">${keyRows}</div>
        <div class="t-keys-foot"><span>74,897 keys</span><span class="grow"></span><span>cursor 10240</span></div>
      </div>
      <div class="t-val">
        <div class="t-val-head">
          <span class="t-type ${h.type}">${h.type}</span>
          <span class="name">${h.key}</span>
          <span class="meta">
            <span>ttl <b>${h.ttl}</b></span><span>size <b>${h.bytes}</b></span><span>enc <b>${h.encoding}</b></span>
          </span>
          <span class="grow"></span>
          <span class="t-btn">:copy</span><span class="t-btn">:ttl</span><span class="t-btn err">:del</span>
        </div>
        <div class="t-val-tabs"><span class="on">fields [${h.fields.length}]</span><span>resp</span><span>history</span><span style="margin-left:auto">:export</span></div>
        <div class="t-val-body keep-scroll">
          ${h.fields.map(([f, v]) => `
            <div class="t-hashrow">
              <span class="f">${f}</span>
              <span class="v">${v}</span>
              <span class="a"><span>:e</span> <span>:x</span></span>
            </div>`).join('')}
          <div class="t-hashrow" style="color:var(--fg-3)"><span class="f">+ field</span><span class="v">…</span><span class="a"></span></div>
        </div>
        <div class="t-val-foot">
          <span>HSET</span>
          <input class="k" placeholder="field" />
          <input placeholder="value" />
          <span class="t-btn acc">:apply ⏎</span>
        </div>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- cli */
  function cli() {
    return `
    <div class="t-cli">
      <div class="t-cli-head">
        <span class="dim">sessions:</span>
        <span class="sess on">[1] 10.20.1.10:6379 db0</span>
        <span class="sess">[2] 10.20.1.10:6379 db2</span>
        <span class="sess">+</span>
        <span class="grow" style="flex:1"></span>
        <span class="ok">● readonly</span>
        <span class="dim">write <span class="warn">[locked]</span></span>
        <span class="dim">history ↑↓ · complete ⇥ · clear ⌘K</span>
      </div>
      <div class="t-cli-term keep-scroll">
        <div><span class="t-cli-prompt">10.20.1.10:6379<span class="db">[0]</span>&gt;</span> INFO keyspace</div>
        <div class="t-cli-out"><span class="c"># Keyspace</span><br>db0:keys=48201,expires=31204,avg_ttl=11520000<br>db1:keys=1204,expires=1204,avg_ttl=720000<br>db2:keys=24880,expires=24880,avg_ttl=1500000</div>
        <div><span class="t-cli-prompt">10.20.1.10:6379<span class="db">[0]</span>&gt;</span> HGETALL user:1002</div>
        <div class="t-cli-out">1) <span class="s">"id"</span><br>2) <span class="s">"1002"</span><br>3) <span class="s">"name"</span><br>4) <span class="s">"Ada Lovelace"</span><br>5) <span class="s">"email"</span><br>6) <span class="s">"ada@example.com"</span><br>… <span class="c">(4 more)</span></div>
        <div><span class="t-cli-prompt">10.20.1.10:6379<span class="db">[0]</span>&gt;</span> TTL user:1002</div>
        <div class="t-cli-out"><span class="n">(integer) 126000</span></div>
        <div><span class="t-cli-prompt">10.20.1.10:6379<span class="db">[0]</span>&gt;</span> KEYS user:100*</div>
        <div class="t-cli-out"><span class="e">(error) ERR KEYS 会导致阻塞，已被保护策略拦截 → SCAN 0 MATCH user:100* COUNT 1000</span></div>
        <div><span class="t-cli-prompt">10.20.1.10:6379<span class="db">[0]</span>&gt;</span> SCAN 0 MATCH user:100* COUNT 3</div>
        <div class="t-cli-out">1) <span class="s">"10240"</span><br>2) 1) <span class="s">"user:1001"</span><br>   2) <span class="s">"user:1002"</span><br>   3) <span class="s">"user:1003"</span></div>
        <div><span class="t-cli-prompt">10.20.1.10:6379<span class="db">[0]</span>&gt;</span> <span class="caret" style="display:inline-block;vertical-align:-2px"></span></div>
      </div>
      <div class="t-cli-sugg"><span class="best">SCAN</span><span>SCARD</span><span>SCRIPT</span><span>SELECT</span><span>SET</span><span>SETEX</span><span>SETRANGE</span><span class="dim">⇥ 循环</span></div>
      <div class="t-cli-input">
        <span class="t-cli-prompt">10.20.1.10:6379<span class="db">[0]</span>&gt;</span>
        <input placeholder="type a command…" spellcheck="false" />
        <span class="faint">⏎ run</span>
      </div>
    </div>`;
  }

  /* ------------------------------------------------------------ monitor */
  function monitor() {
    const small = (label, v, u, data, color) => `
      <section class="t-section">
        <div class="t-sec-head"><span class="title">${label}</span></div>
        <div class="t-sec-body" style="padding:6px 8px">
          <div class="t-kpi" style="border:0;padding:0">
            <div class="v" style="font-size:20px;color:${color}">${v} <small>${u}</small></div>
            ${spark(data, { w: 160, h: 22, color })}
          </div>
        </div>
      </section>`;

    const slow = section('slowlog', 'threshold 3 ms', `
      <table class="t-table">
        <thead><tr><th>id</th><th>time</th><th class="num">us</th><th>cmd</th></tr></thead>
        <tbody>${A.slow.map(([id, t, ms, cmd]) => `
          <tr><td class="muted">${id}</td><td class="muted">${t}</td>
          <td class="num ${Number(ms) > 8 ? 'err' : 'warn'}">${ms}</td><td class="key">${cmd}</td></tr>`).join('')}
        </tbody>
      </table>`);

    const clients = section('clients', '318', `
      <table class="t-table">
        <thead><tr><th>addr</th><th>name</th><th class="num">db</th><th>cmd</th></tr></thead>
        <tbody>${A.clients.map(([addr, name, age, idle, db, cmd]) => `
          <tr><td>${addr}</td><td class="dim">${name}</td><td class="num">${db}</td><td class="key">${cmd}</td></tr>`).join('')}
        </tbody>
      </table>`);

    const topo = section('topology', 'healthy', `
      <div class="t-topo">
        <div class="node m"><span class="role">master</span><span class="addr">${A.topo.master}</span><span class="t-tag">slots 0-16383</span></div>
        <div class="kids">
          ${A.topo.replicas.map(([addr, lag]) => `<div class="node r"><span class="role">replica</span><span class="addr">${addr}</span><span class="t-tag ok">lag ${lag}</span></div>`).join('')}
        </div>
        <div class="node" style="margin-top:4px"><span class="role">sentinel</span><span class="addr dim">${A.topo.sentinels.join(' · ')}</span></div>
      </div>`);

    const info = section('info', 'server', `
      <div class="t-kvgrid">
        ${A.info.map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}
      </div>`);

    return `
    <div class="t-mon-wrap">
      <div class="t-mon">
        <section class="t-section t-span-8">
          <div class="t-sec-head"><span class="title">throughput</span><span class="ok">● live</span><span class="meta">last 5m</span><span class="grow"></span>
            <span class="t-tag">1m</span><span class="t-tag acc">5m</span><span class="t-tag">1h</span><span class="t-tag">6h</span>
          </div>
          <div class="t-sec-body">
            <div class="t-chart" data-chart-root>
              ${lineChart({
                w: 620, h: 190, yFormat: (v) => (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : Math.round(v)),
                xLabels: ['-5m', '-4m', '-3m', '-2m', '-1m', 'now'], min: 0,
                series: [{ values: D.monitor.ops, color: 'var(--acc)', label: 'ops/s', fill: true }],
              })}
              <div class="chart-tooltip"></div>
            </div>
          </div>
        </section>
        <div class="t-span-4 t-stack" style="align-content:stretch">
          ${small('qps', '12,442', 'ops/s', D.monitor.ops, 'var(--acc)')}
          ${small('p99', '1.40', 'ms', D.monitor.latencyP99, 'var(--ttl-way)')}
          ${small('clients', '318', 'conn', D.monitor.clients, 'var(--ok)')}
        </div>
        <section class="t-section t-span-8">
          <div class="t-sec-head"><span class="title">network / memory</span><span class="grow"></span>
            <span class="meta">mem <span style="color:#c9a6ff">■</span> in <span style="color:var(--ttl-way)">■</span> out <span style="color:var(--ok)">■</span></span>
          </div>
          <div class="t-sec-body">
            <div class="t-chart">
              ${lineChart({
                w: 620, h: 140, yTicks: 3, yFormat: (v) => Math.round(v), min: 0,
                xLabels: ['-5m', '-4m', '-3m', '-2m', '-1m', 'now'],
                series: [
                  { values: D.monitor.memory, color: '#c9a6ff' },
                  { values: D.monitor.netIn, color: 'var(--ttl-way)' },
                  { values: D.monitor.netOut, color: 'var(--ok)' },
                ],
              })}
              <div class="chart-tooltip"></div>
            </div>
          </div>
        </section>
        <div class="t-span-4">${topo}</div>
        <div class="t-span-6">${slow}</div>
        <div class="t-span-6">${clients}</div>
        <div class="t-span-12">${info}</div>
      </div>
    </div>`;
  }

  /* -------------------------------------------------------- connections */
  function connections() {
    const c = conn('cache');
    return `
    <div class="t-form-wrap">
      <div class="t-form-list">
        <div class="t-keys-head">
          <div class="t-inputline"><span class="prompt">/</span><input placeholder="filter…" /></div>
          <div class="t-filter-row"><span class="on">all</span><span>standalone</span><span>sentinel</span><span>cluster</span></div>
        </div>
        <div class="body">${A.connections.map((x) => `
          <div class="t-conn ${x.id === 'cache' ? 'sel' : ''}" data-conn="${x.id}">
            <span class="st ${x.status}">●</span><span class="nm">${x.name}</span><span class="ver">${x.version}</span>
            <span class="addr">${x.host}:${x.port}</span>
          </div>`).join('')}
        </div>
      </div>
      <div class="t-form">
        <div class="row" style="margin-bottom:10px">
          <span class="t-type string">${c.mode.toLowerCase()}</span>
          <span class="acc" style="font-size:14px">${c.name}</span>
          <span class="faint">${c.host}:${c.port}</span>
          <span class="grow"></span>
          <span class="t-btn">:open →</span>
        </div>

        <div class="t-testres">
          <div class="line"><span class="ok">✔</span><span>连接成功</span><span class="grow"></span><span class="faint">0.6 ms</span></div>
          <div class="line faint">redis 7.2.4 · sentinel · 16 databases</div>
        </div>

        <div class="t-fsec">basic</div>
        <div class="t-frow"><label>name</label><input value="${c.name}" /></div>
        <div class="t-frow"><label>group</label><input value="Production" /></div>
        <div class="t-frow"><label>host</label><input value="${c.host}" /></div>
        <div class="t-frow"><label>port</label><input value="${c.port}" /></div>
        <div class="t-frow"><label>mode</label>
          <div class="sel-val"><span>standalone</span><span class="on">sentinel</span><span>cluster</span></div>
        </div>
        <div class="t-frow"><label>database</label><div class="sel-val"><span>db0</span><span>db1</span><span class="on">db2</span><span>db3</span></div></div>
        <div class="t-frow"><label>sentinels</label><input value="10.20.1.20:26379, 10.20.1.21:26379" /></div>

        <div class="t-fsec">auth</div>
        <div class="t-frow"><label>method</label><div class="sel-val"><span class="on">password</span><span>acl user</span><span>none</span></div></div>
        <div class="t-frow"><label>password</label><input type="password" value="S3cr3t-pa55w0rd" /></div>
        <div class="t-frow"><label>store in keychain</label><div class="sel-val"><span class="on">yes</span><span>no</span></div></div>

        <div class="t-fsec">tls / tunnel</div>
        <div class="t-frow"><label>tls</label><div class="sel-val"><span class="on">enabled</span><span>disabled</span></div></div>
        <div class="t-frow"><label>ca cert</label><input value="~/.redis/ca.pem" /></div>
        <div class="t-frow"><label>client cert</label><input value="~/.redis/client.pem" /></div>
        <div class="t-frow"><label>ssh tunnel</label><div class="sel-val"><span>enabled</span><span class="on">disabled</span></div></div>

        <div class="t-actions">
          <span class="t-btn err">:delete</span>
          <span class="grow"></span>
          <span class="t-btn">:cancel</span>
          <span class="t-btn">:test</span>
          <span class="t-btn acc">:save ⌘S</span>
        </div>
      </div>
    </div>`;
  }

  /* ------------------------------------------------------------ settings */
  function settings() {
    const row = (label, help, ctrl) => `
      <div class="t-setrow">
        <div><span class="lab">${label}</span><span class="hlp">${help}</span></div>
        <div>${ctrl}</div>
      </div>`;
    return `
    <div class="t-set">
      <div class="t-fsec">appearance</div>
      ${row('theme', 'follow / dark / light', `<div class="sel-val"><span>auto</span><span class="on">dark</span><span>light</span></div>`)}
      ${row('density', 'row height of lists and tables', `<div class="sel-val"><span>compact</span><span class="on">normal</span><span>relaxed</span></div>`)}
      ${row('group keys by prefix', 'user:1002 归到 user:* 目录', `<span class="t-sw on">on</span>`)}
      <div class="t-fsec">data & connection</div>
      ${row('scan count', '每批 SCAN 数量', `<input style="border:1px solid var(--line);padding:1px 8px;width:100px" value="500" />`)}
      ${row('max keys per load', '超出后提示继续 SCAN', `<input style="border:1px solid var(--line);padding:1px 8px;width:100px" value="5000" />`)}
      ${row('confirm dangerous commands', 'FLUSHALL / KEYS / CONFIG SET', `<span class="t-sw on">on</span>`)}
      ${row('credential storage', '密码存储位置', `<div class="sel-val"><span class="on">keychain</span><span>ask</span></div>`)}
      <div class="t-fsec">cli</div>
      ${row('history size', '本地命令历史上限', `<input style="border:1px solid var(--line);padding:1px 8px;width:100px" value="1000" />`)}
      ${row('readonly by default', '写命令需显式解锁', `<span class="t-sw on">on</span>`)}
      ${row('block blocking commands', 'KEYS / FLUSHALL 自动拦截', `<span class="t-sw on">on</span>`)}
      <div class="t-fsec">about</div>
      ${row('version', 'prototype', `<span class="dim">0.1.0 · Go 1.27 · MyGo 0.7</span>`)}
      ${row('config file', 'connections.json', `<span class="dim">~/Library/Application Support/Redis Manager/</span>`)}
    </div>`;
  }

  /* --------------------------------------------------------------- shell */
  function render() {
    const map = { overview, browser, cli, monitor, connections, settings };
    const page = map[S.page] || overview;
    root.innerHTML = `
    <div class="t-app">
      ${titlebar()}
      <div class="t-main">
        ${sidebar()}
        <div class="t-col">
          ${ctx(S.page)}
          ${tabs(S.page)}
          <div class="t-body keep-scroll-body">${page()}</div>
        </div>
      </div>
      ${statusbar()}
    </div>`;
    document.documentElement.dataset.theme = S.theme;
    document.querySelectorAll('[data-chart-root]').forEach((el, i) => {
      const opts = i === 0 ? window.__lastChartOpts : null;
      if (opts) attachChartHover(el, opts);
    });
  }

  window.addEventListener('click', (ev) => {
    const nav = ev.target.closest('[data-tab]');
    if (nav) { S.page = nav.dataset.tab; render(); return; }
    const act = ev.target.closest('[data-action]');
    if (act) {
      if (act.dataset.action === 'theme') { S.theme = S.theme === 'dark' ? 'light' : 'dark'; render(); }
      return;
    }
    const c = ev.target.closest('[data-conn]');
    if (c) {
      document.querySelectorAll('.t-conn').forEach((n) => n.classList.toggle('sel', n === c));
      return;
    }
    const sw = ev.target.closest('.t-sw, .sel-val span');
    if (sw) {
      sw.parentElement.querySelectorAll(sw.classList.contains('t-sw') ? '.t-sw' : 'span').forEach((n) => n.classList.toggle('on', n === sw));
      return;
    }
    const fr = ev.target.closest('.t-filter-row span, .t-val-tabs span');
    if (fr) {
      fr.parentElement.querySelectorAll('span').forEach((n) => { if (!n.style.marginLeft) n.classList.toggle('on', n === fr); });
      return;
    }
    const k = ev.target.closest('.t-krow');
    if (k && !k.classList.contains('dir')) {
      document.querySelectorAll('.t-krow').forEach((n) => n.classList.toggle('sel', n === k));
    }
  });

  const q = new URLSearchParams(location.search);
  if (q.get('page')) S.page = q.get('page');
  if (q.get('theme')) S.theme = q.get('theme');
  render();
})();
