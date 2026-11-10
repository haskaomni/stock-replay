export type ThemeName = "light" | "dark";

interface Theme {
  bg: string;
  fg: string;
  muted: string;
  grid: string;
  axis: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  light: { bg: "#ffffff", fg: "#111827", muted: "#6b7280", grid: "#eceef2", axis: "#111827" },
  dark: { bg: "#0b0f17", fg: "#f3f4f6", muted: "#8b94a7", grid: "#1c2433", axis: "#cbd5e1" },
};

export const PALETTE = ["#e53e3e", "#1d4ed8", "#16a34a", "#f59e0b", "#9333ea", "#0891b2", "#db2777", "#65a30d"];

export interface Frame {
  ms: number[]; // timestamps of every point
  dates: string[];
  tickers: string[];
  labels: Record<string, string>;
  values: Record<string, number[]>; // already converted to $ value of the investment
  colors: Record<string, string>;
  /** fractional index into dates (0 .. n-1) */
  p: number;
  log: boolean;
  theme: ThemeName;
  invested: number;
  watermark: string;
}

/** Smoothed y-axis state, so the scale eases instead of jumping. */
export class View {
  yMin = 0;
  yMax = 1;
  ready = false;
  reset() {
    this.ready = false;
  }
}

const FONT = `system-ui, -apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`;

export function fmtMoney(v: number): string {
  if (v >= 1e7) return `$${(v / 1e6).toFixed(1)}M`;
  return "$" + Math.round(v).toLocaleString("en-US");
}

