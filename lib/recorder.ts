const CANDIDATES = [
  "video/mp4;codecs=avc1.640028",
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export function pickMime(): { mime: string; ext: "mp4" | "webm" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return { mime: m, ext: m.startsWith("video/mp4") ? "mp4" : "webm" };
  }
  return null;
}

export class CanvasRecorder {
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  private stopped: Promise<Blob>;

  constructor(canvas: HTMLCanvasElement, mime: string, fps = 30, bitrate = 10_000_000) {
    const stream = canvas.captureStream(fps);
    this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.stopped = new Promise((res) => {
      this.rec.onstop = () => res(new Blob(this.chunks, { type: mime.split(";")[0] }));
    });
    this.rec.start(500);
  }

  stop(): Promise<Blob> {
    if (this.rec.state !== "inactive") this.rec.stop();
    return this.stopped;
  }
}

// ---------------------------------------------------------------------------
// Deterministic encoder: render frame-by-frame with WebCodecs and mux to MP4.
// Exact duration, faster than real time, immune to tab throttling.
// ---------------------------------------------------------------------------
import { ArrayBufferTarget, Muxer } from "mp4-muxer";

const AVC_CODECS = ["avc1.640034", "avc1.640028", "avc1.4D0028", "avc1.42E01F"];

export async function canEncodeMp4(width: number, height: number, bitrate: number): Promise<string | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  for (const codec of AVC_CODECS) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate: 30 });
      if (r.supported) return codec;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function encodeMp4(opts: {
  canvas: HTMLCanvasElement;
  codec: string;
  fps: number;
  bitrate: number;
  totalFrames: number;
  /** draw the frame at index i onto the canvas */
  renderFrame: (i: number) => void;
  onProgress?: (done: number) => void;
}): Promise<Blob> {
  const { canvas, codec, fps, bitrate, totalFrames, renderFrame, onProgress } = opts;
  const { width, height } = canvas;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: "avc", width, height }, fastStart: "in-memory" });
  let error: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (error = e),
  });
  encoder.configure({ codec, width, height, bitrate, framerate: fps });

  for (let i = 0; i < totalFrames; i++) {
    if (error) throw error;
    renderFrame(i);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    // backpressure + let the UI breathe
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
    if (i % 6 === 0) {
      onProgress?.(i);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await encoder.flush();
  if (error) throw error;
  muxer.finalize();
  encoder.close();
  onProgress?.(totalFrames);
  return new Blob([target.buffer], { type: "video/mp4" });
}
