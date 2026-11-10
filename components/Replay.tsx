"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryResponse } from "@/lib/types";
import { buildScene, drawScene, INTRO_MS, OUTRO_MS, STYLES, totalMs, View, type Lang, type StyleName } from "@/lib/scene";
import { PreviewAudio, renderSoundtrack } from "@/lib/audio";
import { CanvasRecorder, canEncodeMp4, encodeMp4, pickMime } from "@/lib/recorder";

type Status = "idle" | "loading" | "playing" | "paused" | "done" | "recording";

const RATIOS: { id: string; r: [number, number]; hint: string }[] = [
  { id: "9:16", r: [9, 16], hint: "抖音 · TikTok · Reels" },
  { id: "16:9", r: [16, 9], hint: "YouTube · B站" },
  { id: "1:1", r: [1, 1], hint: "X · 微博" },
  { id: "4:5", r: [4, 5], hint: "Instagram" },
];
const PRESETS: { label: string; years?: number; ytd?: boolean }[] = [
  { label: "今年", ytd: true },
  { label: "1年", years: 1 },
  { label: "3年", years: 3 },
  { label: "5年", years: 5 },
  { label: "10年", years: 10 },
  { label: "20年", years: 20 },
];
const EXAMPLES = [
  { label: "🇺🇸 vs 🇨🇳 大盘", t: "^GSPC, 000300.SS" },
  { label: "七巨头", t: "NVDA, AAPL, MSFT, GOOGL, AMZN, META, TSLA" },
  { label: "BTC vs 黄金 vs 标普", t: "BTC-USD, GC=F, ^GSPC" },
  { label: "芯片战争", t: "NVDA, AMD, INTC, TSM" },
];
/** daily bars revealed per second (252 bars ≈ one trading year) */
const SPEEDS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 250, 400];
const MIN_SECONDS = 4;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const even = (n: number) => Math.round(n / 2) * 2;

