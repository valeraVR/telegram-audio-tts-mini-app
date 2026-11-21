// Клиентская обработка звука: Web Audio API (BiquadFilterNode + OfflineAudioContext)
import { toEdgeParams, type VoiceSettings } from "@/lib/voice";

const SR = 24000;

export type SpeechSource = "edge" | "synthetic";

export interface RawSpeech {
  buffer: AudioBuffer; // без эквалайзера
  blob: Blob; // исходный файл (mp3 / wav) без эквалайзера — уходит на бэкенд
  source: SpeechSource;
}

async function decode(data: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.decodeAudioData(data.slice(0));
}

let edgeDownUntil = 0; // после сбоя Edge-TTS не ждём его повторно в течение минуты

async function fetchEdge(text: string, settings: VoiceSettings): Promise<Blob | null> {
  if (Date.now() < edgeDownUntil) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, settings }),
        signal: AbortSignal.timeout(55000),
      });
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0) return blob;
      }
    } catch {
      /* сеть / таймаут */
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  edgeDownUntil = Date.now() + 10000;
  return null;
}

/** Получить «сырую» речь: Edge-TTS с сервера, при недоступности — локальный формантный синтезатор */
export async function getRawSpeech(text: string, settings: VoiceSettings): Promise<RawSpeech> {
  const edge = await fetchEdge(text, settings);
  if (edge) {
    try {
      const buffer = await decode(await edge.arrayBuffer());
      return { buffer, blob: edge, source: "edge" };
    } catch {
      /* fall through */
    }
  }
  const buffer = await synthFallback(text, settings);
  return { buffer, blob: bufferToWav(buffer), source: "synthetic" };
}

/** 3-полосный EQ: peaking-фильтры 100 Гц / 1 кГц / 8 кГц (Q=1, как equalizer=...:t=q:w=1 в FFmpeg) */
export async function applyEq(
  buffer: AudioBuffer,
  eq: { lowDb: number; midDb: number; highDb: number },
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil(buffer.duration * buffer.sampleRate) + 256, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const bands: [number, number][] = [
    [100, eq.lowDb],
    [1000, eq.midDb],
    [8000, eq.highDb],
  ];
  let node: AudioNode = src;
  for (const [freq, gain] of bands) {
    const f = ctx.createBiquadFilter();
    f.type = "peaking";
    f.frequency.value = freq;
    f.Q.value = 1;
    f.gain.value = gain;
    node.connect(f);
    node = f;
  }
  node.connect(ctx.destination);
  src.start();
  return normalize(await ctx.startRendering());
}

/** Финальный буфер для прослушивания: EQ + экспрессия + дикторский буст */
export function renderWithSettings(raw: AudioBuffer, settings: VoiceSettings) {
  const p = toEdgeParams(settings);
  return applyEq(raw, p);
}

function normalize(buffer: AudioBuffer): AudioBuffer {
  const d = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0.98 || (peak > 0 && peak < 0.3)) {
    const k = 0.9 / peak;
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  return buffer;
}

export function bufferToWav(buffer: AudioBuffer): Blob {
  const data = buffer.getChannelData(0);
  const ab = new ArrayBuffer(44 + data.length * 2);
  const v = new DataView(ab);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + data.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([ab], { type: "audio/wav" });
}

export function computePeaks(buffer: AudioBuffer, bars: number): number[] {
  const d = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(d.length / bars));
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    let m = 0;
    for (let j = i * step; j < Math.min(d.length, (i + 1) * step); j++) m = Math.max(m, Math.abs(d[j]));
    out.push(m);
  }
  const max = Math.max(...out, 0.0001);
  return out.map((x) => x / max);
}

// ───────── Локальный формантный синтезатор (резерв, когда Edge-TTS недоступен) ─────────

const FORMANTS: Record<string, [number, number]> = {
  а: [800, 1200], я: [800, 1300], о: [500, 900], ё: [500, 1000], у: [350, 800], ю: [350, 1000],
  э: [550, 1800], е: [500, 1900], и: [300, 2300], ы: [350, 1700],
  a: [800, 1200], e: [550, 1800], i: [300, 2300], o: [500, 900], u: [350, 800], y: [350, 1700],
};
const VOICED = new Set("бвгджзлмнр".split(""));
const FRICATIVE = new Set("сшфхчщцsfxzh".split(""));
const PLOSIVE = new Set("птктpktc".split(""));
const PAUSE = new Set(".!?;:\n".split(""));
const BASE_F0: Record<VoiceSettings["voice"], number> = { neutral: 185, deep: 108, soft: 225, announcer: 96 };

