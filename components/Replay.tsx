"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryResponse } from "@/lib/types";
import { drawFrame, PALETTE, View, type Frame, type ThemeName } from "@/lib/render";
import { labelOf } from "@/lib/labels";
import { CanvasRecorder, canEncodeMp4, encodeMp4, pickMime } from "@/lib/recorder";

type Status = "idle" | "loading" | "playing" | "paused" | "done" | "recording";

const RATIOS: Record<string, [number, number]> = {
  "16:9": [16, 9],
  "9:16": [9, 16],
  "1:1": [1, 1],
  "4:5": [4, 5],
};
const PRESETS: { label: string; years?: number; ytd?: boolean }[] = [
  { label: "YTD", ytd: true },
  { label: "1年", years: 1 },
  { label: "3年", years: 3 },
  { label: "5年", years: 5 },
  { label: "10年", years: 10 },
  { label: "20年", years: 20 },
];
const EXAMPLES = [
  { label: "中美大盘对比", t: "^GSPC, 000300.SS" },
  { label: "科技巨头", t: "NVDA, AAPL, MSFT, GOOGL" },
  { label: "BTC vs 黄金 vs 标普", t: "BTC-USD, GC=F, ^GSPC" },
];
const HOLD_MS = 2200;
/** daily bars revealed per second (252 bars ≈ one trading year) */
const SPEEDS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 250, 400];
const MIN_SECONDS = 3;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const even = (n: number) => Math.round(n / 2) * 2;

