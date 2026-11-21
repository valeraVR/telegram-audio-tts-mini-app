"use client";

import { useRef } from "react";
import { clamp } from "@/lib/voice";

interface Props {
  low: number;
  mid: number;
  high: number;
  onChange: (band: "lowDb" | "midDb" | "highDb", v: number) => void;
}

const W = 600;
const H = 130;
const PAD = 18;
const MID_Y = H / 2;
const RANGE_PX = 46; // ±12 дБ
const FMIN = 20;
const FMAX = 20000;

const xOf = (f: number) => PAD + (Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * (W - PAD * 2);
const yOf = (db: number) => MID_Y - (db / 12) * RANGE_PX;

const BANDS = [
  { key: "lowDb" as const, f: 100 },
  { key: "midDb" as const, f: 1000 },
  { key: "highDb" as const, f: 8000 },
];

// Приближённая АЧХ peaking-фильтра (Q = 1)
const bell = (f: number, f0: number, g: number) => {
  const d = f / f0 - f0 / f;
  return g / (1 + d * d);
};

export default function EqGraph({ low, mid, high, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gains = { lowDb: low, midDb: mid, highDb: high };

  const pts: string[] = [];
  const N = 120;
  for (let i = 0; i <= N; i++) {
    const f = FMIN * Math.pow(FMAX / FMIN, i / N);
    const db = bell(f, 100, low) + bell(f, 1000, mid) + bell(f, 8000, high);
    pts.push(`${xOf(f).toFixed(1)},${yOf(clamp(db, -14, 14)).toFixed(1)}`);
  }
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${xOf(FMAX)},${H} L${xOf(FMIN)},${H} Z`;

  const drag = (key: (typeof BANDS)[number]["key"], e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    onChange(key, Math.round(clamp(((MID_Y - y) / RANGE_PX) * 12, -12, 12)));
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto select-none touch-none"
      role="img"
      aria-label="АЧХ эквалайзера"
    >
      <defs>
        <linearGradient id="eqLine" x1="0" x2="1">
          <stop offset="0" stopColor="#5ceaff" />
          <stop offset="1" stopColor="#3d9bff" />
        </linearGradient>
        <linearGradient id="eqFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#4fe3ff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#4fe3ff" stopOpacity="0" />
        </linearGradient>
        <filter id="glow" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {[-12, -6, 6, 12].map((g) => (
        <line key={g} x1={PAD} x2={W - PAD} y1={yOf(g)} y2={yOf(g)} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 6" />
      ))}
      {BANDS.map((b) => (
        <line key={b.f} x1={xOf(b.f)} x2={xOf(b.f)} y1={6} y2={H - 6} stroke="rgba(255,255,255,0.08)" />
      ))}
      <line x1={PAD} x2={W - PAD} y1={MID_Y} y2={MID_Y} stroke="rgba(255,255,255,0.18)" />

      <path d={area} fill="url(#eqFill)" />
      <path d={line} fill="none" stroke="url(#eqLine)" strokeWidth={4} strokeLinecap="round" filter="url(#glow)" />

      {BANDS.map((b) => (
        <g
          key={b.key}
          style={{ cursor: "ns-resize" }}
          onPointerDown={(e) => {
            (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
            drag(b.key, e);
          }}
          onPointerMove={(e) => {
            if (e.buttons) drag(b.key, e);
          }}
        >
          <circle cx={xOf(b.f)} cy={yOf(gains[b.key])} r={22} fill="transparent" />
          <circle cx={xOf(b.f)} cy={yOf(gains[b.key])} r={12} fill="rgba(79,227,255,0.25)" filter="url(#glow)" />
          <circle cx={xOf(b.f)} cy={yOf(gains[b.key])} r={7} fill="#7ff0ff" stroke="#fff" strokeWidth={1.5} filter="url(#glow)" />
        </g>
      ))}
    </svg>
  );
}
