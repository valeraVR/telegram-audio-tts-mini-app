"use client";

import { useEffect, useRef, useState } from "react";
import EqGraph from "@/components/EqGraph";
import Slider from "@/components/Slider";
import {
  EXPRESSION_LABELS,
  MAX_VOICES,
  PRESETS,
  VOICES,
  fmtDb,
  fmtPitch,
  fmtSpeed,
  type SavedVoice,
  type VoiceId,
  type VoiceSettings,
} from "@/lib/voice";

interface Props {
  settings: VoiceSettings;
  onChange: (patch: Partial<VoiceSettings>) => void;
  onPreset: (id: (typeof PRESETS)[number]["id"]) => void;
  name: string;
  setName: (v: string) => void;
  onCommitName: () => void;
  voices: SavedVoice[];
  onSaveVoice: () => void;
  onLoadVoice: (id: string) => void;
  onDeleteVoice: (id: string) => void;
  sampleState: "idle" | "loading" | "playing";
  onSample: () => void;
  onApply: () => void;
  isDemo: boolean;
  inTelegram: boolean;
}

function VoiceMenu({
  voices,
  onLoad,
  onDelete,
}: {
  voices: SavedVoice[];
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, []);

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        className="glass-field text-left flex items-center justify-between gap-2 !py-2.5 text-[15px] whitespace-nowrap"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>
          Мои голоса ({voices.length}/{MAX_VOICES})
        </span>
        <svg width="14" height="9" viewBox="0 0 14 9" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M1 1l6 6 6-6" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-30 mt-2 w-72 max-w-[85vw] rounded-2xl border border-white/30 bg-[#150e45]/90 backdrop-blur-xl p-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.6),0_0_24px_rgba(79,227,255,0.2)]"
        >
          {voices.length === 0 && (
            <div className="px-3 py-3 text-sm text-white/60">Пока пусто — сохраните голос кнопкой «💾 В «Мои голоса»»</div>
          )}
          {voices.map((v) => (
            <div key={v.id} className="flex items-center gap-1 rounded-xl hover:bg-white/10">
              <button
                type="button"
                className="flex-1 min-w-0 text-left px-3 py-2.5"
                onClick={() => {
                  onLoad(v.id);
                  setOpen(false);
                }}
              >
                <div className="truncate font-semibold">{v.name}</div>
                <div className="text-xs text-white/55">
                  {VOICES.find((x) => x.id === v.settings.voice)?.label} · {fmtSpeed(v.settings.speed)}
                </div>
              </button>
              <button
                type="button"
                aria-label={`Удалить ${v.name}`}
                className="px-3 py-2 text-white/60 hover:text-pink-300"
                onClick={() => onDelete(v.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ControlPanel(p: Props) {
  const s = p.settings;
  return (
    <section className="glass-card p-4 sm:p-6">
      {/* Шапка */}
      <header className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-2xl" aria-hidden>
            🎛️
          </span>
          <h1 className="text-[1.45rem] sm:text-3xl font-bold leading-none neon-text whitespace-nowrap">Аудио-пульт</h1>
          <span
            className={`rounded-full px-2.5 py-1 text-[13px] border ${
              p.isDemo
                ? "bg-white/15 border-white/25 text-white/80"
                : "bg-cyan-300/20 border-cyan-200/60 text-cyan-100 shadow-[0_0_12px_rgba(79,227,255,0.6)]"
            }`}
          >
            {p.isDemo ? "демо" : p.inTelegram ? "online" : "web"}
          </span>
        </div>
        <div className="w-[190px] sm:w-[260px] shrink-0">
          <VoiceMenu voices={p.voices} onLoad={p.onLoadVoice} onDelete={p.onDeleteVoice} />
        </div>
      </header>

      {/* Пресеты */}
      <div className="no-scrollbar flex gap-2.5 overflow-x-auto -mx-1 px-1 pb-3 pt-1 flex-wrap sm:flex-nowrap">
        {PRESETS.map((pr) => (
          <button
            key={pr.id}
            type="button"
            className={`pill ${s.preset === pr.id ? "pill-active" : ""}`}
            onClick={() => p.onPreset(pr.id)}
          >
            <span aria-hidden>{pr.icon}</span>
            {pr.label}
          </button>
        ))}
      </div>

      {/* Параметры 2x2 */}
      <div className="grid grid-cols-2 gap-x-5 sm:gap-x-8 gap-y-4 mt-1">
        <div className="min-w-0">
          <label htmlFor="voice" className="text-base text-white/70">
            Голос
          </label>
          <select
            id="voice"
            className="glass-field mt-1.5 text-[1.05rem] !py-3"
            value={s.voice}
            onChange={(e) => p.onChange({ voice: e.target.value as VoiceId })}
          >
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <Slider
          label="Скорость"
          valueText={fmtSpeed(s.speed)}
          min={0.5}
          max={2}
          step={0.05}
          value={s.speed}
          onChange={(v) => p.onChange({ speed: Math.round(v * 100) / 100 })}
        />
        <Slider
          label="Высота тона"
          valueText={fmtPitch(s.pitch)}
          min={-50}
          max={50}
          step={1}
          value={s.pitch}
          onChange={(v) => p.onChange({ pitch: v })}
        />
        <Slider
          label="Экспрессия"
          valueText={EXPRESSION_LABELS[s.expression]}
          min={0}
          max={3}
          step={1}
          value={s.expression}
          onChange={(v) => p.onChange({ expression: v })}
        />
      </div>

      {/* Эквалайзер */}
      <div className="glass-inner mt-5 px-3 sm:px-5 pt-3 pb-4">
        <EqGraph low={s.lowDb} mid={s.midDb} high={s.highDb} onChange={(k, v) => p.onChange({ [k]: v })} />
        <div className="grid grid-cols-3 gap-3 sm:gap-5 mt-1">
          <Slider
            compact
            hint="100 Гц"
            label="Low · бас"
            valueText={fmtDb(s.lowDb)}
            min={-12}
            max={12}
            step={1}
            value={s.lowDb}
            onChange={(v) => p.onChange({ lowDb: v })}
          />
          <Slider
            compact
            hint="1 кГц"
            label="Mid · середина"
            valueText={fmtDb(s.midDb)}
            min={-12}
            max={12}
            step={1}
            value={s.midDb}
            onChange={(v) => p.onChange({ midDb: v })}
          />
          <Slider
            compact
            hint="8 кГц"
            label="High · верх"
            valueText={fmtDb(s.highDb)}
            min={-12}
            max={12}
            step={1}
            value={s.highDb}
            onChange={(v) => p.onChange({ highDb: v })}
          />
        </div>
      </div>

      {/* Название */}
      <form
        className="flex gap-3 mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          p.onCommitName();
        }}
      >
        <input
          className="glass-field text-base"
          placeholder={`Название (пусто — «Мой голос #${p.voices.length + 1}»)`}
          value={p.name}
          maxLength={40}
          onChange={(e) => p.setName(e.target.value)}
        />
        <button type="submit" className="btn-glass !px-6 !py-2 text-lg">
          ОК
        </button>
      </form>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <button type="button" className="btn-glass" onClick={p.onSample} disabled={p.sampleState === "loading"}>
          {p.sampleState === "loading" ? (
            <>
              <span className="spinner" /> Генерируем…
            </>
          ) : p.sampleState === "playing" ? (
            <>■ Остановить</>
          ) : (
            <>▶ Прослушать пример</>
          )}
        </button>
        <button type="button" className="btn-glass" onClick={p.onSaveVoice}>
          💾 В «Мои голоса»
        </button>
      </div>

      <button type="button" className="btn-neon mt-3" onClick={p.onApply}>
        <span aria-hidden>✅</span> Применить и перейти к тексту
      </button>
    </section>
  );
}
