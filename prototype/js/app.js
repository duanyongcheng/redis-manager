/* Prototype controller: navigation, theme, interactions. */
(function () {
  const root = document.getElementById('root');
  const state = {
    page: 'overview',
    conn: 'prod-order',
    dialog: false,
    theme: 'dark',
  };

  function render() {
    const saved = preserveScroll();
    chartOptsQueue = [];
    root.innerHTML = VIEWS.render(state);
    document.documentElement.dataset.theme = state.theme;
    mountCharts();
    restoreScroll(saved);
  }

  // lineChart records the options of each chart it renders so the hover
  // handler can be attached to the right root after innerHTML is set.
  let chartOptsQueue = [];
  const origLine = window.lineChart;
  window.lineChart = function (opts) {
    chartOptsQueue.push(opts);
    return origLine(opts);
  };

  function mountCharts() {
    const queue = chartOptsQueue;
    chartOptsQueue = [];
    document.querySelectorAll('[data-chart-root]').forEach((el, i) => {
      const o = queue[i];
      if (!o || !el.querySelector('.tooltip-chart')) return;
      const n = o.series[0].values.length;
      attachChartHover(el, Object.assign({}, o, {
        tooltip: function (idx) {
          const rows = o.series.map((s) => {
            const v = s.values[idx];
            return `<div class="r"><span><i style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${s.color};margin-right:5px"></i>${s.label || ''}</span><b>${(o.tipFormat ? o.tipFormat(v) : v.toLocaleString('en-US'))}</b></div>`;
          }).join('');
          return `<div class="t">${idx === n - 1 ? '现在' : '-' + (n - 1 - idx) + 's'}</div>${rows}`;
        },
      }));
    });
  }

  function nav(page) {
    state.page = page;
    state.dialog = false;
    render();
  }

  function preserveScroll() {
    return Array.from(document.querySelectorAll('.keep-scroll')).map((el, i) => [i, el.scrollTop]);
  }

  function restoreScroll(saved) {
    const els = document.querySelectorAll('.keep-scroll');
    saved.forEach(([i, top]) => { if (els[i]) els[i].scrollTop = top; });
  }

  document.addEventListener('click', (ev) => {
    const navEl = ev.target.closest('[data-nav]');
    if (navEl) { nav(navEl.dataset.nav); return; }

    const tab = ev.target.closest('[data-tab]');
    if (tab) { state.page = tab.dataset.tab; render(); return; }

    const act = ev.target.closest('[data-action]');
    if (act) {
      const a = act.dataset.action;
      if (a === 'toggle-theme') {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        render();
      } else if (a === 'new-connection') {
        state.page = 'connections';
        state.dialog = true;
        render();
      } else if (a === 'close-dialog') {
        state.dialog = false;
        render();
      }
      return;
    }

    if (ev.target.closest('[data-overlay]') === ev.target) {
      state.dialog = false;
      render();
    }

    const conn = ev.target.closest('[data-conn]');
    if (conn) {
      state.conn = conn.dataset.conn;
      document.querySelectorAll('.conn').forEach((n) => n.classList.toggle('selected', n.dataset.conn === state.conn));
      document.querySelectorAll('.conn').forEach((n) => n.classList.toggle('selected', n === conn));
      return;
    }

    const seg = ev.target.closest('.segmented button');
    if (seg) {
      seg.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === seg));
      return;
    }

    const vt = ev.target.closest('.vtab');
    if (vt) {
      vt.parentElement.querySelectorAll('.vtab').forEach((b) => b.classList.toggle('on', b === vt));
      return;
    }

    const ct = ev.target.closest('.cli-tab');
    if (ct && !ct.title) {
      ct.parentElement.querySelectorAll('.cli-tab').forEach((b) => b.classList.toggle('on', b === ct));
      return;
    }

    const sw = ev.target.closest('.switch');
    if (sw) { sw.classList.toggle('on'); return; }

    const key = ev.target.closest('.key-row');
    if (key && !key.closest('.keylist-body')) {
      // tree children inside browser
      document.querySelectorAll('.key-row').forEach((n) => n.classList.toggle('active', n === key));
    }

    const ti = ev.target.closest('.tree-item');
    if (ti) {
      ti.parentElement.querySelectorAll('.tree-item').forEach((n) => n.classList.toggle('active', n === ti));
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && state.dialog) { state.dialog = false; render(); }
  });

  // `?page=...&theme=...` lets screenshots deep-link, e.g. ?page=cli&theme=light
  const q = new URLSearchParams(location.search);
  if (q.get('page')) state.page = q.get('page');
  if (q.get('theme')) state.theme = q.get('theme');
  if (q.get('dialog') === '1') state.dialog = true;

  render();
  if (q.get('scroll')) {
    const el = document.querySelector('.body-area');
    if (el) el.scrollTop = +q.get('scroll');
  }
  window.__PROTO_READY__ = true;
})();