export default function Replay() {
  const [tickerText, setTickerText] = useState(EXAMPLES[0].t);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [invested, setInvested] = useState(10000);
  const [speedIdx, setSpeedIdx] = useState(6);
  const [ratio, setRatio] = useState("16:9");
  const [quality, setQuality] = useState(720);
  const [theme, setTheme] = useState<ThemeName>("light");
  const [log, setLog] = useState(false);
  const [watermark, setWatermark] = useState("");
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [video, setVideo] = useState<{ url: string; ext: string; size: number } | null>(null);
  const [recPct, setRecPct] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef(new View());
  const anim = useRef({ raf: 0, last: 0, elapsed: 0, recorder: null as CanvasRecorder | null });

  const [W, H] = useMemo(() => {
    const [rw, rh] = RATIOS[ratio];
    const k = quality / Math.min(rw, rh);
    return [even(rw * k), even(rh * k)];
  }, [ratio, quality]);

  const speed = SPEEDS[speedIdx];
  // total animation length is derived from speed × number of bars
  const barCount = useMemo(() => {
    if (data) return data.dates.length;
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    return Number.isFinite(days) && days > 1 ? Math.round((days * 252) / 365) : 0;
  }, [data, from, to]);
  const duration = Math.max(MIN_SECONDS, Math.max(1, barCount - 1) / speed);

  // keep playback progress when speed changes mid-play
  const prevDuration = useRef(duration);
  useEffect(() => {
    if (prevDuration.current !== duration) {
      anim.current.elapsed *= duration / prevDuration.current;
      prevDuration.current = duration;
    }
  }, [duration]);

  useEffect(() => {
    const now = new Date();
    setTo(iso(now));
    setFrom(iso(new Date(Date.UTC(now.getUTCFullYear() - 3, now.getUTCMonth(), now.getUTCDate()))));
  }, []);

  const base = useMemo<Omit<Frame, "p"> | null>(() => {
    if (!data) return null;
    const tickers = Object.keys(data.series);
    const values: Record<string, number[]> = {};
    const colors: Record<string, string> = {};
    const labels: Record<string, string> = {};
    tickers.forEach((t, i) => {
      const s = data.series[t];
      values[t] = s.map((v) => (invested * v) / s[0]);
      colors[t] = PALETTE[i % PALETTE.length];
      labels[t] = labelOf(t);
    });
    return {
      ms: data.dates.map((d) => Date.parse(d + "T00:00:00Z")),
      dates: data.dates,
      tickers,
      labels,
      values,
      colors,
      log,
      theme,
      invested,
      watermark,
    };
  }, [data, invested, log, theme, watermark]);

  const draw = useCallback(
    (p: number, snap: boolean) => {
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx || !base) return;
      drawFrame(ctx, c.width, c.height, { ...base, p }, viewRef.current, snap);
    },
    [base],
  );

  const stopLoop = () => cancelAnimationFrame(anim.current.raf);

  const finishRecording = useCallback(async () => {
    const r = anim.current.recorder;
    if (!r) return;
    anim.current.recorder = null;
    const blob = await r.stop();
    const m = pickMime();
    setVideo((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { url: URL.createObjectURL(blob), ext: m?.ext ?? "webm", size: blob.size };
    });
    setStatus("done");
  }, []);

  const loop = useCallback(
    (now: number) => {
      const a = anim.current;
      if (!base) return;
      const n = base.ms.length;
      const total = duration * 1000;
      a.elapsed += now - a.last;
      a.last = now;
      const prog = Math.min(1, a.elapsed / total);
      draw(prog * (n - 1), false);
      if (sliderRef.current) sliderRef.current.value = String(prog);
      if (a.recorder) setRecPct(Math.min(100, (a.elapsed / (total + HOLD_MS)) * 100));
      const end = a.recorder ? total + HOLD_MS : total;
      if (a.elapsed >= end) {
        if (a.recorder) void finishRecording();
        else setStatus("done");
        return;
      }
      a.raf = requestAnimationFrame(loop);
    },
    [base, duration, draw, finishRecording],
  );

  const play = useCallback(
    (fromStart: boolean) => {
      stopLoop();
      const a = anim.current;
      if (fromStart || a.elapsed >= duration * 1000) {
        a.elapsed = 0;
        viewRef.current.reset();
      }
      a.last = performance.now();
      setStatus("playing");
      a.raf = requestAnimationFrame(loop);
    },
    [duration, loop],
  );

  const pause = () => {
    stopLoop();
    setStatus("paused");
  };

  /** Preferred path: frame-by-frame WebCodecs → MP4 with an exact duration. */
  const exportExact = async (): Promise<boolean> => {
    const c = canvasRef.current;
    if (!c || !base) return false;
    const fps = 30;
    const bitrate = Math.round(((W * H) / (1920 * 1080)) * 10_000_000 + 2_000_000);
    const codec = await canEncodeMp4(W, H, bitrate);
    if (!codec) return false;
    stopLoop();
    setError("");
    setVideo(null);
    setStatus("recording");
    setRecPct(0);
    const n = base.ms.length;
    const total = duration * 1000;
    const totalFrames = Math.round(((total + HOLD_MS) / 1000) * fps);
    viewRef.current.reset();
    try {
      const blob = await encodeMp4({
        canvas: c,
        codec,
        fps,
        bitrate,
        totalFrames,
        renderFrame: (i) => {
          const prog = Math.min(1, ((i / fps) * 1000) / total);
          draw(prog * (n - 1), i === 0);
        },
        onProgress: (d) => setRecPct((d / totalFrames) * 100),
      });
      setVideo((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { url: URL.createObjectURL(blob), ext: "mp4", size: blob.size };
      });
      anim.current.elapsed = total;
      setStatus("done");
    } catch (e) {
      setError("视频编码失败：" + (e as Error).message);
      setStatus("done");
    }
    return true;
  };

  const record = async () => {
    if (await exportExact()) return;
    const m = pickMime();
    const c = canvasRef.current;
    if (!m || !c) {
      setError("当前浏览器不支持视频录制，请使用最新版 Chrome / Edge / Safari。");
      return;
    }
    stopLoop();
    setError("");
    setVideo(null);
    const a = anim.current;
    a.elapsed = 0;
    viewRef.current.reset();
    draw(0, true);
    // bitrate scales with pixel count (≈10 Mbps at 1080p)
    const bitrate = Math.round((W * H) / (1920 * 1080) * 10_000_000 + 2_000_000);
    a.recorder = new CanvasRecorder(c, m.mime, 30, bitrate);
    setStatus("recording");
    setRecPct(0);
    await new Promise((r) => setTimeout(r, 300));
    a.last = performance.now();
    a.raf = requestAnimationFrame(loop);
  };

  // redraw when look changes / restart loop closure when params change
  useEffect(() => {
    if (!base) return;
    const a = anim.current;
    if (status === "playing" || status === "recording") {
      // loop closure may be stale (duration etc.) — restart seamlessly
      stopLoop();
      a.last = performance.now();
      a.raf = requestAnimationFrame(loop);
    } else {
      const n = base.ms.length;
      const prog = Math.min(1, a.elapsed / (duration * 1000));
      draw(status === "done" ? n - 1 : prog * (n - 1), true);
    }
    return stopLoop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, W, H, loop, draw]);

  useEffect(
    () => () => {
      stopLoop();
      anim.current.recorder?.stop();
    },
    [],
  );

  const load = async () => {
    stopLoop();
    anim.current.recorder = null;
    setError("");
    setVideo(null);
    setStatus("loading");
    try {
      const q = new URLSearchParams({ tickers: tickerText, from, to });
      const res = await fetch(`/api/history?${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `请求失败 (${res.status})`);
      anim.current.elapsed = 0;
      viewRef.current.reset();
      setData(json);
      setStatus("playing");
    } catch (e) {
      setError((e as Error).message);
      setStatus(data ? "done" : "idle");
    }
  };

  // after data arrives: start playing once the canvas has been drawn
  useEffect(() => {
    if (data) play(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    const end = new Date();
    setTo(iso(end));
    setFrom(
      p.ytd
        ? `${end.getUTCFullYear()}-01-01`
        : iso(new Date(Date.UTC(end.getUTCFullYear() - p.years!, end.getUTCMonth(), end.getUTCDate()))),
    );
  };

  const onScrub = (v: number) => {
    if (!base) return;
    stopLoop();
    anim.current.elapsed = v * duration * 1000;
    draw(v * (base.ms.length - 1), true);
    setStatus("paused");
  };

  const busy = status === "loading" || status === "recording";
  const ready = !!data;

  return (
    <div className="layout">
      <section className="panel">
        <label className="field">
          <span>股票代码（逗号或空格分隔，最多 8 个）</span>
          <textarea
            value={tickerText}
            onChange={(e) => setTickerText(e.target.value)}
            rows={2}
            spellCheck={false}
            placeholder="AAPL, NVDA, 000300.SS, BTC-USD"
          />
        </label>
        <div className="chips">
          {EXAMPLES.map((e) => (
            <button key={e.t} type="button" className="chip" onClick={() => setTickerText(e.t)}>
              {e.label}
            </button>
          ))}
        </div>

        <div className="row">
          <label className="field">
            <span>开始日期</span>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span>结束日期</span>
            <input type="date" value={to} min={from} max={iso(new Date())} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="chip" onClick={() => applyPreset(p)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="row">
          <label className="field">
            <span>初始投入 (USD)</span>
            <input
              type="number"
              min={1}
              step={1000}
              value={invested}
              onChange={(e) => setInvested(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <label className="field">
            <span>播放速度：每秒 {speed} 根日 K（约 {(252 / speed).toFixed(1)} 秒/年）</span>
            <input
              type="range"
              min={0}
              max={SPEEDS.length - 1}
              step={1}
              value={speedIdx}
              onChange={(e) => setSpeedIdx(+e.target.value)}
            />
            <small className="hint">
              {barCount > 0 ? `共约 ${barCount} 根 · 视频时长约 ${duration.toFixed(1)} 秒` : "请选择日期范围"}
            </small>
          </label>
        </div>

        <div className="row">
          <label className="field">
            <span>画幅</span>
            <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
              <option value="16:9">16:9 横屏（YouTube / B站）</option>
              <option value="9:16">9:16 竖屏（抖音 / TikTok / Reels）</option>
              <option value="1:1">1:1 方形（微博 / X）</option>
              <option value="4:5">4:5（Instagram）</option>
            </select>
          </label>
          <label className="field">
            <span>清晰度</span>
            <select value={quality} onChange={(e) => setQuality(+e.target.value)}>
              <option value={720}>720p</option>
              <option value={1080}>1080p</option>
            </select>
          </label>
        </div>

        <div className="row">
          <label className="field">
            <span>主题</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeName)}>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <label className="field">
            <span>纵轴</span>
            <select value={log ? "log" : "lin"} onChange={(e) => setLog(e.target.value === "log")}>
              <option value="lin">线性</option>
              <option value="log">对数</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>署名 / 水印（可选）</span>
          <input value={watermark} maxLength={30} onChange={(e) => setWatermark(e.target.value)} placeholder="@yourname" />
        </label>

        <button className="primary" disabled={busy} onClick={load}>
          {status === "loading" ? "获取数据中…" : "获取数据并播放"}
        </button>
        {error && <p className="error">{error}</p>}
        <p className="hint">
          数据：Yahoo Finance 日 K（复权收盘价，含分红再投资）。指数需带前缀，如 ^GSPC；A 股如 000300.SS、600519.SS、000001.SZ；加密如 BTC-USD。
        </p>
      </section>

      <section className="stage">
        <div
          className="canvas-wrap"
          style={{ aspectRatio: `${W} / ${H}`, width: `min(100%, calc(78vh * ${W / H}))` }}
        >
          <canvas ref={canvasRef} width={W} height={H} />
          {!ready && <div className="placeholder">输入代码和时间范围，点击「获取数据并播放」</div>}
        </div>

        <div className="controls">
          <button
            disabled={!ready || busy}
            onClick={() => (status === "playing" ? pause() : play(status === "done"))}
          >
            {status === "playing" ? "暂停" : status === "done" ? "重播" : "播放"}
          </button>
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={1}
            step={0.001}
            defaultValue={0}
            disabled={!ready || busy}
            onInput={(e) => onScrub(+(e.target as HTMLInputElement).value)}
          />
          <button className="accent" disabled={!ready || busy} onClick={record}>
            {status === "recording" ? `生成中 ${recPct.toFixed(0)}%` : "生成视频"}
          </button>
        </div>
        {status === "recording" && (
          <p className="hint">正在逐帧渲染并编码，通常几秒到几十秒；若浏览器不支持 WebCodecs 则退回实时录制，需保持标签页在前台。</p>
        )}

        {video && (
          <div className="result">
            <video src={video.url} controls playsInline />
            <div className="result-bar">
              <a
                className="primary"
                href={video.url}
                download={`stock-replay-${Object.keys(data?.series ?? {}).join("-")}-${from}_${to}.${video.ext}`}
              >
                下载 {video.ext.toUpperCase()}（{(video.size / 1048576).toFixed(1)} MB）
              </a>
              {video.ext === "webm" && (
                <span className="hint">
                  浏览器只支持 WebM；部分平台需要 MP4，可用 <code>ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p out.mp4</code> 转换。
                </span>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
