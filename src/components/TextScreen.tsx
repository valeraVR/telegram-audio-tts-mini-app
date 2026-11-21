"use client";

import { useEffect, useRef, useState } from "react";
import Waveform from "@/components/Waveform";
import { bufferToWav, computePeaks, getRawSpeech, renderWithSettings, type RawSpeech } from "@/lib/audio";
import { getWebApp, haptic } from "@/lib/telegram";
import { usePlayer } from "@/lib/usePlayer";
import { MAX_TEXT, PRESET_LABEL, fmtSpeed, type SendFormat, type VoiceSettings } from "@/lib/voice";

interface Props {
  settings: VoiceSettings;
  voiceName: string;
  initData: string;
  onEdit: () => void;
  notify: (msg: string) => void;
}

export default function TextScreen({ settings, voiceName, initData, onEdit, notify }: Props) {
  const [text, setText] = useState("");
  const [format, setFormat] = useState<SendFormat>("voice");
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const rawCache = useRef<{ text: string; raw: RawSpeech } | null>(null);
  const player = usePlayer();
  const isDemo = !initData;

  // при изменении текста — сбрасываем предпрослушивание
  useEffect(() => {
    setPeaks(null);
    setSource(null);
    player.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(
    () => () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    },
    [resultUrl],
  );

  const trimmed = text.trim();

  async function ensureRaw(): Promise<RawSpeech> {
    if (rawCache.current?.text === trimmed) return rawCache.current.raw;
    const raw = await getRawSpeech(trimmed, settings);
    rawCache.current = { text: trimmed, raw };
    return raw;
  }

  async function generateAndPlay() {
    if (player.playing) return player.stop();
    if (!trimmed) return notify("Введите текст для озвучки");
    setGenerating(true);
    try {
      const raw = await ensureRaw();
      const processed = await renderWithSettings(raw.buffer, settings);
      setPeaks(computePeaks(processed, 56));
      setSource(raw.source === "edge" ? "Edge-TTS" : "локальный синтезатор");
      await player.play(bufferToWav(processed));
    } catch {
      notify("Не удалось сгенерировать звук");
    } finally {
      setGenerating(false);
    }
  }

  async function send() {
    if (!trimmed) return notify("Введите текст для озвучки");
    player.stop();
    setSending(true);
    haptic("medium");
    const tg = getWebApp();
    try {
      const raw = await ensureRaw();

      if (isDemo) {
        // Fallback вне Telegram: симуляция отправки + плеер с результатом
        await new Promise((r) => setTimeout(r, 1200));
        const processed = await renderWithSettings(raw.buffer, settings);
        setPeaks(computePeaks(processed, 56));
        setResultUrl(URL.createObjectURL(bufferToWav(processed)));
        notify(
          `Демо-режим: отправка в чат симулирована (${format === "voice" ? "голосовое .ogg" : "аудиофайл .mp3"}). Прослушайте результат ниже.`,
        );
        return;
      }

      const fd = new FormData();
      fd.set("initData", initData);
      fd.set("text", trimmed);
      fd.set("settings", JSON.stringify(settings));
      fd.set("format", format);
      fd.set("name", voiceName);
      fd.set("audio", raw.blob, raw.source === "edge" ? "speech.mp3" : "speech.wav");

      const res = await fetch("/api/send-voice", { method: "POST", body: fd });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Ошибка ${res.status}`);

      haptic("success");
      if (tg?.showAlert) tg.showAlert("Аудио отправлено в чат!", () => tg.close());
      else notify("Аудио отправлено в чат!");
    } catch (e) {
      haptic("error");
      const msg = e instanceof Error ? e.message : "Не удалось отправить аудио";
      if (tg?.showAlert) tg.showAlert(`Ошибка: ${msg}`);
      else notify(`Ошибка: ${msg}`);
    } finally {
      setSending(false);
    }
  }

  const preset = settings.preset ? ` · ${PRESET_LABEL[settings.preset]}` : "";

  return (
    <section className="glass-card p-4 sm:p-6 space-y-4">
      {/* Активный голос */}
      <div className="glass-inner flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-cyan-200/70">Активный голос</div>
          <div className="truncate font-semibold neon-text">
            Голос: {voiceName} · {fmtSpeed(settings.speed)}
            {preset}
          </div>
        </div>
        <button type="button" className="btn-glass !py-2 !px-3 text-sm shrink-0" onClick={onEdit}>
          ✎ Изменить голос
        </button>
      </div>

      {/* Текст */}
      <div className="glass-inner p-3">
        <textarea
          className="w-full min-h-[200px] sm:min-h-[240px] resize-y bg-transparent outline-none text-base leading-relaxed placeholder:text-white/45"
          placeholder="Введите или вставьте текст для озвучки..."
          value={text}
          maxLength={MAX_TEXT}
          onChange={(e) => setText(e.target.value)}
          aria-label="Текст для озвучки"
        />
        <div className="flex items-center justify-between pt-2 border-t border-white/15 text-sm text-white/60">
          <span>
            {text.length} / {MAX_TEXT}
          </span>
          <button
            type="button"
            className="rounded-full px-3 py-1 border border-white/25 bg-white/10 hover:border-cyan-300 disabled:opacity-40"
            disabled={!text}
            onClick={() => {
              setText("");
              setResultUrl(null);
            }}
          >
            ✕ Очистить
          </button>
        </div>
      </div>

      {/* Формат */}
      <div>
        <div className="text-sm text-white/65 mb-2">Формат отправки в чат</div>
        <div className="flex gap-2.5 flex-wrap">
          <button
            type="button"
            className={`pill ${format === "voice" ? "pill-active" : ""}`}
            onClick={() => setFormat("voice")}
            aria-pressed={format === "voice"}
          >
            🎙 Голосовое сообщение
          </button>
          <button
            type="button"
            className={`pill ${format === "audio" ? "pill-active" : ""}`}
            onClick={() => setFormat("audio")}
            aria-pressed={format === "audio"}
          >
            🎵 Аудиофайл
          </button>
        </div>
        <p className="text-xs text-white/50 mt-2">
          {format === "voice"
            ? "Придёт как нативное голосовое сообщение с волной (.ogg, Opus 48 кГц, моно)."
            : "Придёт как аудиотрек (.mp3) с названием голоса."}
        </p>
      </div>

      {/* Предпрослушивание */}
      <div className="space-y-3">
        <Waveform peaks={peaks} progress={player.progress} active={generating} />
        <button type="button" className="btn-glass w-full" onClick={generateAndPlay} disabled={generating || sending}>
          {generating ? (
            <>
              <span className="spinner" /> Генерируем звук…
            </>
          ) : player.playing ? (
            <>■ Остановить</>
          ) : (
            <>▶ Сгенерировать и прослушать</>
          )}
        </button>
        {source && <div className="text-xs text-white/50 text-center">Источник голоса: {source}</div>}
        {resultUrl && (
          <div className="glass-inner p-3">
            <div className="text-xs text-cyan-200/80 mb-1.5">Результат (демо-режим):</div>
            <audio controls src={resultUrl} className="w-full" />
          </div>
        )}
      </div>

      <button type="button" className="btn-neon" onClick={send} disabled={sending || generating}>
        {sending ? (
          <>
            <span className="spinner" /> Отправляем аудио в ваш чат...
          </>
        ) : (
          <>✈️ Отправить аудио в чат</>
        )}
      </button>
      {isDemo && (
        <p className="text-xs text-center text-white/45">
          Вне Telegram включён демо-режим: отправка симулируется, звук можно прослушать в плеере.
        </p>
      )}
    </section>
  );
}
