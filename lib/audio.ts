import { INTRO_MS, OUTRO_MS, type Scene, totalMs } from "./scene";

export const SAMPLE_RATE = 48000;

// A minor pentatonic over three octaves, starting at A3
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29, 31, 34, 36].map((st) => 220 * 2 ** (st / 12));
const ARP = [0, 2, 4, 2, 1, 3, 5, 3];

/**
 * Procedural soundtrack for a scene: a beat whose melody climbs with the
 * leader's value ("sonified" chart), stingers on events, and a final hit.
 */
export async function renderSoundtrack(sc: Scene): Promise<AudioBuffer> {
  const total = totalMs(sc) / 1000;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * SAMPLE_RATE), SAMPLE_RATE);
  const master = ctx.createGain();
  master.gain.value = 0.6;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 5;
  master.connect(comp).connect(ctx.destination);

  // shared white noise
  const nb = ctx.createBuffer(1, SAMPLE_RATE * 2, SAMPLE_RATE);
  const nd = nb.getChannelData(0);
  let seed = 1234567;
  for (let i = 0; i < nd.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    nd[i] = seed / 2 ** 31 - 1;
  }

  const tone = (
    type: OscillatorType,
    f0: number,
    at: number,
    dur: number,
    gain: number,
    opts: { f1?: number; attack?: number; pan?: number } = {},
  ) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    if (opts.f1) o.frequency.exponentialRampToValueAtTime(opts.f1, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    let out: AudioNode = o.connect(g);
    if (opts.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = opts.pan;
      out = out.connect(p);
    }
    out.connect(master);
    o.start(at);
    o.stop(at + dur + 0.02);
  };
  const noise = (at: number, dur: number, gain: number, type: BiquadFilterType, f0: number, f1?: number, attack = 0.004) => {
    const src = ctx.createBufferSource();
    src.buffer = nb;
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f0, at);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(flt).connect(g).connect(master);
    src.start(at);
    src.stop(at + dur + 0.02);
  };
  const kick = (at: number, gain = 0.6) => tone("sine", 150, at, 0.28, gain, { f1: 42 });

  const intro = INTRO_MS / 1000;
  const race = sc.raceMs / 1000;
  const n = sc.ms.length;

  // ---- intro: riser + heartbeat ticks ----
  noise(0.05, intro - 0.05, 0.22, "bandpass", 300, 7000, intro * 0.9);
  for (let i = 0; i < 4; i++) tone("sine", 880, 0.3 + i * 0.45, 0.09, 0.12);

  // ---- race ----
  const leaderAt = (i: number) => {
    let m = 0;
    for (const t of sc.tickers) m = Math.max(m, sc.values[t][i]);
    return Math.log(m);
  };
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 600))) {
    const v = leaderAt(i);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const step = 60 / 128 / 4; // 16th notes at 128 bpm
  const steps = Math.floor(race / step);
  kick(intro, 0.8);
  noise(intro, 0.5, 0.2, "highpass", 5000);
  for (let k = 0; k < steps; k++) {
    const at = intro + k * step;
    const prog = k / steps;
    const idx = Math.min(n - 1, Math.round(prog * (n - 1)));
    const norm = hi > lo ? (leaderAt(idx) - lo) / (hi - lo) : 0.5;
    const base = Math.round(norm * (SCALE.length - 6));
    const note = SCALE[Math.min(SCALE.length - 1, base + ARP[k % 8])];
    tone("triangle", note, at, 0.2, k % 4 === 0 ? 0.15 : 0.1, { pan: k % 2 ? 0.35 : -0.35 });
    if (prog > 0.5) tone("sine", note * 2, at, 0.12, 0.04, { pan: k % 2 ? -0.5 : 0.5 });
    if (k % 4 === 0) {
      kick(at, 0.5);
      tone("sawtooth", 55, at, 0.22, 0.09);
    }
    if (k % 4 === 2 && prog > 0.15) noise(at, 0.05, 0.07, "highpass", 8000);
    if (k % 8 === 4 && prog > 0.33) noise(at, 0.14, 0.12, "bandpass", 1900); // snare-ish
  }

  // ---- event stingers ----
  for (const e of sc.events) {
    const at = intro + (e.idx / (n - 1)) * race;
    if (e.kind === "lead") {
      tone("square", 660, at, 0.09, 0.07);
      tone("square", 990, at + 0.08, 0.09, 0.07);
      tone("square", 1320, at + 0.16, 0.18, 0.07);
      noise(at, 0.35, 0.1, "bandpass", 800, 6000, 0.25);
    } else if (e.kind === "mile") {
      tone("sine", 1760, at, 0.7, 0.12);
      tone("sine", 2637, at, 0.5, 0.06);
    } else {
      tone("sawtooth", 220, at, 0.5, 0.1, { f1: 70 });
    }
  }

  // ---- outro: impact + chord ----
  const end = intro + race;
  noise(end - 0.6, 0.6, 0.2, "bandpass", 500, 9000, 0.55); // riser into the hit
  tone("sine", 70, end, 1.8, 0.8, { f1: 34 });
  noise(end, 1.4, 0.3, "highpass", 3000);
  const won = sc.values[sc.finalRank[0]][n - 1] >= sc.invested;
  const chord = won ? [440, 554.37, 659.25, 880, 1108.73] : [220, 261.63, 329.63, 440];
  chord.forEach((f, i) => {
    tone("triangle", f, end + 0.02 + i * 0.06, OUTRO_MS / 1000 - 0.6, 0.11, { attack: 0.03, pan: (i - 2) * 0.25 });
    tone("sine", f * 2, end + 0.02 + i * 0.06, 2.2, 0.03, { attack: 0.03 });
  });
  master.gain.setValueAtTime(0.6, total - 0.5);
  master.gain.linearRampToValueAtTime(0.0001, total);

  return ctx.startRendering();
}

/** Plays a rendered soundtrack in sync with the live preview. */
export class PreviewAudio {
  private ctx: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;

  play(buf: AudioBuffer, offsetSec: number) {
    this.stop();
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.start(0, Math.max(0, Math.min(buf.duration - 0.01, offsetSec)));
      this.src = src;
    } catch {
      /* autoplay blocked or no audio device — preview stays silent */
    }
  }

  stop() {
    try {
      this.src?.stop();
    } catch {
      /* already stopped */
    }
    this.src = null;
  }
}
