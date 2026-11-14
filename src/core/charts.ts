/**
 * Dependency-free SVG charts. Everything is expressed through presentation
 * classes so themes can restyle lines, grids and fills without touching data.
 */

export interface Series {
  name: string;
  values: number[];
  /** CSS colour expression; themes may override via class when omitted. */
  color?: string;
  cls?: string;
  fill?: boolean;
  /** Draw against the right-hand scale (e.g. client counts next to ops). */
  axis?: "left" | "right";
}

let uid = 0;
const nextId = () => `g${(uid += 1)}`;

function extent(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return [0, 1];
  if (min === max) return [Math.max(0, min - 1), max + 1];
  return [min, max];
}

function linePath(values: number[], w: number, h: number, min: number, max: number, padX = 0, padY = 2): string {
  const n = values.length;
  if (n === 0) return "";
  const step = n > 1 ? (w - padX * 2) / (n - 1) : 0;
  const span = max - min || 1;
  let d = "";
  values.forEach((v, i) => {
    const x = padX + i * step;
    const y = h - padY - ((v - min) / span) * (h - padY * 2);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return d;
}

function areaPath(values: number[], w: number, h: number, min: number, max: number, padX = 0, padY = 2): string {
  const line = linePath(values, w, h, min, max, padX, padY);
  if (!line) return "";
  return `${line}L${w - padX} ${h}L${padX} ${h}Z`;
}

export interface SparkOptions {
  w?: number;
  h?: number;
  color?: string;
  cls?: string;
  area?: boolean;
  guide?: number | null;
  width?: number;
}

/** Compact trend line used inside KPI cells. */
export function sparkline(values: number[], options: SparkOptions = {}): string {
  const w = options.w ?? 140;
  const h = options.h ?? 36;
  const n = values.length;
  if (n < 2) {
    return `<svg class="spark is-empty ${options.cls ?? ""}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path class="spark-baseline" d="M0 ${h - 1}H${w}"/></svg>`;
  }
  const [min, max] = extent(values);
  const id = nextId();
  const stroke = options.color ? `stroke="${options.color}"` : "";
  const fill = options.color ?? "currentColor";
  const line = linePath(values, w, h, min, max, 1, 2);
  let out = `<svg class="spark ${options.cls ?? ""}" style="${options.width ? `width:${options.width}px` : ""}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">`;
  if (options.area !== false) {
    out += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${fill}" stop-opacity=".32"/><stop offset="100%" stop-color="${fill}" stop-opacity="0"/></linearGradient></defs>`;
    out += `<path class="spark-area" d="${areaPath(values, w, h, min, max, 1, 2)}" fill="url(#${id})"/>`;
  }
  if (options.guide != null) {
    const y = (h - 2 - ((options.guide - min) / (max - min || 1)) * (h - 4)).toFixed(1);
    out += `<line class="spark-guide" x1="0" x2="${w}" y1="${y}" y2="${y}"/>`;
  }
  out += `<path class="spark-line" d="${line}" ${stroke}/>`;
  const last = line.split(/[ML]/).filter(Boolean).pop();
  if (last) {
    const [x, y] = last.trim().split(" ");
    out += `<circle class="spark-dot" cx="${Number(x) - 1.2}" cy="${y}" r="2.2" ${options.color ? `fill="${options.color}"` : ""}/>`;
  }
  out += "</svg>";
  return out;
}

export interface LineChartOptions {
  series: Series[];
  height?: number;
  yTicks?: number;
  xLabels?: string[];
  showLegend?: boolean;
  legendExtra?: string;
  /** Index in the series to mark (an event onset or the inspected sample). */
  marker?: { index: number; label: string; tone?: "warn" | "err" | "focus" } | null;
}

/** Multi-series line chart with hover crosshair. */
export function lineChart(options: LineChartOptions): string {
  const series = options.series.filter((s) => s.values.length > 0);
  const h = options.height ?? 220;
  const w = 1000;
  const padL = 46;
  const padR = 14;
  const padT = 14;
  const padB = 26;
  // The svg is laid out at its own aspect, never stretched: a stretched plot
  // distorts every value it draws. Its height is the drawing height, so the
  // caller's box grows to include it rather than clipping it.
  const svgHeight = h;
  const all = series.flatMap((s) => s.values);
  if (all.length === 0) {
    return `<div class="chart-empty" style="height:${h}px">等待采样…</div>`;
  }
  const leftSeries = series.filter((s) => s.axis !== "right");
  const rightSeries = series.filter((s) => s.axis === "right");
  const scaleOf = (list: Series[], end: number): { min: number; max: number } => {
    const values = list.length ? list.flatMap((s) => s.values) : end === 1 ? [] : all;
    if (!values.length) return end === 1 ? { min: 0, max: 1 } : { min: 0, max: 1 };
    let [lo, hi] = extent(values);
    const nearZero = lo >= 0 && lo <= hi * 0.5;
    lo = nearZero ? 0 : lo - (hi - lo) * 0.12;
    return { min: lo, max: hi };
  };
  const left = scaleOf(leftSeries, 0);
  const right = rightSeries.length ? scaleOf(rightSeries, 1) : left;
  const ticks = options.yTicks ?? 4;
  const yOf = (scale: { min: number; max: number }, v: number) => {
    const span = scale.max - scale.min || 1;
    return padT + (1 - (v - scale.min) / span) * (h - padT - padB);
  };
  const y = (v: number) => yOf(left, v);
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i: number) => padL + (n > 1 ? (i * (w - padL - padR)) / (n - 1) : 0);

  let grid = "";
  const leftSpan = left.max - left.min || 1;
  for (let t = 0; t <= ticks; t += 1) {
    const value = left.min + (leftSpan * t) / ticks;
    const yy = y(value).toFixed(1);
    grid += `<line x1="${padL}" x2="${w - padR}" y1="${yy}" y2="${yy}" vector-effect="non-scaling-stroke"/>`;
    grid += `<text class="chart-tick" x="${padL - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${fmtTick(value)}</text>`;
  }
  grid = `<g class="chart-grid">${grid}</g>`;
  if (rightSeries.length) {
    const rightSpan = right.max - right.min || 1;
    for (let t = 0; t <= ticks; t += 1) {
      const value = right.min + (rightSpan * t) / ticks;
      const yy = yOf(right, value).toFixed(1);
      grid += `<text class="chart-tick" x="${w - padR + 8}" y="${yy}" text-anchor="start" dominant-baseline="middle">${fmtTick(value)}</text>`;
    }
  }

  let labels = "";
  // At most five x labels; more than that collides at any realistic width.
  const xLabels = options.xLabels ?? [];
  const every = Math.max(1, Math.ceil(xLabels.length / 5));
  if (xLabels.length) {
    xLabels.forEach((label, i) => {
      const isLast = i === xLabels.length - 1;
      if (!isLast && i % every !== 0) return;
      // Never print a label that would collide with the final one.
      if (!isLast && xLabels.length - 1 - i < every * 0.6) return;
      const xx = xLabels.length > 1 ? padL + (i * (w - padL - padR)) / (xLabels.length - 1) : padL;
      labels += `<text class="chart-tick" x="${xx.toFixed(1)}" y="${h - 6}" text-anchor="${i === 0 ? "start" : isLast ? "end" : "middle"}">${escapeXml(label)}</text>`;
    });
  }

  let paths = "";
  let dots = "";
  series.forEach((s, idx) => {
    const minS = s.axis === "right" ? right.min : left.min;
    const maxS = s.axis === "right" ? right.max : left.max;
    // Map each datum straight into the padded plot box. Parsing the string
    // that linePath produced was the source of a silent NaN regression.
    const span = maxS - minS || 1;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const point = (value: number, i: number) => {
      const px = padL + (s.values.length > 1 ? (i * plotW) / (s.values.length - 1) : 0);
      const py = padT + (1 - (value - minS) / span) * plotH;
      return `${i === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`;
    };
    const d = s.values.map(point).join("");
    const cls = `chart-line chart-line-${idx}${s.cls ? ` ${s.cls}` : ""}`;
    const stroke = s.color ? `stroke="${s.color}"` : "";
    // Tooltip values keep the unit of the series; ticks are abbreviated.
    const values = s.values.map((v) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "—")).join(",");
    if (s.fill) {
      const first = x(0);
      const lastX = x(s.values.length - 1);
      // The line path ends at the last datum; close it down to the baseline and back.
      paths += `<path class="chart-area" d="${d}L${lastX.toFixed(2)} ${(h - padB).toFixed(2)}L${first.toFixed(2)} ${(h - padB).toFixed(2)}Z" ${s.color ? `fill="${s.color}"` : ""}/>`;
    }
    paths += `<path class="${cls}" d="${d}" ${stroke} data-values="${values}"/>`;
    const lastValue = s.values[s.values.length - 1];
    if (lastValue != null && Number.isFinite(lastValue)) {
      const dotY = s.axis === "right" ? yOf(right, lastValue) : y(lastValue);
      dots += `<circle class="chart-dot chart-dot-${idx}" cx="${x(s.values.length - 1).toFixed(1)}" cy="${dotY.toFixed(1)}" r="2.6" ${s.color ? `fill="${s.color}"` : ""}/>`;
    }
  });

  // Axis label: the marker's own caption sits at its line, inside the plot.
  const markerLabel = options.marker && options.marker.index >= 0 && options.marker.index < n
    ? `<text class="chart-marker-label" x="${Math.min(w - padR - 4, x(options.marker.index) + 6).toFixed(1)}" y="${padT + 8}" text-anchor="${x(options.marker.index) > w - padR - 160 ? "end" : "start"}">${escapeXml(options.marker!.label)}</text>`
    : "";

  const legend = options.showLegend === false
    ? ""
    : `<div class="chart-legend">${series
        .map((s, idx) => `<span class="legend-item"><i class="legend-swatch legend-${idx}"${s.color ? ` style="background:${s.color}"` : ""}></i>${escapeXml(s.name)}</span>`)
        .join("")}${options.legendExtra ? `<span class="legend-extra">${options.legendExtra}</span>` : ""}</div>`;

  let marker = "";
  if (options.marker && options.marker.index >= 0 && options.marker.index < n) {
    const mx = x(options.marker.index).toFixed(1);
    const tone = options.marker.tone === "err" ? "err" : options.marker.tone === "focus" ? "focus" : "warn";
    marker = `<line class="chart-marker ${tone}" x1="${mx}" x2="${mx}" y1="${padT}" y2="${h - padB}" vector-effect="non-scaling-stroke"/>
      <circle class="chart-marker-dot ${tone}" cx="${mx}" cy="${padT + 3}" r="2.4"/>`;
  }

  return `<div class="chart" data-crosshair data-points="${n}" data-labels="${escapeXml(xLabels.join("|"))}">
    <svg class="chart-svg" viewBox="0 0 ${w} ${h}" style="height:${svgHeight}px" role="img">
      ${grid}${labels}
      <line class="chart-cross" x1="${padL}" x2="${padL}" y1="${padT}" y2="${h - padB}" visibility="hidden" vector-effect="non-scaling-stroke"/>
      ${paths}${marker}${markerLabel}${dots}
      <rect class="chart-hit" x="${padL}" y="${padT}" width="${w - padL - padR}" height="${h - padT - padB}" fill="transparent"/>
    </svg>
    <div class="chart-tip" hidden></div>
    ${legend}
  </div>`;
}

