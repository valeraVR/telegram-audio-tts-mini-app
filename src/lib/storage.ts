import { getWebApp } from "@/lib/telegram";
import { MAX_VOICES, sanitizeSettings, type SavedVoice } from "@/lib/voice";

const KEY = "audio-pult:voices";

function normalize(raw: unknown): SavedVoice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v) => v && typeof v === "object" && typeof (v as SavedVoice).name === "string")
    .slice(0, MAX_VOICES)
    .map((v: SavedVoice) => ({
      id: String(v.id ?? Math.random().toString(36).slice(2)),
      name: v.name,
      settings: sanitizeSettings(v.settings),
    }));
}

export function loadLocalVoices(): SavedVoice[] {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function loadCloudVoices(): Promise<SavedVoice[] | null> {
  const cs = getWebApp()?.CloudStorage;
  if (!cs) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      cs.getItem(KEY, (err, value) => {
        if (err || !value) return resolve(null);
        try {
          resolve(normalize(JSON.parse(value)));
        } catch {
          resolve(null);
        }
      });
    } catch {
      resolve(null);
    }
  });
}

export function saveVoices(voices: SavedVoice[]) {
  const json = JSON.stringify(voices);
  try {
    localStorage.setItem(KEY, json);
  } catch {
    /* ignore */
  }
  try {
    // CloudStorage: лимит значения 4096 символов
    if (json.length <= 4096) getWebApp()?.CloudStorage?.setItem(KEY, json);
  } catch {
    /* ignore */
  }
}