function Seg<T extends string | number>(p: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {p.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          className={o.value === p.value ? "on" : ""}
          onClick={() => p.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Replay() {
  const [tickerText, setTickerText] = useState(EXAMPLES[1].t);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [invested, setInvested] = useState(10000);
  const [speedIdx, setSpeedIdx] = useState(7);
  const [ratio, setRatio] = useState("9:16");
  const [quality, setQuality] = useState(1080);
  const [fps, setFps] = useState(30);
  const [style, setStyle] = useState<StyleName>("neon");
  const [lang, setLang] = useState<Lang>("zh");
  const [log, setLog] = useState(false);
  const [music, setMusic] = useState(true);
  const [watermark, setWatermark] = useState("");
  const [title, setTitle] = useState("");
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [video, setVideo] = useState<{ url: string; ext: string; size: number; audio: string | null } | null>(null);
  const [recPct, setRecPct] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const viewRef = useRef(new View());
  const anim = useRef({ raf: 0, last: 0, elapsed: 0, recorder: null as CanvasRecorder | null });
  const audioRef = useRef<PreviewAudio | null>(null);
  const trackRef = useRef<{ scene: unknown; promise: Promise<AudioBuffer> } | null>(null);
  const liveRef = useRef({ playing: false, music });
  liveRef.current.music = music;

  const [W, H] = useMemo(() => {
    const [rw, rh] = RATIOS.find((r) => r.id === ratio)!.r;
    const k = quality / Math.min(rw, rh);
    return [even(rw * k), even(rh * k)];
  }, [ratio, quality]);

  useEffect(() => {
    const now = new Date();
    setTo(iso(now));
    setFrom(iso(new Date(Date.UTC(now.getUTCFullYear() - 5, now.getUTCMonth(), now.getUTCDate()))));
  }, []);

  const speed = SPEEDS[speedIdx];
  const barCount = useMemo(() => {
    if (data) return data.dates.length;
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    return Number.isFinite(days) && days > 1 ? Math.round((days * 252) / 365) : 0;
  }, [data, from, to]);
  const raceSec = Math.max(MIN_SECONDS, Math.max(1, barCount - 1) / speed);
  const totalSec = raceSec + (INTRO_MS + OUTRO_MS) / 1000;

  const scene = useMemo(
    () =>
      data
        ? buildScene(data, { invested, log, style, lang, watermark, title, raceMs: raceSec * 1000 })
        : null,
    [data, invested, log, style, lang, watermark, title, raceSec],
  );
  const total = scene ? totalMs(scene) : 0;

  // keep relative progress when the timeline length changes
  const prevTotal = useRef(total);
  useEffect(() => {
    if (prevTotal.current && total && prevTotal.current !== total) anim.current.elapsed *= total / prevTotal.current;
    prevTotal.current = total;
  }, [total]);

  const draw = useCallback(
    (t: number, snap: boolean) => {
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx || !scene) return;
      drawScene(ctx, c.width, c.height, scene, t, viewRef.current, snap);
    },
    [scene],
  );

  const getTrack = useCallback(() => {
    if (!scene) return null;
    if (trackRef.current?.scene !== scene) trackRef.current = { scene, promise: renderSoundtrack(scene) };
    return trackRef.current.promise;
  }, [scene]);

  const stopAudio = () => audioRef.current?.stop();
  const startAudio = useCallback(() => {
    const p = liveRef.current.music ? getTrack() : null;
    if (!p) return;
    p.then((buf) => {
      if (!liveRef.current.playing || !liveRef.current.music || trackRef.current?.promise !== p) return;
      (audioRef.current ??= new PreviewAudio()).play(buf, anim.current.elapsed / 1000);
    }).catch(() => {});
  }, [getTrack]);

  const stopLoop = () => {
    cancelAnimationFrame(anim.current.raf);
    liveRef.current.playing = false;
    stopAudio();
  };

  const finishRecording = useCallback(async () => {
    const r = anim.current.recorder;
    if (!r) return;
    anim.current.recorder = null;
    const blob = await r.stop();
    const m = pickMime();
    setVideo((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { url: URL.createObjectURL(blob), ext: m?.ext ?? "webm", size: blob.size, audio: null };
    });
    setStatus("done");
  }, []);

  const loop = useCallback(
    (now: number) => {
      const a = anim.current;
      if (!scene) return;
      a.elapsed += now - a.last;
      a.last = now;
      const t = Math.min(total, a.elapsed);
      draw(t, false);
      if (sliderRef.current) sliderRef.current.value = String(t / total);
      if (a.recorder) setRecPct((t / total) * 100);
      if (a.elapsed >= total) {
        liveRef.current.playing = false;
        if (a.recorder) void finishRecording();
        else setStatus("done");
        return;
      }
      a.raf = requestAnimationFrame(loop);
    },
    [scene, total, draw, finishRecording],
  );

  const play = useCallback(
    (fromStart: boolean) => {
      stopLoop();
      const a = anim.current;
      if (fromStart || a.elapsed >= total) {
        a.elapsed = 0;
        viewRef.current.reset();
      }
      a.last = performance.now();
      liveRef.current.playing = true;
      setStatus("playing");
      startAudio();
      a.raf = requestAnimationFrame(loop);
    },
    [total, loop, startAudio],
  );

  const pause = () => {
    stopLoop();
    setStatus("paused");
  };

  /** Preferred path: frame-by-frame WebCodecs → MP4 with an exact duration (+ AAC soundtrack). */
  const exportExact = async (): Promise<boolean> => {
    const c = canvasRef.current;
    if (!c || !scene) return false;
    const bitrate = Math.round(((W * H) / (1920 * 1080)) * 12_000_000 * (fps / 30) ** 0.5 + 2_000_000);
    const codec = await canEncodeMp4(W, H, bitrate);
    if (!codec) return false;
    stopLoop();
    setError("");
    setVideo(null);
    setStatus("recording");
    setRecPct(0);
    const totalFrames = Math.round((total / 1000) * fps);
    viewRef.current.reset();
    try {
      const audio = music ? await getTrack()?.catch(() => null) : null;
      const { blob, audioCodec } = await encodeMp4({
        canvas: c,
        codec,
        fps,
        bitrate,
        totalFrames,
        audio,
        renderFrame: (i) => draw((i / fps) * 1000, i === 0),
        onProgress: (d) => setRecPct((d / totalFrames) * 100),
      });
      setVideo((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { url: URL.createObjectURL(blob), ext: "mp4", size: blob.size, audio: audioCodec };
      });
      anim.current.elapsed = total;
    } catch (e) {
      setError("视频编码失败：" + (e as Error).message);
    }
    setStatus("done");
    return true;
  };

  const record = async () => {
    if (await exportExact()) return;
    // fallback: real-time capture (no soundtrack)
    const m = pickMime();
    const c = canvasRef.current;
    if (!m || !c) {
      setError("当前浏览器不支持视频导出，请使用最新版 Chrome / Edge / Safari。");
      return;
    }
    stopLoop();
    setError("");
    setVideo(null);
    const a = anim.current;
    a.elapsed = 0;
    viewRef.current.reset();
    draw(0, true);
    a.recorder = new CanvasRecorder(c, m.mime, 30, Math.round(((W * H) / (1920 * 1080)) * 10_000_000 + 2_000_000));
    setStatus("recording");
    setRecPct(0);
    await new Promise((r) => setTimeout(r, 300));
    a.last = performance.now();
    a.raf = requestAnimationFrame(loop);
  };

  // redraw when the look changes; restart the loop when its closure is stale
  useEffect(() => {
    if (!scene) return;
    const a = anim.current;
    if (status === "playing" || (status === "recording" && a.recorder)) {
      cancelAnimationFrame(a.raf);
      a.last = performance.now();
      if (status === "playing") {
        liveRef.current.playing = true;
        stopAudio();
        startAudio();
      }
      a.raf = requestAnimationFrame(loop);
    } else if (status !== "recording") {
      draw(status === "done" ? total : Math.min(total, a.elapsed), true);
    }
    return () => cancelAnimationFrame(a.raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, W, H, loop, draw]);

  useEffect(() => {
    if (!music) stopAudio();
    else if (liveRef.current.playing) startAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [music]);

  useEffect(
    () => () => {
      stopLoop();
      anim.current.recorder?.stop();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    if (!data) return;
    stageRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    play(true);
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
    if (!scene) return;
    stopLoop();
    anim.current.elapsed = v * total;
    draw(v * total, true);
    setStatus("paused");
  };

  const busy = status === "loading" || status === "recording";
  const ready = !!data;

  return (
    <div className="layout">
      <section className="panel">
        <div className="group">
          <h3>
            <i>1</i>选手
          </h3>
          <textarea
            value={tickerText}
            onChange={(e) => setTickerText(e.target.value)}
            rows={2}
            spellCheck={false}
            placeholder="AAPL, NVDA, 000300.SS, BTC-USD"
          />
          <div className="chips">
            {EXAMPLES.map((e) => (
              <button key={e.t} type="button" className="chip" onClick={() => setTickerText(e.t)}>
                {e.label}
              </button>
            ))}
          </div>
          <p className="hint">逗号分隔，最多 8 个。指数加 ^（^GSPC），A 股加后缀（600519.SS / 000001.SZ），加密如 BTC-USD。</p>
        </div>

        <div className="group">
          <h3>
            <i>2</i>赛程
          </h3>
          <div className="row">
            <label className="field">
              <span>开始</span>
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              <span>结束</span>
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
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
              <span>每位选手本金 (USD)</span>
              <input
                type="number"
                min={1}
                step={1000}
                value={invested}
                onChange={(e) => setInvested(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
          </div>
          <label className="field">
            <span>
              速度：每秒 <b>{speed}</b> 根日 K（约 {(252 / speed).toFixed(1)} 秒/年）
            </span>
            <input
              type="range"
              min={0}
              max={SPEEDS.length - 1}
              step={1}
              value={speedIdx}
              onChange={(e) => setSpeedIdx(+e.target.value)}
            />
            <small className="hint">
              {barCount > 0
                ? `约 ${barCount} 根 K 线 · 成片约 ${totalSec.toFixed(0)} 秒（含片头片尾）`
                : "请选择日期范围"}
            </small>
          </label>
        </div>

        <div className="group">
          <h3>
            <i>3</i>成片
          </h3>
          <div className="field">
            <span>画幅 · {RATIOS.find((r) => r.id === ratio)!.hint}</span>
            <Seg value={ratio} onChange={setRatio} options={RATIOS.map((r) => ({ value: r.id, label: r.id }))} />
          </div>
          <div className="field">
            <span>风格</span>
            <Seg
              value={style}
              onChange={setStyle}
              options={(Object.keys(STYLES) as StyleName[]).map((k) => ({ value: k, label: STYLES[k].label }))}
            />
          </div>
          <div className="row">
            <div className="field">
              <span>清晰度</span>
              <Seg
                value={quality}
                onChange={setQuality}
                options={[
                  { value: 720, label: "720p" },
                  { value: 1080, label: "1080p" },
                ]}
              />
            </div>
            <div className="field">
              <span>帧率</span>
              <Seg
                value={fps}
                onChange={setFps}
                options={[
                  { value: 30, label: "30" },
                  { value: 60, label: "60" },
                ]}
              />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <span>文案语言</span>
              <Seg
                value={lang}
                onChange={setLang}
                options={[
                  { value: "zh", label: "中文" },
                  { value: "en", label: "EN" },
                ]}
              />
            </div>
            <div className="field">
              <span>纵轴</span>
              <Seg
                value={log ? "log" : "lin"}
                onChange={(v) => setLog(v === "log")}
                options={[
                  { value: "lin", label: "线性" },
                  { value: "log", label: "对数" },
                ]}
              />
            </div>
          </div>
          <div className="field">
            <span>配乐（音高随领先者资产起伏）</span>
            <Seg
              value={music ? "on" : "off"}
              onChange={(v) => setMusic(v === "on")}
              options={[
                { value: "on", label: "♪ 开" },
                { value: "off", label: "静音" },
              ]}
            />
          </div>
          <label className="field">
            <span>开场标题（可选，留空自动生成）</span>
            <input value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} placeholder="如果 5 年前买了英伟达…" />
          </label>
          <label className="field">
            <span>署名水印（可选）</span>
            <input value={watermark} maxLength={30} onChange={(e) => setWatermark(e.target.value)} placeholder="@yourname" />
          </label>
        </div>

        <button className="primary go" disabled={busy} onClick={load}>
          {status === "loading" ? "拉取数据中…" : "▶ 开赛"}
        </button>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="stage" ref={stageRef}>
        <div className="canvas-glow">
          <div
            className="canvas-wrap"
            style={{ aspectRatio: `${W} / ${H}`, width: `min(100%, calc(76vh * ${W / H}))` }}
          >
            <canvas ref={canvasRef} width={W} height={H} />
            {!ready && (
              <div className="placeholder">
                <b>选好选手，点「开赛」</b>
                <span>同一笔本金，同一个起点，看谁跑到最后</span>
              </div>
            )}
          </div>
        </div>

        <div className="controls">
          <button disabled={!ready || busy} onClick={() => (status === "playing" ? pause() : play(status === "done"))}>
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
            {status === "recording" ? `渲染中 ${recPct.toFixed(0)}%` : "⬇ 导出视频"}
          </button>
        </div>
        {status === "recording" && (
          <div className="bar">
            <div style={{ width: `${recPct}%` }} />
          </div>
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
              <span className="hint">
                {W}×{H} · {video.ext === "mp4" ? "H.264" : "WebM"}
                {video.audio
                  ? ` · 含配乐（${video.audio.toUpperCase()}）`
                  : music
                    ? " · 此浏览器无法编码音频，成片为静音"
                    : ""}
              </span>
            </div>
          </div>
        )}
        <p className="hint center">数据来自 Yahoo Finance 日线（复权价，含分红再投资）。历史表现不代表未来收益，不构成投资建议。</p>
      </section>
    </div>
  );
}
