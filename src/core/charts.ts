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
    grid += `<line class="chart-grid" x1="${padL}" x2="${w - padR}" y1="${yy}" y2="${yy}"/>`;
    grid += `<text class="chart-tick" x="${padL - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${fmtTick(value)}</text>`;
  }
  if (rightSeries.length) {
    const rightSpan = right.max - right.min || 1;
    for (let t = 0; t <= ticks; t += 1) {
      const value = right.min + (rightSpan * t) / ticks;
      const yy = yOf(right, value).toFixed(1);
      grid += `<text class="chart-tick" x="${w - padR + 8}" y="${yy}" text-anchor="start" dominant-baseline="middle">${fmtTick(value)}</text>`;
    }
  }

  let labels = "";
  const xLabels = options.xLabels ?? [];
  if (xLabels.length) {
    xLabels.forEach((label, i) => {
      const xx = xLabels.length > 1 ? padL + (i * (w - padL - padR)) / (xLabels.length - 1) : padL;
      labels += `<text class="chart-tick" x="${xx.toFixed(1)}" y="${h - 6}" text-anchor="${i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}">${escapeXml(label)}</text>`;
    });
  }

  let paths = "";
  let dots = "";
  series.forEach((s, idx) => {
    const minS = s.axis === "right" ? right.min : left.min;
    const maxS = s.axis === "right" ? right.max : left.max;
    const d = linePath(s.values, w, h, minS, maxS, 0, 0)
      .split(/(?=[ML])/)
      .map((seg) => {
        const [cmd, ...rest] = seg.split(" ");
        const [px, py] = (rest[0] ?? "").split(" ");
        const nx = ((Number(px) - 0) * (w - padL - padR)) / w + padL;
        const ny = ((Number(py) - 0) * (h - padT - padB)) / h + padT;
        return `${cmd}${nx.toFixed(2)} ${ny.toFixed(2)}`;
      })
      .join("");
    const cls = `chart-line chart-line-${idx}${s.cls ? ` ${s.cls}` : ""}`;
    const stroke = s.color ? `stroke="${s.color}"` : "";
    const values = s.values.map((v) => fmtTick(v)).join(",");
    if (s.fill) {
      const id = nextId();
      const first = x(0);
      const lastX = x(s.values.length - 1);
      paths += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${s.color ?? "currentColor"}" stop-opacity=".28"/><stop offset="100%" stop-color="${s.color ?? "currentColor"}" stop-opacity="0"/></linearGradient></defs><path class="chart-area" d="${d.replace(/^M[\d.]+ [\d.]+/, `M${first.toFixed(2)} ${(h - padB).toFixed(2)}`)}L${lastX.toFixed(2)} ${(h - padB).toFixed(2)}Z" fill="url(#${id})"/>`;
    }
    paths += `<path class="${cls}" d="${d}" ${stroke} data-values="${values}"/>`;
    const lastValue = s.values[s.values.length - 1];
    if (lastValue != null && Number.isFinite(lastValue)) {
      const dotY = s.axis === "right" ? yOf(right, lastValue) : y(lastValue);
      dots += `<circle class="chart-dot chart-dot-${idx}" cx="${x(s.values.length - 1).toFixed(1)}" cy="${dotY.toFixed(1)}" r="2.6" ${s.color ? `fill="${s.color}"` : ""}/>`;
    }
  });

  const legend = options.showLegend === false
    ? ""
    : `<div class="chart-legend">${series
        .map((s, idx) => `<span class="legend-item"><i class="legend-swatch legend-${idx}"${s.color ? ` style="background:${s.color}"` : ""}></i>${escapeXml(s.name)}</span>`)
        .join("")}${options.legendExtra ? `<span class="legend-extra">${options.legendExtra}</span>` : ""}</div>`;

  return `<div class="chart" data-crosshair data-points="${n}" data-labels="${escapeXml(xLabels.join("|"))}">
    <svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img">
      ${grid}${labels}
      <line class="chart-cross" x1="${padL}" x2="${padL}" y1="${padT}" y2="${h - padB}" visibility="hidden"/>
      ${paths}${dots}
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

/** ASCII bar for terminal theme (no SVG needed). */
export function asciiBar(value: number, max: number, width = 16): string {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
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
