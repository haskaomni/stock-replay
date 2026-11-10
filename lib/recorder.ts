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