export async function synthFallback(text: string, settings: VoiceSettings): Promise<AudioBuffer> {
  const chars = [...text.toLowerCase().replace(/\d/g, "о")].slice(0, 420);
  const speed = settings.speed;
  const f0 = BASE_F0[settings.voice] * (1 + settings.pitch / 100) * (1 + (settings.expression - 1) * 0.03);
  const vib = 0.01 + settings.expression * 0.012;

  const timeline = chars.map((ch) => {
    let d = 0.07;
    if (ch in FORMANTS) d = 0.11;
    else if (ch === " ") d = 0.07;
    else if (PAUSE.has(ch)) d = 0.32;
    else if (ch === ",") d = 0.18;
    return d / speed;
  });
  const total = timeline.reduce((a, b) => a + b, 0) + 0.3;

  const ctx = new OfflineAudioContext(1, Math.max(SR, Math.ceil(total * SR)), SR);
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  const mk = (q: number) => {
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = q;
    return f;
  };
  const f1 = mk(7);
  const f2 = mk(9);
  const env = ctx.createGain();
  env.gain.value = 0;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  osc.connect(f1);
  osc.connect(f2);
  f1.connect(env);
  f2.connect(env);
  env.connect(master);

  const nbuf = ctx.createBuffer(1, SR * 2, SR);
  const nd = nbuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = nbuf;
  noise.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 4500;
  const ng = ctx.createGain();
  ng.gain.value = 0;
  noise.connect(hp);
  hp.connect(ng);
  ng.connect(master);
  master.connect(ctx.destination);

  let t = 0.05;
  let sentenceStart = 0;
  chars.forEach((ch, i) => {
    const d = timeline[i];
    const decl = 1 - 0.08 * Math.min(1, (i - sentenceStart) / 40);
    const freq = f0 * decl * (1 + vib * Math.sin(i * 1.7));
    osc.frequency.setTargetAtTime(freq, t, 0.025);
    if (ch in FORMANTS) {
      const [a, b] = FORMANTS[ch];
      const scale = settings.voice === "soft" || settings.voice === "neutral" ? 1.12 : 1;
      f1.frequency.setTargetAtTime(a * scale, t, 0.02);
      f2.frequency.setTargetAtTime(b * scale, t, 0.02);
      env.gain.setTargetAtTime(1, t, 0.015);
      env.gain.setTargetAtTime(0.55, t + d * 0.75, 0.02);
      ng.gain.setTargetAtTime(0, t, 0.01);
    } else if (VOICED.has(ch)) {
      f1.frequency.setTargetAtTime(450, t, 0.02);
      f2.frequency.setTargetAtTime(1400, t, 0.02);
      env.gain.setTargetAtTime(0.35, t, 0.015);
      ng.gain.setTargetAtTime(0, t, 0.01);
    } else if (FRICATIVE.has(ch)) {
      env.gain.setTargetAtTime(0, t, 0.01);
      ng.gain.setTargetAtTime(0.28, t, 0.01);
      ng.gain.setTargetAtTime(0, t + d * 0.8, 0.01);
    } else if (PLOSIVE.has(ch)) {
      env.gain.setTargetAtTime(0, t, 0.005);
      ng.gain.setTargetAtTime(0, t, 0.005);
      ng.gain.setTargetAtTime(0.35, t + d * 0.55, 0.004);
      ng.gain.setTargetAtTime(0, t + d * 0.8, 0.006);
    } else {
      env.gain.setTargetAtTime(0, t, 0.02);
      ng.gain.setTargetAtTime(0, t, 0.02);
      if (PAUSE.has(ch)) sentenceStart = i;
    }
    t += d;
  });
  env.gain.setTargetAtTime(0, t, 0.03);
  ng.gain.setTargetAtTime(0, t, 0.03);

  osc.start();
  noise.start();
  return normalize(await ctx.startRendering());
}
