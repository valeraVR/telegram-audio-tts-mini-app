"use client";

import { haptic } from "@/lib/telegram";

interface Props {
  label: string;
  valueText: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  compact?: boolean;
}

export default function Slider({ label, valueText, min, max, step, value, onChange, hint, compact }: Props) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className="min-w-0">
      <div className="flex items-end justify-between gap-2 leading-tight">
        <div className="min-w-0">
          {hint && <div className="text-[11px] text-white/55">{hint}</div>}
          <span className={`${compact ? "text-[13px]" : "text-base"} text-white/70 truncate block`}>{label}</span>
        </div>
        <span className={`${compact ? "text-[13px]" : "text-base"} font-semibold text-white whitespace-nowrap`}>
          {valueText}
        </span>
      </div>
      <input
        type="range"
        className="neon mt-1.5"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--p" as string]: `${p}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => haptic("light")}
        onKeyUp={() => haptic("light")}
      />
    </div>
  );
}