function fmtAxis(v: number): string {
  if (v >= 1e6) return `$${+(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${+(v / 1e3).toFixed(1)}K`;
  return `$${+v.toFixed(v < 10 ? 2 : 0)}`;
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${m} ${String(d.getUTCDate()).padStart(2, "0")}, ${d.getUTCFullYear()}`;
}

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

function linearTicks(min: number, max: number): number[] {
  const step = niceStep(max - min, 5);
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

function logTicks(min: number, max: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= min && v <= max) out.push(v);
    }
  }
  return out.length > 8 ? out.filter((v) => /^[15]/.test(String(v / 10 ** Math.floor(Math.log10(v))))) : out;
}

function timeTicks(t0: number, t1: number): { ms: number; label: string }[] {
  const years = (t1 - t0) / (365.25 * 86400000);
  const start = new Date(t0);
  const out: { ms: number; label: string }[] = [];
  if (years >= 2.5) {
    const step = Math.max(1, Math.ceil(years / 6));
    for (let y = start.getUTCFullYear() + 1; ; y += step) {
      const ms = Date.UTC(y, 0, 1);
      if (ms > t1) break;
      out.push({ ms, label: String(y) });
    }
  } else {
    const step = years >= 1 ? 3 : years >= 0.5 ? 2 : 1;
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth() + 1;
    for (;;) {
      const ms = Date.UTC(y, m, 1);
      if (ms > t1) break;
      const d = new Date(ms);
      if (d.getUTCMonth() % step === 0)
        out.push({ ms, label: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` });
      m++;
      if (m > 11) (m = 0), y++;
    }
  }
  return out;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  f: Frame,
  view: View,
  snap: boolean,
) {
  const th = THEMES[f.theme];
  const s = Math.min(W, H) / 720;
  const n = f.ms.length;
  const p = Math.max(0, Math.min(n - 1, f.p));
  const i0 = Math.floor(p);
  const i1 = Math.min(n - 1, i0 + 1);
  const frac = p - i0;
  const headMs = f.ms[i0] + (f.ms[i1] - f.ms[i0]) * frac;
  const head = (t: string) => {
    const v = f.values[t];
    return v[i0] + (v[i1] - v[i0]) * frac;
  };

  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);

  // ---------- layout ----------
  const landscape = W >= H;
  const cnt = f.tickers.length;
  const cols = Math.min(cnt, landscape ? 4 : 2);
  const rows = Math.ceil(cnt / cols);
  const cardH = (cols >= 3 ? 112 : 124) * s;
  const footerH = rows * cardH + 16 * s;
  const headerH = 82 * s;
  const leftM = 96 * s;
  const bottomM = 46 * s;

  // right margin sized to the longest end label
  ctx.font = `700 ${20 * s}px ${FONT}`;
  let labelW = 0;
  for (const t of f.tickers) {
    const last = f.values[t][n - 1];
    labelW = Math.max(labelW, ctx.measureText(`${f.labels[t]} ${fmtMoney(Math.max(last, f.invested * 10))}`).width);
  }
  const rightM = Math.min(W * 0.32, labelW + 34 * s);

  const px0 = leftM;
  const px1 = W - rightM;
  const py0 = headerH;
  const py1 = H - footerH - bottomM;

  // ---------- header ----------
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.fillStyle = th.fg;
  ctx.font = `800 ${38 * s}px ${FONT}`;
  const dateStr = fmtDate(headMs);
  const dw = ctx.measureText(dateStr).width;
  ctx.fillText(dateStr, W / 2 - 28 * s, headerH - 28 * s);
  ctx.fillStyle = th.muted;
  ctx.font = `600 ${24 * s}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("• USD", W / 2 - 28 * s + dw / 2 + 14 * s, headerH - 28 * s);

  // ---------- y scale (smoothed) ----------
  let vmax = f.invested;
  let vmin = f.invested;
  for (const t of f.tickers) {
    const v = f.values[t];
    for (let i = 0; i <= i0; i++) {
      if (v[i] > vmax) vmax = v[i];
      if (v[i] < vmin) vmin = v[i];
    }
    const h = head(t);
    if (h > vmax) vmax = h;
    if (h < vmin) vmin = h;
  }
  let tMax: number, tMin: number;
  if (f.log) {
    tMax = Math.log10(vmax * 1.25);
    tMin = Math.log10(Math.max(vmin * 0.8, 1e-6));
    if (tMax - tMin < 0.5) tMax = tMin + 0.5;
  } else {
    tMax = vmax * 1.1;
    tMin = 0;
  }
  if (!view.ready || snap) {
    view.yMax = tMax;
    view.yMin = tMin;
    view.ready = true;
  } else {
    view.yMax += (tMax - view.yMax) * 0.14;
    view.yMin += (tMin - view.yMin) * 0.14;
  }
  const yScaleMax = view.yMax;
  const yScaleMin = view.yMin;
  const yOf = (v: number) => {
    const t = f.log ? Math.log10(Math.max(v, 1e-6)) : v;
    return py1 - ((t - yScaleMin) / (yScaleMax - yScaleMin)) * (py1 - py0);
  };
  const t0 = f.ms[0];
  const t1 = f.ms[n - 1];
  const xOf = (ms: number) => px0 + ((ms - t0) / (t1 - t0)) * (px1 - px0);

  // ---------- grid + y axis ----------
  const dataMin = f.log ? 10 ** yScaleMin : yScaleMin;
  const dataMax = f.log ? 10 ** yScaleMax : yScaleMax;
  const yt = f.log ? logTicks(dataMin, dataMax) : linearTicks(dataMin, dataMax);
  ctx.font = `500 ${20 * s}px ${FONT}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const v of yt) {
    const y = yOf(v);
    if (y < py0 - 2 || y > py1 + 2) continue;
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(px0, y);
    ctx.lineTo(px1, y);
    ctx.stroke();
    ctx.fillStyle = th.muted;
    ctx.fillText(fmtAxis(v), px0 - 14 * s, y);
  }

  // ---------- x axis ----------
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const tk of timeTicks(t0, t1)) {
    const x = xOf(tk.ms);
    ctx.strokeStyle = th.axis;
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(x, py1);
    ctx.lineTo(x, py1 + 8 * s);
    ctx.stroke();
    ctx.fillStyle = th.muted;
    ctx.fillText(tk.label, x, py1 + 14 * s);
  }
  ctx.strokeStyle = th.axis;
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(px0, py0 - 10 * s);
  ctx.lineTo(px0, py1);
  ctx.lineTo(px1 + 6 * s, py1);
  ctx.stroke();

  // ---------- watermark ----------
  if (f.watermark) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = th.muted;
    ctx.font = `italic 600 ${30 * s}px ${FONT}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(f.watermark, px1 - 8 * s, py1 - 14 * s);
    ctx.restore();
  }

  // ---------- lines ----------
  ctx.save();
  ctx.beginPath();
  ctx.rect(px0, py0 - 20 * s, px1 - px0 + 12 * s, py1 - py0 + 30 * s);
  ctx.clip();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 4 * s;
  const heads: { t: string; x: number; y: number; v: number }[] = [];
  const stride = Math.max(1, Math.floor(i0 / ((px1 - px0) * 1.5)));
  for (const t of f.tickers) {
    const v = f.values[t];
    ctx.strokeStyle = f.colors[t];
    ctx.beginPath();
    ctx.moveTo(xOf(f.ms[0]), yOf(v[0]));
    for (let i = stride; i <= i0; i += stride) ctx.lineTo(xOf(f.ms[i]), yOf(v[i]));
    const hv = head(t);
    const hx = xOf(headMs);
    const hy = yOf(hv);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    heads.push({ t, x: hx, y: hy, v: hv });
  }
  ctx.restore();

  // head dots
  for (const h of heads) {
    ctx.fillStyle = f.colors[h.t];
    ctx.beginPath();
    ctx.arc(h.x, h.y, 7.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = th.bg;
    ctx.lineWidth = 2.5 * s;
    ctx.stroke();
  }

  // end labels with simple collision avoidance
  const fs = 20 * s;
  const gap = fs * 1.35;
  const sorted = [...heads].sort((a, b) => a.y - b.y);
  const ly: number[] = sorted.map((h) => Math.max(py0, Math.min(py1, h.y)));
  for (let i = 1; i < ly.length; i++) if (ly[i] - ly[i - 1] < gap) ly[i] = ly[i - 1] + gap;
  for (let i = ly.length - 2; i >= 0; i--) if (ly[i + 1] > py1 + gap && ly[i + 1] - ly[i] < gap) ly[i] = ly[i + 1] - gap;
  ctx.font = `700 ${fs}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  sorted.forEach((h, i) => {
    ctx.fillStyle = f.colors[h.t];
    ctx.fillText(`${f.labels[h.t]} ${fmtMoney(h.v)}`, Math.min(h.x + 16 * s, W - labelW - 8 * s), ly[i]);
  });

  // ---------- footer cards ----------
  const cardW = W / cols;
  f.tickers.forEach((t, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inRow = r === rows - 1 ? cnt - r * cols : cols; // center the last partial row
    const x = c * cardW + ((cols - inRow) * cardW) / 2 + cardW / 2;
    const y = H - footerH + r * cardH + 8 * s;
    const hv = head(t);
    const pct = (hv / f.invested - 1) * 100;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = f.colors[t];
    ctx.font = `700 ${22 * s}px ${FONT}`;
    ctx.fillText(f.labels[t], x, y + 24 * s);
    let big = (cols >= 3 ? 54 : 64) * s;
    const txt = fmtMoney(hv);
    ctx.font = `800 ${big}px ${FONT}`;
    const maxW = cardW * 0.88;
    const w = ctx.measureText(txt).width;
    if (w > maxW) {
      big *= maxW / w;
      ctx.font = `800 ${big}px ${FONT}`;
    }
    ctx.fillText(txt, x, y + 24 * s + big * 0.98);
    ctx.fillStyle = th.muted;
    ctx.font = `600 ${18 * s}px ${FONT}`;
    ctx.fillText(
      `${fmtMoney(f.invested)} invested · ${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`,
      x,
      y + 24 * s + big * 0.98 + 26 * s,
    );
  });
}
