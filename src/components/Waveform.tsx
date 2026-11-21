"use client";

interface Props {
  peaks: number[] | null;
  progress: number;
  active: boolean;
}

const BARS = 56;
const idle = Array.from({ length: BARS }, (_, i) => 0.12 + 0.08 * Math.abs(Math.sin(i * 0.6)));

/** Визуализация звуковой волны: бары по пикам буфера + подсветка прогресса воспроизведения */
export default function Waveform({ peaks, progress, active }: Props) {
  const data = peaks ?? idle;
  return (
    <div
      className="glass-inner h-20 px-3 flex items-center gap-[3px]"
      aria-label="Звуковая волна"
      role="img"
    >
      {data.map((v, i) => {
        const done = peaks && i / data.length <= progress;
        return (
          <div
            key={i}
            className="flex-1 rounded-full transition-colors"
            style={{
              height: `${Math.max(8, v * 100)}%`,
              background: done ? "#5ceaff" : peaks ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.18)",
              boxShadow: done ? "0 0 8px rgba(79,227,255,0.9)" : undefined,
              animation: active && !peaks ? `pulse-glow 1.2s ${i * 20}ms infinite` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
