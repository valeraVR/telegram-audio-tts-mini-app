// Общие типы и маппинг параметров «Аудио-пульта» (используется и на клиенте, и на сервере)

export type VoiceId = "neutral" | "deep" | "soft" | "announcer";
export type PresetId = "podcast" | "audiobook" | "radio" | "shorts";
export type SendFormat = "voice" | "audio";

export interface VoiceSettings {
  voice: VoiceId;
  speed: number; // 0.5 .. 2.0
  pitch: number; // -50 .. +50 (%)
  expression: number; // 0..3
  lowDb: number; // -12..12
  midDb: number;
  highDb: number;
  preset: PresetId | null;
}

export const DEFAULT_SETTINGS: VoiceSettings = {
  voice: "neutral",
  speed: 1,
  pitch: 0,
  expression: 1,
  lowDb: 0,
  midDb: 0,
  highDb: 0,
  preset: null,
};

export const VOICES: { id: VoiceId; label: string; edge: string }[] = [
  { id: "neutral", label: "Нейтральный", edge: "ru-RU-SvetlanaNeural" },
  { id: "deep", label: "Мужской глубокий", edge: "en-US-BrianMultilingualNeural" },
  { id: "soft", label: "Женский мягкий", edge: "en-US-EmmaMultilingualNeural" },
  { id: "announcer", label: "Дикторский", edge: "en-US-BrianMultilingualNeural" },
];

export const EXPRESSION_LABELS = ["Низкий", "Средний", "Высокий", "Максимум"];

export const PRESETS: {
  id: PresetId;
  label: string;
  icon: string;
  settings: Omit<VoiceSettings, "preset">;
}[] = [
  {
    id: "podcast",
    label: "Подкаст",
    icon: "🎙️",
    settings: { voice: "neutral", speed: 1.05, pitch: -3, expression: 2, lowDb: 3, midDb: 1, highDb: 2 },
  },
  {
    id: "audiobook",
    label: "Аудиокнига",
    icon: "📖",
    settings: { voice: "soft", speed: 0.9, pitch: -5, expression: 1, lowDb: 2, midDb: 0, highDb: -1 },
  },
  {
    id: "radio",
    label: "Радио-диктор",
    icon: "📻",
    settings: { voice: "announcer", speed: 1, pitch: -4, expression: 2, lowDb: 2, midDb: 2, highDb: 1 },
  },
  {
    id: "shorts",
    label: "Озвучка Shorts",
    icon: "⚡",
    settings: { voice: "neutral", speed: 1.25, pitch: 8, expression: 3, lowDb: 0, midDb: 2, highDb: 4 },
  },
];

export const PRESET_LABEL: Record<PresetId, string> = {
  podcast: "Подкаст",
  audiobook: "Аудиокнига",
  radio: "Радио-диктор",
  shorts: "Озвучка Shorts",
};

// Экспрессия: лёгкие сдвиги скорости (%), тона (Гц) и усиление НЧ/ВЧ (дБ)
const EXPRESSION_PROFILE = [
  { rate: -6, pitchHz: -3, lowDb: 0, highDb: -1.5 },
  { rate: 0, pitchHz: 0, lowDb: 0, highDb: 0 },
  { rate: 4, pitchHz: 4, lowDb: 0.5, highDb: 1.5 },
  { rate: 8, pitchHz: 8, lowDb: 1, highDb: 3 },
];

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const signed = (n: number, unit: string) => `${n >= 0 ? "+" : "-"}${Math.abs(n)}${unit}`;

export function sanitizeSettings(raw: Partial<VoiceSettings> | null | undefined): VoiceSettings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  const voice = VOICES.some((v) => v.id === s.voice) ? s.voice : "neutral";
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    voice,
    speed: clamp(num(s.speed, 1), 0.5, 2),
    pitch: clamp(num(s.pitch, 0), -50, 50),
    expression: Math.round(clamp(num(s.expression, 1), 0, 3)),
    lowDb: clamp(num(s.lowDb, 0), -12, 12),
    midDb: clamp(num(s.midDb, 0), -12, 12),
    highDb: clamp(num(s.highDb, 0), -12, 12),
    preset: s.preset ?? null,
  };
}

export interface EdgeParams {
  voice: string;
  rate: string; // "+25%"
  pitch: string; // "+15Hz"
  lowDb: number;
  midDb: number;
  highDb: number;
}

/** Итоговые параметры Edge-TTS + эквалайзера (с учётом экспрессии и «Дикторского» голоса) */
export function toEdgeParams(input: VoiceSettings): EdgeParams {
  const s = sanitizeSettings(input);
  const profile = EXPRESSION_PROFILE[s.expression];
  const voiceDef = VOICES.find((v) => v.id === s.voice)!;
  const announcer = s.voice === "announcer";

  const ratePct = clamp(Math.round((s.speed - 1) * 100) + profile.rate, -50, 100);
  // 10% тона ≈ 15 Гц; «Дикторский»: -12 Гц, «Мужской глубокий»: -6 Гц
  const voicePitch = announcer ? -12 : s.voice === "deep" ? -6 : 0;
  const pitchHz = clamp(Math.round(s.pitch * 1.5) + profile.pitchHz + voicePitch, -100, 100);

  const round1 = (n: number) => Math.round(clamp(n, -15, 15) * 10) / 10;
  return {
    voice: voiceDef.edge,
    rate: signed(ratePct, "%"),
    pitch: signed(pitchHz, "Hz"),
    lowDb: round1(s.lowDb + profile.lowDb + (announcer ? 4 : s.voice === "deep" ? 2 : 0)),
    midDb: round1(s.midDb),
    highDb: round1(s.highDb + profile.highDb),
  };
}

export function ffmpegEqFilter(p: Pick<EdgeParams, "lowDb" | "midDb" | "highDb">): string {
  return (
    `equalizer=f=100:t=q:w=1:g=${p.lowDb},` +
    `equalizer=f=1000:t=q:w=1:g=${p.midDb},` +
    `equalizer=f=8000:t=q:w=1:g=${p.highDb}`
  );
}

export const fmtSpeed = (v: number) => `${v.toFixed(2)}x`;
export const fmtPitch = (v: number) => `${v > 0 ? "+" : ""}${v}%`;
export const fmtDb = (v: number) => `${v > 0 ? "+" : ""}${Number.isInteger(v) ? v : v.toFixed(1)} дБ`;

export const MAX_VOICES = 10;
export const MAX_TEXT = 3000;

export interface SavedVoice {
  id: string;
  name: string;
  settings: VoiceSettings;
}
