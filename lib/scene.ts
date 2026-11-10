import { labelOf } from "./labels";
import type { HistoryResponse } from "./types";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
export type StyleName = "neon" | "aurora" | "paper";
export type Lang = "zh" | "en";

interface Style {
  label: string;
  dark: boolean;
  bg: [string, string];
  blobs: string[];
  fg: string;
  muted: string;
  grid: string;
  panel: string;
  accent: string;
  onColor: string; // text drawn on top of a series color
  up: string;
  down: string;
  palette: string[];
}

export const STYLES: Record<StyleName, Style> = {
  neon: {
    label: "霓虹夜",
    dark: true,
    bg: ["#04050d", "#0a0f2c"],
    blobs: ["#4c1d95", "#0e5fa8"],
    fg: "#f5f7ff",
    muted: "#8c96b8",
    grid: "rgba(255,255,255,0.07)",
    panel: "rgba(255,255,255,0.07)",
    accent: "#fde047",
    onColor: "#05060f",
    up: "#34d399",
    down: "#fb7185",
    palette: ["#ff3d71", "#22d3ee", "#a3e635", "#fbbf24", "#c084fc", "#fb923c", "#2dd4bf", "#f472b6"],
  },
  aurora: {
    label: "极光",
    dark: true,
    bg: ["#021313", "#150a2a"],
    blobs: ["#0f766e", "#6d28d9"],
    fg: "#f0fdfa",
    muted: "#8fb3b0",
    grid: "rgba(255,255,255,0.07)",
    panel: "rgba(255,255,255,0.07)",
    accent: "#5eead4",
    onColor: "#031313",
    up: "#4ade80",
    down: "#fb7185",
    palette: ["#5eead4", "#f0abfc", "#fde047", "#60a5fa", "#fb7185", "#a3e635", "#fdba74", "#c4b5fd"],
  },
  paper: {
    label: "纸白",
    dark: false,
    bg: ["#ffffff", "#eef1f6"],
    blobs: [],
    fg: "#0f172a",
    muted: "#64748b",
    grid: "rgba(15,23,42,0.08)",
    panel: "rgba(15,23,42,0.06)",
    accent: "#dc2626",
    onColor: "#ffffff",
    up: "#059669",
    down: "#dc2626",
    palette: ["#e53e3e", "#1d4ed8", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777", "#65a30d"],
  },
};

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
export const INTRO_MS = 2400;
export const OUTRO_MS = 4600;

export interface Ev {
  idx: number;
  kind: "lead" | "mile" | "half";
  ticker: string;
  other?: string;
  mult?: number;
}

export interface Scene {
  ms: number[];
  tickers: string[];
  labels: Record<string, string>;
  values: Record<string, number[]>;
  colors: Record<string, string>;
  invested: number;
  log: boolean;
  style: StyleName;
  lang: Lang;
  watermark: string;
  title: string;
  raceMs: number;
  events: Ev[];
  finalRank: string[];
}

export const totalMs = (sc: Scene) => INTRO_MS + sc.raceMs + OUTRO_MS;

const MULTS = [2, 3, 5, 10, 20, 50, 100, 200, 500, 1000];

export function buildScene(
  data: HistoryResponse,
  o: {
    invested: number;
    log: boolean;
    style: StyleName;
    lang: Lang;
    watermark: string;
    title: string;
    raceMs: number;
  },
): Scene {
  const tickers = Object.keys(data.series);
  const n = data.dates.length;
  const values: Record<string, number[]> = {};
  const colors: Record<string, string> = {};
  const labels: Record<string, string> = {};
  const pal = STYLES[o.style].palette;
  tickers.forEach((t, i) => {
    const s = data.series[t];
    values[t] = s.map((v) => (o.invested * v) / s[0]);
    colors[t] = pal[i % pal.length];
    labels[t] = labelOf(t);
  });

  // --- raw events ---
  const leads: Ev[] = [];
  const miles: Ev[] = [];
  if (tickers.length > 1) {
    let leader = "";
    const warm = Math.floor(n * 0.04);
    for (let i = warm; i < n; i++) {
      let best = tickers[0];
      for (const t of tickers) if (values[t][i] > values[best][i]) best = t;
      if (!leader) leader = best;
      else if (best !== leader && values[best][i] > values[leader][i] * 1.015) {
        leads.push({ idx: i, kind: "lead", ticker: best, other: leader });
        leader = best;
      }
    }
  }
  for (const t of tickers) {
    let next = 0;
    let halved = false;
    for (let i = 1; i < n; i++) {
      const r = values[t][i] / o.invested;
      let hit = -1;
      while (next < MULTS.length && r >= MULTS[next]) hit = next++;
      if (hit >= 0) miles.push({ idx: i, kind: "mile", ticker: t, mult: MULTS[hit] });
      if (!halved && r <= 0.5) {
        halved = true;
        miles.push({ idx: i, kind: "half", ticker: t });
      }
    }
  }
  // --- keep events at least 1.5s apart on screen; lead changes win ---
  const gap = (1500 / o.raceMs) * (n - 1);
  const kept: Ev[] = [];
  const far = (e: Ev) => kept.every((k) => Math.abs(k.idx - e.idx) >= gap);
  for (const e of leads) if (far(e)) kept.push(e);
  for (const e of miles.sort((a, b) => (b.mult ?? 0) - (a.mult ?? 0))) if (far(e)) kept.push(e);
  kept.sort((a, b) => a.idx - b.idx);

  const finalRank = [...tickers].sort((a, b) => values[b][n - 1] - values[a][n - 1]);

  return {
    ms: data.dates.map((d) => Date.parse(d + "T00:00:00Z")),
    tickers,
    labels,
    values,
    colors,
    invested: o.invested,
    log: o.log,
    style: o.style,
    lang: o.lang,
    watermark: o.watermark,
    title: o.title,
    raceMs: o.raceMs,
    events: kept,
    finalRank,
  };
}

/** Smoothed, time-based view state (y-range and leaderboard slots). */
export class View {
  yMin = 0;
  yMax = 1;
  ready = false;
  lastT = -1;
  rank: Record<string, number> = {};
  order: string[] = [];
  reset() {
    this.ready = false;
    this.lastT = -1;
    this.rank = {};
    this.order = [];
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const FONT = `"Inter", system-ui, -apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`;
const font = (w: number, px: number) => `${w} ${px}px ${FONT}`;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
const easeOutBack = (x: number) => {
  const c = 1.9;
  const y = clamp01(x) - 1;
  return 1 + (c + 1) * y ** 3 + c * y ** 2;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hexA(hex: string, a: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

export function fmtMoney(v: number): string {
  if (v >= 1e7) return `$${(v / 1e6).toFixed(1)}M`;
  return "$" + Math.round(v).toLocaleString("en-US");
}
function fmtPct(r: number): string {
  const p = (r - 1) * 100;
  const a = Math.abs(p);
  return `${p >= 0 ? "+" : "−"}${a >= 1000 ? Math.round(a).toLocaleString("en-US") : a.toFixed(a < 100 ? 1 : 0)}%`;
}
function fmtAxis(v: number): string {
  if (v >= 1e6) return `$${+(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${+(v / 1e3).toFixed(1)}K`;
  return `$${+v.toFixed(v < 10 ? 2 : 0)}`;
}
function fmtDate(ms: number, lang: Lang): string {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  if (lang === "zh") return `${d.getUTCFullYear()}年${String(d.getUTCMonth() + 1).padStart(2, "0")}月${dd}日`;
  return `${MONTHS[d.getUTCMonth()]} ${dd}, ${d.getUTCFullYear()}`;
}
function fmtMonth(ms: number, lang: Lang): string {
  const d = new Date(ms);
  return lang === "zh" ? `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月` : `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
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
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++)
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= min && v <= max) out.push(v);
    }
  return out.length > 7 ? out.filter((v) => Math.abs(Math.log10(v) % 1) < 1e-9) : out;
}
function timeTicks(t0: number, t1: number, lang: Lang): { ms: number; label: string }[] {
  const years = (t1 - t0) / (365.25 * 86400000);
  const start = new Date(t0);
  const out: { ms: number; label: string }[] = [];
  if (years >= 2) {
    const step = Math.max(1, Math.ceil(years / 6));
    for (let y = start.getUTCFullYear() + 1; ; y += step) {
      const ms = Date.UTC(y, 0, 1);
      if (ms > t1) break;
      out.push({ ms, label: String(y) });
    }
  } else {
    const step = years >= 1 ? 3 : years >= 0.4 ? 2 : 1;
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth() + 1;
    for (;;) {
      const ms = Date.UTC(y, m, 1);
      if (ms > t1) break;
      const d = new Date(ms);
      if (d.getUTCMonth() % step === 0)
        out.push({
          ms,
          label: lang === "zh" ? `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}` : `${MONTHS[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}`,
        });
      if (++m > 11) (m = 0), y++;
    }
  }
  return out;
}

/** set the largest font ≤ px that makes `text` fit in maxW; returns px used */
function fit(ctx: CanvasRenderingContext2D, text: string, weight: number, px: number, maxW: number): number {
  ctx.font = font(weight, px);
  const w = ctx.measureText(text).width;
  if (w > maxW) {
    px *= maxW / w;
    ctx.font = font(weight, px);
  }
  return px;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function crown(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  const w = size;
  const h = size * 0.72;
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + h * 0.18);
  ctx.lineTo(x + w * 0.27, y + h * 0.55);
  ctx.lineTo(x + w * 0.5, y);
  ctx.lineTo(x + w * 0.73, y + h * 0.55);
  ctx.lineTo(x + w, y + h * 0.18);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

const rnd = (i: number) => {
  let x = (i + 1) * 0x9e3779b1;
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  return ((x >>> 0) % 100000) / 100000;
};

const TXT = {
  zh: {
    ifIn: (m: string) => `如果在 ${m}`,
    investEach: (a: string, many: boolean) => (many ? `各投入 ${a}` : `投入 ${a}`),
    who: (many: boolean) => (many ? "谁是最后的赢家？" : "现在值多少？"),
    hook: (a: string, m: string, many: boolean) => (many ? `${m} 各投入 ${a}，谁赢？` : `${m} 投入 ${a}，现在值多少？`),
    lead: (a: string, b: string) => `${a} 反超 ${b}，升至第一`,
    mile: (a: string, m: number) => (m === 2 ? `${a} 翻倍了` : `${a} 涨到 ${m} 倍`),
    half: (a: string) => `${a} 腰斩 −50%`,
    winner: "冠军",
    result: "最终结果",
    cagr: "年化",
    principal: "本金",
  },
  en: {
    ifIn: (m: string) => `What if in ${m}`,
    investEach: (a: string, many: boolean) => (many ? `you put ${a} into each` : `you invested ${a}`),
    who: (many: boolean) => (many ? "Who wins?" : "What's it worth now?"),
    hook: (a: string, m: string, many: boolean) => (many ? `${a} each since ${m} — who wins?` : `${a} invested in ${m}`),
    lead: (a: string, b: string) => `${a} overtakes ${b}`,
    mile: (a: string, m: number) => `${a} hits ${m}×`,
    half: (a: string) => `${a} down −50%`,
    winner: "WINNER",
    result: "FINAL RESULT",
    cagr: "CAGR",
    principal: "Start",
  },
};

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------
function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, sc: Scene, t: number) {
  const st = STYLES[sc.style];
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, st.bg[0]);
  g.addColorStop(1, st.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  st.blobs.forEach((c, i) => {
    const a = t / 9000 + i * 2.4;
    const x = W * (0.5 + 0.38 * Math.cos(a));
    const y = H * (0.45 + 0.35 * Math.sin(a * 1.3));
    const r = Math.max(W, H) * 0.55;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, hexA(c, 0.34));
    rg.addColorStop(1, hexA(c, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  });
}

function drawRace(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  sc: Scene,
  p: number,
  t: number,
  view: View,
  dt: number,
  hard: boolean,
  afterMs = 0,
) {
  const st = STYLES[sc.style];
  const L = TXT[sc.lang];
  const s = Math.min(W, H) / 720;
  const n = sc.ms.length;
  const cnt = sc.tickers.length;
  const i0 = Math.floor(p);
  const i1 = Math.min(n - 1, i0 + 1);
  const frac = p - i0;
  const headMs = sc.ms[i0] + (sc.ms[i1] - sc.ms[i0]) * frac;
  const head = (tk: string) => {
    const v = sc.values[tk];
    return v[i0] + (v[i1] - v[i0]) * frac;
  };
  const heads = sc.tickers.map((tk) => ({ tk, v: head(tk) })).sort((a, b) => b.v - a.v);
  const leader = heads[0].tk;

  // ---------- layout ----------
  const wide = W / H > 1.2;
  const pad = 28 * s;
  const headerH = 124 * s;
  let cx0: number, cx1: number, cy0: number, cy1: number, bx0: number, bx1: number, by0: number, rowH: number;
  if (wide) {
    cx0 = pad + 70 * s;
    cx1 = W * 0.655;
    cy0 = headerH;
    cy1 = H - 62 * s;
    bx0 = W * 0.695;
    bx1 = W - pad;
    by0 = headerH - 6 * s;
    rowH = Math.min(78 * s, (H - 36 * s - by0) / cnt);
  } else {
    rowH = Math.min(62 * s, (H * 0.37) / cnt);
    by0 = H - 30 * s - rowH * cnt;
    bx0 = pad;
    bx1 = W - pad;
    cx0 = pad + 70 * s;
    cx1 = W - pad;
    cy0 = headerH;
    cy1 = by0 - 62 * s;
  }

  // ---------- header ----------
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const hook = sc.title || L.hook(fmtMoney(sc.invested), fmtMonth(sc.ms[0], sc.lang), cnt > 1);
  ctx.fillStyle = st.muted;
  const wmW = sc.watermark ? (ctx.font = font(700, 22 * s), ctx.measureText(sc.watermark).width + 20 * s) : 0;
  fit(ctx, hook, 600, 25 * s, W - pad * 2 - wmW);
  ctx.fillText(hook, pad, 46 * s);
  ctx.fillStyle = st.fg;
  ctx.font = font(800, 50 * s);
  ctx.fillText(fmtDate(headMs, sc.lang), pad, 102 * s);
  if (sc.watermark) {
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(st.dark ? "#ffffff" : "#0f172a", 0.55);
    ctx.font = font(700, 22 * s);
    ctx.fillText(sc.watermark, W - pad, 46 * s);
  }

  // ---------- scales ----------
  ctx.font = font(800, 21 * s);
  let labelW = 0;
  for (const tk of sc.tickers) labelW = Math.max(labelW, ctx.measureText(sc.labels[tk]).width);
  const px0 = cx0;
  const px1 = cx1 - labelW - 34 * s;
  const py0 = cy0 + 30 * s;
  const py1 = cy1;

  let vmax = sc.invested;
  let vmin = sc.invested;
  for (const tk of sc.tickers) {
    const v = sc.values[tk];
    for (let i = 0; i <= i0; i++) {
      if (v[i] > vmax) vmax = v[i];
      if (v[i] < vmin) vmin = v[i];
    }
    const h = head(tk);
    if (h > vmax) vmax = h;
    if (h < vmin) vmin = h;
  }
  let tMax: number, tMin: number;
  if (sc.log) {
    tMax = Math.log10(vmax * 1.2);
    tMin = Math.log10(Math.max(vmin * 0.85, 1e-6));
    if (tMax - tMin < 0.3) tMax = tMin + 0.3;
  } else {
    tMax = Math.max(vmax * 1.08, sc.invested * 1.25);
    tMin = Math.min(vmin * 0.9, sc.invested * 0.75);
    if (tMin < sc.invested * 0.35) tMin = 0;
  }
  if (hard) {
    view.yMax = tMax;
    view.yMin = tMin;
    view.ready = true;
  } else {
    const k = 1 - Math.exp(-dt / 220);
    view.yMax += (tMax - view.yMax) * k;
    view.yMin += (tMin - view.yMin) * k;
  }
  const yOf = (v: number) => {
    const u = sc.log ? Math.log10(Math.max(v, 1e-6)) : v;
    return py1 - ((u - view.yMin) / (view.yMax - view.yMin)) * (py1 - py0);
  };
  const t0 = sc.ms[0];
  const span = sc.ms[n - 1] - t0;
  const tEnd = Math.max(headMs, t0 + Math.max(span * 0.035, 12 * 86400000));
  const xOf = (ms: number) => px0 + ((ms - t0) / (tEnd - t0)) * (px1 - px0);

  // ---------- giant year ----------
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = hexA(st.dark ? "#ffffff" : "#0f172a", st.dark ? 0.055 : 0.05);
  const yr = String(new Date(headMs).getUTCFullYear());
  ctx.font = font(900, Math.min((px1 - px0) * 0.42, (py1 - py0) * 0.8));
  ctx.fillText(yr, (px0 + px1) / 2, (py0 + py1) / 2 + 6 * s);
  ctx.restore();

  // ---------- grid ----------
  const dMin = sc.log ? 10 ** view.yMin : view.yMin;
  const dMax = sc.log ? 10 ** view.yMax : view.yMax;
  ctx.font = font(500, 18 * s);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1.5 * s;
  for (const v of sc.log ? logTicks(dMin, dMax) : linearTicks(dMin, dMax)) {
    const y = yOf(v);
    if (y < py0 - 4 || y > py1 + 4) continue;
    ctx.strokeStyle = st.grid;
    ctx.beginPath();
    ctx.moveTo(px0, y);
    ctx.lineTo(cx1, y);
    ctx.stroke();
    ctx.fillStyle = st.muted;
    ctx.fillText(fmtAxis(v), px0 - 12 * s, y);
  }
  // principal baseline
  const yb = yOf(sc.invested);
  if (yb > py0 && yb < py1) {
    ctx.save();
    ctx.setLineDash([8 * s, 8 * s]);
    ctx.strokeStyle = hexA(st.dark ? "#ffffff" : "#0f172a", 0.35);
    ctx.beginPath();
    ctx.moveTo(px0, yb);
    ctx.lineTo(cx1, yb);
    ctx.stroke();
    ctx.restore();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = st.muted;
  for (const tk of timeTicks(t0, tEnd, sc.lang)) {
    const x = xOf(tk.ms);
    if (x > px1 - 10 * s) continue;
    ctx.fillText(tk.label, x, py1 + 14 * s);
  }

  // ---------- lines ----------
  const plotW = px1 - px0;
  const stride = 2 ** Math.max(0, Math.ceil(Math.log2(Math.max(1, i0) / (plotW * 1.4))));
  const hx = xOf(headMs);
  ctx.save();
  ctx.beginPath();
  ctx.rect(px0 - 2, cy0 - 10 * s, cx1 - px0 + 40 * s, py1 - cy0 + 12 * s);
  ctx.clip();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // draw laggards first so the leader sits on top
  for (const { tk, v: hv } of [...heads].reverse()) {
    const v = sc.values[tk];
    const col = sc.colors[tk];
    const path = new Path2D();
    path.moveTo(px0, yOf(v[0]));
    for (let i = stride; i <= i0; i += stride) path.lineTo(xOf(sc.ms[i]), yOf(v[i]));
    path.lineTo(hx, yOf(hv));
    const area = new Path2D(path);
    area.lineTo(hx, py1);
    area.lineTo(px0, py1);
    area.closePath();
    const ag = ctx.createLinearGradient(0, py0, 0, py1);
    ag.addColorStop(0, hexA(col, st.dark ? 0.2 : 0.1));
    ag.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = ag;
    ctx.fill(area);
    const lw = (tk === leader ? 4.6 : 3.6) * s;
    if (st.dark) {
      ctx.strokeStyle = hexA(col, 0.1);
      ctx.lineWidth = lw * 4.2;
      ctx.stroke(path);
      ctx.strokeStyle = hexA(col, 0.22);
      ctx.lineWidth = lw * 2.2;
      ctx.stroke(path);
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.stroke(path);
  }
  ctx.restore();

  // ---------- event shockwave ----------
  let ev: Ev | null = null;
  for (let i = sc.events.length - 1; i >= 0; i--)
    if (sc.events[i].idx <= p) {
      ev = sc.events[i];
      break;
    }
  const evAge = ev ? ((p - ev.idx) / (n - 1)) * sc.raceMs + afterMs : Infinity;
  if (ev && evAge < 900) {
    const k = evAge / 900;
    ctx.strokeStyle = hexA(sc.colors[ev.ticker], (1 - k) * 0.9);
    ctx.lineWidth = (6 - 4 * k) * s;
    ctx.beginPath();
    ctx.arc(hx, yOf(head(ev.ticker)), (12 + easeOut(k) * 90) * s, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ---------- heads ----------
  const pulse = (t % 1100) / 1100;
  for (const { tk, v: hv } of heads) {
    const y = yOf(hv);
    const col = sc.colors[tk];
    if (st.dark) {
      const rg = ctx.createRadialGradient(hx, y, 0, hx, y, 30 * s);
      rg.addColorStop(0, hexA(col, 0.55));
      rg.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(hx, y, 30 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = hexA(col, (1 - pulse) * 0.7);
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.arc(hx, y, (8 + pulse * 16) * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(hx, y, 8 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(hx, y, 3.2 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  // head labels (collision-avoided)
  const fs = 21 * s;
  const gapY = fs * 1.3;
  const sorted = heads.map((h) => ({ ...h, y: yOf(h.v) })).sort((a, b) => a.y - b.y);
  const ly = sorted.map((h) => Math.max(py0, Math.min(py1, h.y)));
  for (let i = 1; i < ly.length; i++) if (ly[i] - ly[i - 1] < gapY) ly[i] = ly[i - 1] + gapY;
  const over = ly.length ? ly[ly.length - 1] - py1 : 0;
  if (over > 0) for (let i = 0; i < ly.length; i++) ly[i] -= over;
  ctx.font = font(800, fs);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  sorted.forEach((h, i) => {
    ctx.fillStyle = sc.colors[h.tk];
    ctx.fillText(sc.labels[h.tk], hx + 20 * s, ly[i]);
  });

  // ---------- leaderboard ----------
  // board order has hysteresis so near-ties don't make rows jitter
  const hv: Record<string, number> = {};
  for (const h of heads) hv[h.tk] = h.v;
  if (hard || view.order.length !== cnt) view.order = heads.map((h) => h.tk);
  else
    for (let pass = 0; pass < cnt; pass++)
      for (let i = cnt - 1; i > 0; i--) {
        const a = view.order[i - 1];
        const b = view.order[i];
        if (hv[b] > hv[a] * 1.006) (view.order[i - 1] = b), (view.order[i] = a);
      }
  const board = view.order.map((tk) => ({ tk, v: hv[tk] }));
  const kRank = hard ? 1 : 1 - Math.exp(-dt / 95);
  board.forEach((h, i) => {
    const cur = view.rank[h.tk];
    view.rank[h.tk] = cur == null || hard ? i : cur + (i - cur) * kRank;
  });
  const f = Math.min(1, rowH / (62 * s));
  const maxV = heads[0].v;
  [...board].reverse().forEach((h) => {
    const rank = view.order.indexOf(h.tk);
    const y = by0 + view.rank[h.tk] * rowH;
    const col = sc.colors[h.tk];
    const isLead = rank === 0 && cnt > 1;
    // row card
    ctx.fillStyle = isLead ? hexA(col, st.dark ? 0.16 : 0.1) : st.panel;
    roundRect(ctx, bx0, y + 3 * s, bx1 - bx0, rowH - 6 * s, 12 * s * f);
    ctx.fill();
    const mid = y + rowH * 0.4;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = st.muted;
    ctx.font = font(800, 20 * s * f);
    ctx.fillText(String(rank + 1), bx0 + 14 * s * f, mid);
    let lx = bx0 + 44 * s * f;
    if (isLead) {
      crown(ctx, lx + 11 * s * f, mid - 1 * s, 22 * s * f, st.accent);
      lx += 30 * s * f;
    }
    // value (right)
    ctx.textAlign = "right";
    ctx.fillStyle = st.fg;
    ctx.font = font(800, 25 * s * f);
    const val = fmtMoney(h.v);
    const vw = ctx.measureText(val).width;
    ctx.fillText(val, bx1 - 14 * s * f, mid);
    // label
    ctx.textAlign = "left";
    ctx.fillStyle = col;
    fit(ctx, sc.labels[h.tk], 800, 23 * s * f, bx1 - 14 * s * f - vw - 12 * s - lx);
    ctx.fillText(sc.labels[h.tk], lx, mid);
    // bar + pct
    const pctTxt = fmtPct(h.v / sc.invested);
    ctx.font = font(700, 16 * s * f);
    ctx.textAlign = "right";
    ctx.fillStyle = h.v >= sc.invested ? st.up : st.down;
    const by = y + rowH * 0.74;
    ctx.fillText(pctTxt, bx1 - 14 * s * f, by);
    const barX = bx0 + 44 * s * f;
    const barMax = bx1 - 14 * s * f - 92 * s * f - barX;
    const bh = 7 * s * f;
    ctx.fillStyle = hexA(st.dark ? "#ffffff" : "#0f172a", 0.08);
    roundRect(ctx, barX, by - bh / 2, barMax, bh, bh);
    ctx.fill();
    const bw = Math.max(bh, barMax * (h.v / maxV));
    const bg = ctx.createLinearGradient(barX, 0, barX + bw, 0);
    bg.addColorStop(0, hexA(col, 0.55));
    bg.addColorStop(1, col);
    ctx.fillStyle = bg;
    roundRect(ctx, barX, by - bh / 2, bw, bh, bh);
    ctx.fill();
  });

  // ---------- event banner ----------
  if (ev && evAge < 1700) {
    const a = Math.min(easeOut(evAge / 180), clamp01((1700 - evAge) / 260));
    const txt =
      ev.kind === "lead"
        ? L.lead(sc.labels[ev.ticker], sc.labels[ev.other!])
        : ev.kind === "mile"
          ? L.mile(sc.labels[ev.ticker], ev.mult!)
          : L.half(sc.labels[ev.ticker]);
    ctx.save();
    ctx.globalAlpha = a;
    const maxW = cx1 - px0 - 20 * s;
    const px = fit(ctx, txt, 800, 26 * s, maxW - 44 * s);
    const tw = ctx.measureText(txt).width;
    const bw = tw + 44 * s;
    const bh = px * 1.9;
    const bxc = (px0 + cx1) / 2;
    const byy = cy0 + 2 * s - (1 - easeOutBack(evAge / 260)) * 24 * s;
    if (st.dark) {
      ctx.shadowColor = sc.colors[ev.ticker];
      ctx.shadowBlur = 26 * s;
    }
    ctx.fillStyle = sc.colors[ev.ticker];
    roundRect(ctx, bxc - bw / 2, byy, bw, bh, bh / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = st.onColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(txt, bxc, byy + bh / 2 + px * 0.04);
    ctx.restore();
  }
}

function drawIntro(ctx: CanvasRenderingContext2D, W: number, H: number, sc: Scene, u: number) {
  const st = STYLES[sc.style];
  const L = TXT[sc.lang];
  const s = Math.min(W, H) / 720;
  const cnt = sc.tickers.length;
  const cx = W / 2;
  const maxW = W * 0.86;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const appear = (at: number, dur = 380) => easeOut((u - at) / dur);
  const lineA = sc.title || L.ifIn(fmtMonth(sc.ms[0], sc.lang));
  const lineB = L.investEach(fmtMoney(sc.invested), cnt > 1);
  const lineC = L.who(cnt > 1);

  // chips layout
  const chipFs = (cnt > 4 ? 30 : 38) * s;
  ctx.font = font(800, chipFs);
  const chipH = chipFs * 1.75;
  const gap = 14 * s;
  const rows: { tk: string; w: number }[][] = [[]];
  let rw = 0;
  for (const tk of sc.tickers) {
    const w = ctx.measureText(sc.labels[tk]).width + chipFs * 1.2;
    if (rw + w > maxW && rows[rows.length - 1].length) {
      rows.push([]);
      rw = 0;
    }
    rows[rows.length - 1].push({ tk, w });
    rw += w + gap;
  }
  const chipsH = rows.length * (chipH + gap) - gap;
  const total = 44 * s + 26 * s + 84 * s + 34 * s + chipsH + 40 * s + 56 * s;
  let y = (H - total) / 2 + 22 * s;

  let a = appear(80);
  ctx.globalAlpha = a;
  ctx.fillStyle = st.muted;
  fit(ctx, lineA, 600, 36 * s, maxW);
  ctx.fillText(lineA, cx, y + (1 - a) * 22 * s);
  y += 22 * s + 26 * s + 42 * s;

  a = appear(320);
  ctx.globalAlpha = a;
  ctx.fillStyle = st.fg;
  fit(ctx, lineB, 900, 78 * s, maxW);
  ctx.fillText(lineB, cx, y + (1 - a) * 26 * s);
  y += 42 * s + 34 * s;

  let ci = 0;
  for (const row of rows) {
    const roww = row.reduce((x, c) => x + c.w + gap, -gap);
    let x = cx - roww / 2;
    for (const c of row) {
      const k = easeOutBack((u - 700 - ci * 110) / 320);
      if (u >= 700 + ci * 110) {
        ctx.save();
        ctx.globalAlpha = clamp01(k);
        ctx.translate(x + c.w / 2, y + chipH / 2);
        ctx.scale(k, k);
        if (st.dark) {
          ctx.shadowColor = sc.colors[c.tk];
          ctx.shadowBlur = 24 * s;
        }
        ctx.fillStyle = sc.colors[c.tk];
        roundRect(ctx, -c.w / 2, -chipH / 2, c.w, chipH, chipH / 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = st.onColor;
        ctx.font = font(800, chipFs);
        ctx.fillText(sc.labels[c.tk], 0, chipFs * 0.04);
        ctx.restore();
      }
      x += c.w + gap;
      ci++;
    }
    y += chipH + gap;
  }
  y += 40 * s - gap + 28 * s;

  const at = 800 + cnt * 110 + 150;
  a = appear(at, 420);
  ctx.globalAlpha = a;
  ctx.fillStyle = st.accent;
  const k = 0.8 + 0.2 * easeOutBack((u - at) / 420);
  ctx.save();
  ctx.translate(cx, y);
  ctx.scale(k, k);
  fit(ctx, lineC, 900, 54 * s, maxW);
  ctx.fillText(lineC, 0, 0);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawOutro(ctx: CanvasRenderingContext2D, W: number, H: number, sc: Scene, u: number) {
  const st = STYLES[sc.style];
  const L = TXT[sc.lang];
  const n = sc.ms.length;
  const cnt = sc.tickers.length;
  const win = sc.finalRank[0];
  const finalV = sc.values[win][n - 1];
  const ratio = finalV / sc.invested;

  // dim
  ctx.fillStyle = hexA(st.dark ? "#03040a" : "#ffffff", 0.88 * easeOut(u / 450));
  ctx.fillRect(0, 0, W, H);

  // confetti
  const s0 = Math.min(W, H) / 720;
  if (ratio >= 1) {
    for (let i = 0; i < 150; i++) {
      const delay = 150 + rnd(i * 7) * 900;
      const tt = (u - delay) / 1000;
      if (tt < 0) continue;
      const x = W * rnd(i * 7 + 1) + Math.sin(tt * (2 + rnd(i * 7 + 2) * 3) + i) * 26 * s0;
      const y = -30 * s0 + tt * H * (0.22 + rnd(i * 7 + 3) * 0.3) + tt * tt * H * 0.03;
      if (y > H + 30) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tt * (2 + rnd(i * 7 + 4) * 6) + i);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = st.palette[i % st.palette.length];
      const w = (8 + rnd(i * 7 + 5) * 8) * s0;
      ctx.fillRect(-w / 2, -w * 0.3, w, w * 0.6 * Math.abs(Math.cos(tt * 5 + i)) + 1);
      ctx.restore();
    }
  }

  // content block (auto-scaled to fit)
  const others = sc.finalRank.slice(1, 6);
  const years = (sc.ms[n - 1] - sc.ms[0]) / (365.25 * 86400000);
  const raw = 54 + 40 + 104 + 150 + 56 + (years >= 1 ? 40 : 0) + (others.length ? 26 + others.length * 40 : 0);
  const s = s0 * Math.min(1, (H * 0.88) / (raw * s0));
  const maxW = W * 0.86;
  const cx = W / 2;
  let y = (H - raw * s) / 2;
  const pop = easeOutBack((u - 250) / 520);
  if (u < 250) return;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.save();
  ctx.translate(cx, H / 2);
  ctx.scale(0.7 + 0.3 * pop, 0.7 + 0.3 * pop);
  ctx.translate(-cx, -H / 2);
  ctx.globalAlpha = clamp01((u - 250) / 200);

  if (cnt > 1) crown(ctx, cx, y + 24 * s, 62 * s, st.accent);
  y += 54 * s;
  ctx.fillStyle = st.accent;
  ctx.font = font(800, 24 * s);
  const kicker = cnt > 1 ? L.winner : L.result;
  ctx.fillText(sc.lang === "en" ? kicker.split("").join(" ") : kicker.split("").join("  "), cx, y + 18 * s);
  y += 40 * s;

  const col = sc.colors[win];
  if (st.dark) {
    ctx.shadowColor = col;
    ctx.shadowBlur = 40 * s;
  }
  ctx.fillStyle = col;
  fit(ctx, sc.labels[win], 900, 92 * s, maxW);
  ctx.fillText(sc.labels[win], cx, y + 52 * s);
  ctx.shadowBlur = 0;
  y += 104 * s;

  const cu = easeOut((u - 450) / 1300);
  const shown = 1 + (ratio - 1) * cu;
  ctx.fillStyle = ratio >= 1 ? st.fg : st.down;
  fit(ctx, fmtPct(ratio), 900, 136 * s, maxW);
  ctx.fillText(fmtPct(shown), cx, y + 75 * s);
  y += 150 * s;

  ctx.fillStyle = st.fg;
  const money = `${fmtMoney(sc.invested)}  →  ${fmtMoney(sc.invested * shown)}`;
  fit(ctx, `${fmtMoney(sc.invested)}  →  ${fmtMoney(finalV)}`, 700, 40 * s, maxW);
  ctx.fillText(money, cx, y + 28 * s);
  y += 56 * s;

  if (years >= 1) {
    const cagr = (ratio ** (1 / years) - 1) * 100;
    ctx.fillStyle = st.muted;
    const line = `${L.cagr} ${cagr >= 0 ? "+" : "−"}${Math.abs(cagr).toFixed(1)}%  ·  ${fmtMonth(sc.ms[0], sc.lang)} – ${fmtMonth(sc.ms[n - 1], sc.lang)}`;
    fit(ctx, line, 600, 24 * s, maxW);
    ctx.fillText(line, cx, y + 20 * s);
    y += 40 * s;
  }
  ctx.restore();

  if (others.length) {
    y += 26 * s;
    const colW = Math.min(maxW, 520 * s);
    others.forEach((tk, i) => {
      const a = easeOut((u - 1300 - i * 140) / 380);
      if (a <= 0) return;
      const yy = y + i * 40 * s + 20 * s + (1 - a) * 16 * s;
      const r = sc.values[tk][n - 1] / sc.invested;
      ctx.globalAlpha = a;
      ctx.textAlign = "left";
      ctx.fillStyle = st.muted;
      ctx.font = font(700, 24 * s);
      ctx.fillText(`${i + 2}`, cx - colW / 2, yy);
      ctx.fillStyle = sc.colors[tk];
      ctx.font = font(800, 26 * s);
      ctx.fillText(sc.labels[tk], cx - colW / 2 + 40 * s, yy);
      ctx.textAlign = "right";
      ctx.fillStyle = r >= 1 ? st.up : st.down;
      ctx.fillText(fmtPct(r), cx + colW / 2, yy);
    });
    ctx.globalAlpha = 1;
  }

  if (sc.watermark) {
    ctx.globalAlpha = easeOut((u - 900) / 500) * 0.8;
    ctx.textAlign = "center";
    ctx.fillStyle = st.fg;
    ctx.font = font(700, 24 * s0);
    ctx.fillText(sc.watermark, cx, H - 34 * s0);
    ctx.globalAlpha = 1;
  }
}

/** Draw the whole film at absolute time `t` (ms). */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  sc: Scene,
  t: number,
  view: View,
  snap: boolean,
) {
  const total = totalMs(sc);
  t = Math.max(0, Math.min(total, t));
  const dt = t - view.lastT;
  const hard = snap || !view.ready || dt < 0 || dt > 250;
  view.lastT = t;
  const n = sc.ms.length;
  const st = STYLES[sc.style];

  ctx.globalAlpha = 1;
  drawBackground(ctx, W, H, sc, t);

  const FADE = 380;
  if (t < INTRO_MS - FADE) {
    drawIntro(ctx, W, H, sc, t);
  } else {
    const raceT = Math.max(0, Math.min(sc.raceMs, t - INTRO_MS));
    drawRace(ctx, W, H, sc, (raceT / sc.raceMs) * (n - 1), t, view, dt, hard, Math.max(0, t - INTRO_MS - sc.raceMs));
    if (t < INTRO_MS) {
      // cross-fade intro → race
      ctx.save();
      ctx.globalAlpha = (INTRO_MS - t) / FADE;
      drawBackground(ctx, W, H, sc, t);
      ctx.restore();
      ctx.save();
      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      const o = off.getContext("2d")!;
      drawIntro(o, W, H, sc, t);
      ctx.globalAlpha = (INTRO_MS - t) / FADE;
      ctx.drawImage(off, 0, 0);
      ctx.restore();
    }
    const u = t - INTRO_MS - sc.raceMs;
    if (u > 0) drawOutro(ctx, W, H, sc, u);
  }

  // progress bar (retention cue)
  const s = Math.min(W, H) / 720;
  ctx.globalAlpha = 1;
  ctx.fillStyle = hexA(st.dark ? "#ffffff" : "#0f172a", 0.1);
  ctx.fillRect(0, H - 5 * s, W, 5 * s);
  ctx.fillStyle = st.accent;
  ctx.fillRect(0, H - 5 * s, W * (t / total), 5 * s);
}