function fmtTick(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${v >= 1e5 ? (v / 1e3).toFixed(0) : (v / 1e3).toFixed(1)}k`;
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

function escapeXml(value: string): string {
  return value.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch] ?? ch);
}

/** Detaches the hover controller once after a render pass. */
export function bindCharts(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("[data-crosshair]").forEach((el) => {
    const svg = el.querySelector<SVGSVGElement>(".chart-svg");
    const hit = el.querySelector<SVGRectElement>(".chart-hit");
    const cross = el.querySelector<SVGLineElement>(".chart-cross");
    const tip = el.querySelector<HTMLElement>(".chart-tip");
    if (!svg || !hit || !cross || !tip) return;
    const points = Number(el.dataset.points || 0);
    const labels = (el.dataset.labels || "").split("|");
    const names = Array.from(el.querySelectorAll<HTMLElement>(".legend-item")).map((n) => n.textContent?.trim() ?? "");
    const lines = Array.from(el.querySelectorAll<SVGPathElement>(".chart-line"));
    const vb = svg.viewBox.baseVal;

    hit.addEventListener("pointermove", (event) => {
      const rect = svg.getBoundingClientRect();
      const px = ((event.clientX - rect.left) / rect.width) * vb.width;
      const padL = 46;
      const padR = 14;
      const idx = Math.round(((px - padL) / (vb.width - padL - padR)) * Math.max(1, points - 1));
      const i = Math.max(0, Math.min(points - 1, idx));
      const xx = padL + (points > 1 ? (i * (vb.width - padL - padR)) / (points - 1) : 0);
      cross.setAttribute("x1", String(xx));
      cross.setAttribute("x2", String(xx));
      cross.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.innerHTML = `<div class="tip-title">${labels[i] ?? `#${i + 1}`}</div>${lines
        .map((line, li) => `<div class="tip-row"><i class="legend-swatch legend-${li}"></i><span>${names[li] ?? ""}</span><b>${sampleAt(line, points, i)}</b></div>`)
        .join("")}`;
      const box = el.getBoundingClientRect();
      const left = (xx / vb.width) * box.width;
      tip.style.transform = `translateX(${Math.min(box.width - 150, Math.max(8, left + 12))}px)`;
    });
    hit.addEventListener("pointerleave", () => {
      cross.setAttribute("visibility", "hidden");
      tip.hidden = true;
    });
  });
}

function sampleAt(path: SVGPathElement, points: number, index: number): string {
  const d = path.getAttribute("d") ?? "";
  const pts = d.split(/(?=[ML])/).map((seg) => seg.slice(1).trim().split(" ").map(Number));
  const hit = pts[index];
  if (!hit || !Number.isFinite(hit[1])) return "—";
  // invert the y mapping is theme independent: the tooltip shows the original
  // value through the data-value stash below.
  return path.dataset.values ? (path.dataset.values.split(",")[index] ?? "—") : hit[1]!.toFixed(1);
}
