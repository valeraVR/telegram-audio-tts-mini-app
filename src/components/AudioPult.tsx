"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ControlPanel from "@/components/ControlPanel";
import TextScreen from "@/components/TextScreen";
import { bufferToWav, getRawSpeech, renderWithSettings, type RawSpeech } from "@/lib/audio";
import { loadCloudVoices, loadLocalVoices, saveVoices } from "@/lib/storage";
import { getWebApp, haptic } from "@/lib/telegram";
import { usePlayer } from "@/lib/usePlayer";
import {
  DEFAULT_SETTINGS,
  MAX_VOICES,
  PRESETS,
  sanitizeSettings,
  toEdgeParams,
  type SavedVoice,
  type VoiceSettings,
} from "@/lib/voice";

const SAMPLE_TEXT = "Привет! Это пример звучания вашего голоса. Проверьте скорость, тон и эквалайзер.";

export default function AudioPult() {
  const [screen, setScreen] = useState<"pult" | "text">("pult");
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_SETTINGS);
  const [name, setName] = useState("");
  const [voices, setVoices] = useState<SavedVoice[]>([]);
  const [applied, setApplied] = useState<{ settings: VoiceSettings; name: string } | null>(null);
  const [initData, setInitData] = useState("");
  const [inTelegram, setInTelegram] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const player = usePlayer();
  const sampleCache = useRef<{ key: string; raw: RawSpeech } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Инициализация Telegram WebApp + загрузка пресетов
  useEffect(() => {
    const tg = getWebApp();
    if (tg) {
      try {
        tg.ready();
        tg.expand();
        tg.setHeaderColor?.("#05031a");
        tg.setBackgroundColor?.("#05031a");
      } catch {
        /* ignore */
      }
      setInTelegram(true);
      setInitData(tg.initData || "");
    }
    setVoices(loadLocalVoices());
    loadCloudVoices().then((cloud) => {
      if (cloud && cloud.length) setVoices(cloud);
    });
  }, []);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  const patch = (p: Partial<VoiceSettings>) => setSettings((s) => ({ ...s, ...p }));

  const applyPreset = (id: (typeof PRESETS)[number]["id"]) => {
    const pr = PRESETS.find((x) => x.id === id)!;
    setSettings({ ...pr.settings, preset: id });
    haptic("light");
  };

  const resolveName = () => name.trim() || `Мой голос #${voices.length + 1}`;

  const persist = (list: SavedVoice[]) => {
    setVoices(list);
    saveVoices(list);
  };

  const saveVoice = () => {
    if (voices.length >= MAX_VOICES) return notify(`Лимит: не более ${MAX_VOICES} голосов`);
    const n = resolveName();
    persist([...voices, { id: Date.now().toString(36), name: n, settings: { ...settings } }]);
    setName(n);
    haptic("success");
    notify(`Голос «${n}» сохранён`);
  };

  const loadVoice = (id: string) => {
    const v = voices.find((x) => x.id === id);
    if (!v) return;
    setSettings(sanitizeSettings(v.settings));
    setName(v.name);
    notify(`Загружен голос «${v.name}»`);
  };

  const deleteVoice = (id: string) => persist(voices.filter((v) => v.id !== id));

  const commitName = () => {
    const n = resolveName();
    setName(name.trim());
    notify(`Название: «${n}»`);
  };

  const sample = async () => {
    if (player.playing) return player.stop();
    setSampleLoading(true);
    try {
      const p = toEdgeParams(settings);
      const key = `${p.voice}|${p.rate}|${p.pitch}|${settings.voice}|${settings.speed}`;
      if (sampleCache.current?.key !== key) {
        sampleCache.current = { key, raw: await getRawSpeech(SAMPLE_TEXT, settings) };
      }
      const processed = await renderWithSettings(sampleCache.current.raw.buffer, settings);
      await player.play(bufferToWav(processed));
    } catch {
      notify("Не удалось воспроизвести пример");
    } finally {
      setSampleLoading(false);
    }
  };

  const apply = () => {
    player.stop();
    setApplied({ settings: { ...settings }, name: resolveName() });
    setScreen("text");
    haptic("medium");
  };

  const isDemo = !initData;

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <div className="blob blob-a" />
      <div className="blob blob-b" />
      <div className="blob blob-c" />
      <div className="blob blob-d" />

      <div className="relative z-10 mx-auto w-full max-w-[760px] px-3 sm:px-5 py-4 sm:py-8">
        {isDemo && (
          <div className="mb-3 rounded-2xl border border-white/30 bg-gradient-to-r from-white/30 via-fuchsia-200/30 to-indigo-200/30 px-5 py-2.5 text-[15px] text-white/90 backdrop-blur-md">
            Telegram · Mini App (демо-режим)
          </div>
        )}

        <div className={screen === "pult" || !applied ? "" : "hidden"}>
          <ControlPanel
            settings={settings}
            onChange={patch}
            onPreset={applyPreset}
            name={name}
            setName={setName}
            onCommitName={commitName}
            voices={voices}
            onSaveVoice={saveVoice}
            onLoadVoice={loadVoice}
            onDeleteVoice={deleteVoice}
            sampleState={sampleLoading ? "loading" : player.playing ? "playing" : "idle"}
            onSample={sample}
            onApply={apply}
            isDemo={isDemo}
            inTelegram={inTelegram}
          />
        </div>
        {applied && (
          <div className={screen === "text" ? "" : "hidden"}>
            <TextScreen
              settings={applied.settings}
              voiceName={applied.name}
              initData={initData}
              onEdit={() => setScreen("pult")}
              notify={notify}
            />
          </div>
        )}
      </div>

      {toast && (
        <div
          role="status"
          className="fixed left-1/2 -translate-x-1/2 bottom-5 z-50 max-w-[92vw] w-[520px] rounded-2xl border border-cyan-200/50 bg-[#120c3d]/85 backdrop-blur-xl px-4 py-3 text-sm shadow-[0_0_30px_rgba(79,227,255,0.35)]"
        >
          {toast}
        </div>
      )}
    </main>
  );
}
