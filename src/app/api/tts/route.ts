import { NextResponse } from "next/server";
import { synthesizeEdge } from "@/lib/server/audio";
import { MAX_TEXT, sanitizeSettings } from "@/lib/voice";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Синтез речи Edge-TTS (mp3 без EQ) для предпрослушивания. EQ применяется в браузере через Web Audio API. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { text?: string; settings?: unknown };
    const text = (body.text ?? "").trim().slice(0, MAX_TEXT);
    if (!text) return NextResponse.json({ error: "Пустой текст" }, { status: 400 });
    const settings = sanitizeSettings(body.settings as never);
    const mp3 = await synthesizeEdge(text, settings);
    return new Response(new Uint8Array(mp3), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "TTS error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
