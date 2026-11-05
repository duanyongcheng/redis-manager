/* Shared data, icons and chart primitives for every style prototype. */
(function () {
  const D = window.DATA;

  /* ------------------------------------------------------------------ icon */
  const P = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    terminal: '<path d="m5 8 4 4-4 4M12 16h7"/>',
    activity: '<path d="M22 12h-4l-3 8L9 4l-3 8H2"/>',
    listTree: '<path d="M21 12h-8M21 6h-8M21 18h-8M3 6v4c0 1.1.9 2 2 2h3M3 10v6c0 1.1.9 2 2 2h3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v3a6 6 0 0 1-12 0V8z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    play: '<path d="m6 3 15 9-15 9z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    zap: '<path d="M13 2 3 14h8l-1 8 10-12h-8z"/>',
    cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    memory: '<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M7 17v3M12 17v3M17 17v3M7 4v3M12 4v3M17 4v3"/>',
    network: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M5 16v-2h14v2"/>',
    hardDrive: '<path d="M22 12H2M5.5 12 2.6 7.5a2 2 0 0 1-.3-1V5a2 2 0 0 1 2-2h15.4a2 2 0 0 1 2 2v1.5a2 2 0 0 1-.3 1L18.5 12"/><rect x="2" y="12" width="20" height="8" rx="2"/><path d="M6 16h.01M10 16h.01"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.5 12.5 9-9M17 6l3 3M14.5 8.5l2.5 2.5"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    gauge: '<path d="M12 21a9 9 0 1 1 9-9"/><path d="m12 12 4.5-4.5"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M2 9a15 15 0 0 1 20 0"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3.5 2"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
    sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    moonStars: '<path d="M12 3a9 9 0 1 0 7.5 13A7 7 0 0 1 12 3z"/><path d="M19 3v3M17.5 4.5h3"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    filter: '<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',
    fingerprint: '<path d="M12 10a2 2 0 0 0-2 2c0 3-1 5-2 6M12 6a6 6 0 0 1 6 6c0 2 0 4 1 5M6.5 8A8 8 0 0 1 20 12c0 2 0 4-1 6M9 4a10 10 0 0 1 12 8M4 14c0-2 0-4 1-6M7 20c1-1 2-3 2-6"/>',
  };

  window.icon = function (name, size) {
    const body = P[name] || P.info;
    const s = size || 16;
    return `<svg class="icon" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  };

  /* ---------------------------------------------------------------- format */
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const pad = (n) => String(n).padStart(2, '0');

  /* ----------------------------------------------------------------- spark */
  function extent(values) {
    let min = Infinity, max = -Infinity;
    for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
    if (!isFinite(min)) { min = 0; max = 1; }
    if (min === max) { min -= 1; max += 1; }
    return [min, max];
  }

  function linePath(values, w, h, min, max, p) {
    const n = values.length;
    if (!n) return '';
    const step = n > 1 ? (w - p * 2) / (n - 1) : 0;
    const span = max - min || 1;
    return values.map((v, i) => {
      const x = p + i * step;
      const y = h - p - ((v - min) / span) * (h - p * 2);
      return (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2);
    }).join(' ');
  }

  window.spark = function (values, o) {
    o = Object.assign({ w: 120, h: 34, color: 'currentColor', area: true, stroke: 1.6 }, o || {});
    const [min, max] = extent(values);
    const id = 'sp' + Math.random().toString(36).slice(2, 8);
    let svg = `<svg class="spark" viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none" aria-hidden="true">`;
    if (o.area) {
      svg += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${o.color}" stop-opacity=".3"/><stop offset="100%" stop-color="${o.color}" stop-opacity="0"/></linearGradient></defs>`;
      const d = linePath(values, o.w, o.h, min, max, 1.5);
      const last = values.length;
      svg += `<path class="area" style="fill:url(#${id})" d="${d} L${(o.w - 1.5).toFixed(2)} ${(o.h - 1.5).toFixed(2)} L1.5 ${(o.h - 1.5).toFixed(2)} Z"/>`;
    }
    svg += `<path d="${linePath(values, o.w, o.h, min, max, 1.5)}" vector-effect="non-scaling-stroke" style="stroke:${o.color};stroke-width:${o.stroke};fill:none"/>`;
    const lastY = o.h - 1.5 - ((values[values.length - 1] - min) / (max - min || 1)) * (o.h - 3);
    svg += `<circle cx="${o.w - 1.5}" cy="${lastY.toFixed(2)}" r="1.8" fill="${o.color}"/>`;
    return svg + '</svg>';
  };

  /* ------------------------------------------------------------ line chart */
  window.lineChart = function (opts) {
    const o = Object.assign({ w: 680, h: 168, yTicks: 4, yFormat: (v) => v, padL: 44, padR: 10, padT: 8, padB: 20, dash: false }, opts);
    const iw = o.w - o.padL - o.padR, ih = o.h - o.padT - o.padB;
    let min = o.min, max = o.max;
    if (min === undefined || max === undefined) {
      let lo = Infinity, hi = -Infinity;
      o.series.forEach((s) => s.values.forEach((v) => { if (v < lo) lo = v; if (v > hi) hi = v; }));
      if (min === undefined) min = lo;
      if (max === undefined) max = hi;
    }
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const y = (v) => o.padT + ih - ((v - min) / span) * ih;
    const x = (i, n) => o.padL + (n > 1 ? (i / (n - 1)) * iw : iw / 2);

    let svg = `<svg class="chart-svg" viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none" data-w="${o.w}" data-h="${o.h}">`;
    svg += '<g class="grid">';
    for (let t = 0; t <= o.yTicks; t++) {
      const yy = y(min + (span * t) / o.yTicks).toFixed(1);
      svg += `<line x1="${o.padL}" x2="${o.w - o.padR}" y1="${yy}" y2="${yy}"/>`;
    }
    svg += '</g><g class="axis">';
    for (let t = 0; t <= o.yTicks; t++) {
      const v = min + (span * t) / o.yTicks;
      svg += `<text x="${o.padL - 7}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${o.yFormat(v)}</text>`;
    }
    if (o.xLabels) {
      o.xLabels.forEach((lbl, i) => {
        const xx = x(i, o.xLabels.length);
        const anchor = i === 0 ? 'start' : i === o.xLabels.length - 1 ? 'end' : 'middle';
        svg += `<text x="${xx.toFixed(1)}" y="${o.h - 5}" text-anchor="${anchor}">${lbl}</text>`;
      });
    }
    svg += '</g>';
    o.series.forEach((s, si) => {
      const d = s.values.map((v, i) => (i === 0 ? 'M' : 'L') + x(i, s.values.length).toFixed(2) + ' ' + y(v).toFixed(2)).join(' ');
      if (s.fill) {
        const gid = `g${si}${Math.random().toString(36).slice(2, 6)}`;
        svg += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${s.color}" stop-opacity=".28"/><stop offset="100%" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>`;
        svg += `<path class="series-area" style="fill:url(#${gid})" d="${d} L${x(s.values.length - 1, s.values.length).toFixed(2)} ${o.padT + ih} L${o.padL} ${o.padT + ih} Z"/>`;
      }
      svg += `<path class="series" style="stroke:${s.color}${s.dash ? ';stroke-dasharray:4 4' : ''}" d="${d}"/>`;
    });
    svg += `<g class="hover-layer" style="display:none"><line class="crosshair" y1="${o.padT}" y2="${o.padT + ih}" x1="0" x2="0"/>${o.series.map((s, i) => `<circle class="hv-dot" data-i="${i}" r="3" style="fill:${s.color}"/>`).join('')}</g>`;
    svg += `<rect class="hit" x="${o.padL}" y="${o.padT}" width="${iw}" height="${ih}"/>`;
    svg += '</svg>';
    window.__lastChartOpts = o;
    return svg;
  };

  window.attachChartHover = function (root, opts) {
    const svg = root.querySelector('.chart-svg');
    const tip = root.querySelector('.chart-tooltip');
    if (!svg || !tip) return;
    const layer = svg.querySelector('.hover-layer');
    const line = svg.querySelector('.crosshair');
    const dots = svg.querySelectorAll('.hv-dot');
    const n = opts.series[0].values.length;
    const W = +svg.dataset.w, H = +svg.dataset.h;
    const padL = opts.padL === undefined ? 44 : opts.padL, padR = opts.padR === undefined ? 10 : opts.padR;
    let lo = Infinity, hi = -Infinity;
    opts.series.forEach((s) => s.values.forEach((v) => { if (v < lo) lo = v; if (v > hi) hi = v; }));
    const min = opts.min !== undefined ? opts.min : lo, max = opts.max !== undefined ? opts.max : hi;

    svg.addEventListener('mousemove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const t = Math.min(1, Math.max(0, (px - padL) / (W - padL - padR)));
      const i = Math.round(t * (n - 1));
      const cx = padL + (i / (n - 1)) * (W - padL - padR);
      layer.style.display = '';
      line.setAttribute('x1', cx);
      line.setAttribute('x2', cx);
      dots.forEach((d, si) => {
        const v = opts.series[si].values[i];
        d.setAttribute('cx', cx);
        d.setAttribute('cy', (H - (opts.padB === undefined ? 20 : opts.padB) - ((v - min) / (max - min || 1)) * (H - (opts.padT === undefined ? 8 : opts.padT) - (opts.padB === undefined ? 20 : opts.padB))).toFixed(2));
      });
      tip.style.display = 'block';
      tip.style.left = ((cx / W) * 100).toFixed(2) + '%';
      tip.innerHTML = `<div class="tt-time">${i === n - 1 ? '现在' : '-' + (n - 1 - i) + 's'}</div>` +
        opts.series.map((s) => `<div class="tt-row"><span><i style="background:${s.color}"></i>${s.label || ''}</span><b>${(opts.tipFormat ? opts.tipFormat(s.values[i]) : fmt(s.values[i]))}</b></div>`).join('');
    });
    svg.addEventListener('mouseleave', () => { layer.style.display = 'none'; tip.style.display = 'none'; });
  };

  /* ------------------------------------------------------------------ data */
  const connections = [
    { id: 'local', name: 'Local Dev', host: '127.0.0.1', port: 6379, db: 0, group: 'Local', status: 'on', version: '7.4', mode: 'Standalone', spark: D.series(20, 30, 8, 10, 5, { min: 1 }) },
    { id: 'order', name: 'Prod · Order Svc', host: 'redis-order.prod.internal', port: 6379, db: 0, group: 'Production', status: 'on', version: '7.2', mode: 'Cluster', tls: true, spark: D.series(20, 60, 6, 8, 9, { min: 1 }) },
    { id: 'cache', name: 'Prod · Session Cache', host: 'redis-cache.prod.internal', port: 6380, db: 2, group: 'Production', status: 'warn', version: '7.2', mode: 'Sentinel', tls: true, spark: D.series(20, 85, 4, 6, 13, { min: 40 }) },
    { id: 'stage', name: 'Staging', host: '10.20.3.41', port: 6379, db: 1, group: 'Staging', status: 'on', version: '7.0', mode: 'Standalone', spark: D.series(20, 18, 6, 8, 17, { min: 1 }) },
    { id: 'legacy', name: 'Legacy Blog', host: '10.0.0.12', port: 6379, db: 0, group: 'Staging', status: 'off', version: '5.0', mode: 'Standalone', spark: D.series(20, 5, 2, 2, 19, { min: 0 }) },
  ];

  const keys = [
    { k: 'user:1001', t: 'hash', ttl: '2d 4h', size: '8 fields' },
    { k: 'user:1002', t: 'hash', ttl: '1d 11h', size: '10 fields' },
    { k: 'user:1003', t: 'hash', ttl: '-', size: '12 fields' },
    { k: 'user:1004', t: 'hash', ttl: '6h 20m', size: '5 fields' },
    { k: 'user:1005', t: 'hash', ttl: '11d', size: '9 fields' },
    { k: 'session:a91f2c', t: 'string', ttl: '29m', size: '412 B' },
    { k: 'session:b70e4d', t: 'string', ttl: '29m', size: '388 B' },
    { k: 'cache:home:feed', t: 'string', ttl: '1m 10s', size: '48 KB' },
    { k: 'cache:product:88', t: 'string', ttl: '58s', size: '6.2 KB' },
    { k: 'leaderboard', t: 'zset', ttl: '-', size: '1,024 members' },
    { k: 'feature:flags', t: 'string', ttl: '-', size: '2.1 KB' },
    { k: 'events:stream', t: 'stream', ttl: '-', size: '18,240 entries' },
    { k: 'tags:hot', t: 'set', ttl: '-', size: '236 members' },
    { k: 'queue:email', t: 'list', ttl: '-', size: '1,204 items' },
  ];

  const hash = {
    key: 'user:1002', type: 'hash', ttl: '1d 11h', bytes: '486 B', encoding: 'listpack',
    fields: [
      ['id', '1002'], ['name', 'Ada Lovelace'], ['email', 'ada@example.com'], ['plan', 'pro'],
      ['created_at', '2026-03-14T09:22:11Z'], ['last_login', '2026-11-05T07:39:02Z'],
      ['avatar', 'https://cdn.example.com/a/1002.png'], ['locale', 'zh-CN'], ['verified', 'true'], ['credits', '18420'],
    ],
  };

  const history = [
    { by: 'ada@ops', op: 'HSET', what: 'user:1002', detail: 'plan: basic → pro', at: '11:42:08', ago: '3 分钟前' },
    { by: 'billing-svc', op: 'HINCRBY', what: 'user:1002', detail: 'credits +500', at: '11:38:51', ago: '6 分钟前' },
    { by: 'ada@ops', op: 'HSET', what: 'user:1002', detail: 'last_login: 2026-11-05T07:39:02Z', at: '11:21:30', ago: '23 分钟前' },
    { by: 'migrator', op: 'HSET', what: 'user:1002', detail: 'locale: en-US → zh-CN', at: '09:10:12', ago: '2 小时前' },
    { by: 'billing-svc', op: 'HINCRBY', what: 'user:1002', detail: 'credits +2000', at: '08:02:44', ago: '3 小时前' },
    { by: 'ada@ops', op: 'CREATE', what: 'user:1002', detail: '首次写入 6 个字段', at: '昨天 17:22', ago: '18 小时前' },
  ];

  const logs = [
    ['2026-11-05 15:31:02', '系统', '连接 Prod · Order Svc 成功（0.6 ms）', 'ok'],
    ['2026-11-05 15:29:48', '慢查询', 'KEYS * 8.81 ms · 10.20.1.71:41388', 'warn'],
    ['2026-11-05 15:22:11', '慢查询', 'ZRANGE leaderboard 0 -1 4.21 ms', 'warn'],
    ['2026-11-05 14:58:37', '系统', '采样任务启动：INFO 每 2s', 'info'],
    ['2026-11-05 14:40:02', '写入', 'session:a91f2c 更新（412 B）', 'ok'],
  ];

  window.APP = {
    fmt, pad, connections, keys, hash, history, logs,
    cmds: [
      { name: 'HGETALL', pct: 92, calls: 4120 }, { name: 'GET', pct: 74, calls: 3010 },
      { name: 'SETEX', pct: 50, calls: 2019 }, { name: 'ZRANGE', pct: 30, calls: 1104 },
      { name: 'HSET', pct: 20, calls: 702 }, { name: 'SCAN', pct: 11, calls: 410 },
    ],
    dbs: [
      { db: 0, keys: 48201, bytes: '1.9G', pct: 62, ew: 39 },
      { db: 1, keys: 1204, bytes: '84M', pct: 6, ew: 100 },
      { db: 2, keys: 24880, bytes: '1.4G', pct: 44, ew: 100 },
      { db: 3, keys: 412, bytes: '6M', pct: 2, ew: 0 },
    ],
    kpis: {
      ops: { v: '12,442', u: 'ops/s', d: '+4.2%' },
      clients: { v: '318', u: '个', d: '峰值 412' },
      mem: { v: '3.42', u: 'GB', d: '57% / 6 GB' },
      latency: { v: '0.82', u: 'ms', d: 'P99 1.4 ms' },
    },
    info: [
      ['redis_version', '7.2.4'], ['redis_mode', 'cluster'], ['os', 'Linux 6.1.0'], ['arch_bits', '64'],
      ['uptime_in_days', '46'], ['connected_clients', '318'], ['used_memory_human', '3.42G'],
      ['maxmemory_human', '6.00G'], ['maxmemory_policy', 'allkeys-lru'], ['mem_fragmentation_ratio', '1.07'],
      ['total_commands_processed', '184,229,041'], ['keyspace_hits', '92,104,882'],
    ],
    slow: [
      [1842, '15:31:02', '12.48', 'HGETALL user:*', '10.20.1.14:55012'],
      [1841, '15:29:48', '8.81', 'KEYS *', '10.20.1.71:41388'],
      [1840, '15:22:11', '4.21', 'ZRANGE leaderboard 0 -1', '10.20.1.14:55012'],
      [1839, '15:10:03', '3.12', 'SMEMBERS tags:hot', '10.20.2.9:60822'],
    ],
    clients: [
      ['10.20.1.14:55012', 'order-svc-7f9c', '4d', '0s', 0, 'hgetall'],
      ['10.20.1.14:55021', 'order-svc-7f9c', '4d', '2s', 0, 'get'],
      ['10.20.1.71:41388', 'metrics-exporter', '12d', '14s', 0, 'scan'],
      ['10.20.2.9:60822', 'web-nginx-02', '1d', '0s', 2, 'smembers'],
    ],
    topo: {
      master: '10.20.1.10:6379', slots: '0-16383',
      replicas: [['10.20.1.11:6379', '1.2s'], ['10.20.1.12:6379', '1.4s']],
      sentinels: ['10.20.1.20:26379', '10.20.1.21:26379', '10.20.1.22:26379'],
    },
  };
})();
