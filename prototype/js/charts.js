/* Tiny SVG chart helpers — no dependencies. */
(function () {
  function extent(values) {
    let min = Infinity, max = -Infinity;
    for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
    if (!isFinite(min)) { min = 0; max = 1; }
    if (min === max) { min -= 1; max += 1; }
    return [min, max];
  }

  function pathOf(values, w, h, min, max, pad) {
    const p = pad || 0;
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

  // Sparkline: a compact line with optional area fill.
  window.spark = function (values, opts) {
    const o = Object.assign({ w: 120, h: 34, color: 'var(--accent)', area: true, guide: null }, opts || {});
    const [min, max] = extent(values);
    const d = pathOf(values, o.w, o.h, min, max, 2);
    const id = 'sp' + Math.random().toString(36).slice(2, 7);
    let svg = `<svg class="spark" viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none" aria-hidden="true">`;
    if (o.guide !== null) {
      const y = (o.h - 2 - ((o.guide - min) / (max - min || 1)) * (o.h - 4)).toFixed(1);
      svg += `<line class="guide" x1="0" x2="${o.w}" y1="${y}" y2="${y}"/>`;
    }
    if (o.area) {
      svg += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${o.color}" stop-opacity=".28"/>
        <stop offset="100%" stop-color="${o.color}" stop-opacity="0"/></linearGradient></defs>`;
      const last = pathOf(values, o.w - 2, o.h - 2, min, max, 2);
      const areaD = last.replace(/^M[\d.]+ [\d.]+/, 'M2 ' + (o.h - 2)) + ` L${o.w - 2} ${o.h - 2} L2 ${o.h - 2} Z`;
      svg += `<path class="area" style="fill:url(#${id})" d="${areaD}"/>`;
    }
    svg += `<path d="${d}" style="stroke:${o.color}"/>`;
    svg += `<circle cx="${o.w - 2}" cy="${(o.h - 2 - ((values[values.length - 1] - min) / (max - min || 1)) * (o.h - 4)).toFixed(2)}" r="1.8" style="fill:${o.color}"/>`;
    svg += '</svg>';
    return svg;
  };

  // Multi-series line chart with grid, axis labels and hover marker.
  // opts: { w, h, series: [{values, color, label, fill}], yFormat, xLabels, yTicks, min, max }
  window.lineChart = function (opts) {
    const o = Object.assign({ w: 680, h: 168, yTicks: 4, yFormat: (v) => v }, opts);
    const padL = 44, padR = 10, padT = 8, padB = 20;
    const iw = o.w - padL - padR, ih = o.h - padT - padB;

    let min = o.min, max = o.max;
    if (min === undefined || max === undefined) {
      let lo = Infinity, hi = -Infinity;
      o.series.forEach((s) => s.values.forEach((v) => { if (v < lo) lo = v; if (v > hi) hi = v; }));
      if (min === undefined) min = lo;
      if (max === undefined) max = hi;
    }
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;

    const y = (v) => padT + ih - ((v - min) / span) * ih;
    const x = (i, n) => padL + (n > 1 ? (i / (n - 1)) * iw : iw / 2);

    let svg = `<svg class="chart-svg" viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none" data-w="${o.w}" data-h="${o.h}">`;

    // grid + y labels
    svg += '<g class="grid">';
    for (let t = 0; t <= o.yTicks; t++) {
      const v = min + (span * t) / o.yTicks;
      const yy = y(v).toFixed(1);
      svg += `<line x1="${padL}" x2="${o.w - padR}" y1="${yy}" y2="${yy}"/>`;
    }
    svg += '</g><g class="axis">';
    for (let t = 0; t <= o.yTicks; t++) {
      const v = min + (span * t) / o.yTicks;
      svg += `<text x="${padL - 7}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${o.yFormat(v)}</text>`;
    }
    if (o.xLabels) {
      o.xLabels.forEach((lbl, i) => {
        const xx = x(i, o.xLabels.length);
        const anchor = i === 0 ? 'start' : i === o.xLabels.length - 1 ? 'end' : 'middle';
        svg += `<text x="${xx.toFixed(1)}" y="${o.h - 5}" text-anchor="${anchor}">${lbl}</text>`;
      });
    }
    svg += '</g>';

    // series
    o.series.forEach((s, si) => {
      const d = s.values.map((v, i) => (i === 0 ? 'M' : 'L') + x(i, s.values.length).toFixed(2) + ' ' + y(v).toFixed(2)).join(' ');
      if (s.fill !== false) {
        const areaD = d + ` L${x(s.values.length - 1, s.values.length).toFixed(2)} ${(padT + ih)} L${padL} ${padT + ih} Z`;
        const gid = `g${si}${Math.random().toString(36).slice(2, 6)}`;
        svg += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${s.color}" stop-opacity=".22"/>
          <stop offset="100%" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>`;
        svg += `<path class="series-area" style="fill:url(#${gid})" d="${areaD}"/>`;
      }
      svg += `<path class="series" style="stroke:${s.color}" d="${d}"/>`;
    });

    // crosshair (hidden until hover)
    svg += `<g class="hover-layer" style="display:none">
      <line class="crosshair" y1="${padT}" y2="${padT + ih}" x1="0" x2="0"/>
    </g>`;

    // hit area
    svg += `<rect class="hit" x="${padL}" y="${padT}" width="${iw}" height="${ih}"/>`;
    svg += '</svg>';
    return svg;
  };

  // Wire hover on the last rendered chart inside `root`.
  window.attachChartHover = function (root, opts) {
    const svg = root.querySelector('.chart-svg');
    if (!svg) return;
    const tip = root.querySelector('.tooltip-chart');
    const cross = svg.querySelector('.hover-layer');
    const line = svg.querySelector('.crosshair');
    const n = opts.series[0].values.length;
    const W = +svg.dataset.w, H = +svg.dataset.h;
    const padL = 44, padR = 10;

    let lo = Infinity, hi = -Infinity;
    opts.series.forEach((s) => s.values.forEach((v) => { if (v < lo) lo = v; if (v > hi) hi = v; }));
    const min = opts.min !== undefined ? opts.min : lo;
    const max = opts.max !== undefined ? opts.max : hi;

    function move(ev) {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const t = Math.min(1, Math.max(0, (px - padL) / (W - padL - padR)));
      const i = Math.round(t * (n - 1));
      const cx = padL + (i / (n - 1)) * (W - padL - padR);
      cross.style.display = '';
      line.setAttribute('x1', cx);
      line.setAttribute('x2', cx);

      const xPct = (cx / W) * 100;
      tip.style.display = '';
      tip.style.left = xPct + '%';
      const topVal = Math.max.apply(null, opts.series.map((s) => s.values[i]));
      const yTop = ((H - 20 - ((topVal - min) / (max - min || 1)) * (H - 28)) / H) * 100;
      tip.style.top = Math.max(6, yTop - 2) + '%';
      if (opts.tooltip) {
        tip.innerHTML = opts.tooltip(i);
      }
    }
    function leave() {
      cross.style.display = 'none';
      tip.style.display = 'none';
    }
    svg.addEventListener('mousemove', move);
    svg.addEventListener('mouseleave', leave);
  };
})();
