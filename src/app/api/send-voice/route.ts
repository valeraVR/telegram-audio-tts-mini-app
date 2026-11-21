import { NextResponse } from "next/server";
import { processAudio, synthesizeEdge } from "@/lib/server/audio";
import { sendToChat, validateInitData } from "@/lib/server/telegram";
import { MAX_TEXT, PRESET_LABEL, sanitizeSettings, type SendFormat } from "@/lib/voice";

export const runtime = "nodejs";
export const maxDuration = 120;

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

/**
 * POST multipart/form-data:
 *  - initData  — Telegram.WebApp.initData (валидируется по BOT_TOKEN)
 *  - text      — текст озвучки
 *  - settings  — JSON настроек пульта
 *  - format    — "voice" | "audio"
 *  - name      — название голоса (для подписи)
 *  - audio     — (необязательно) уже синтезированный Blob без EQ; если нет — синтез на сервере через Edge-TTS
 */
export async function POST(req: Request) {
  const token = process.env.BOT_TOKEN;
  if (!token) return fail("На сервере не задан BOT_TOKEN", 503);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Некорректный запрос", 400);
  }

  const auth = validateInitData(String(form.get("initData") ?? ""), token);
  if (!auth.ok) return fail(auth.error, 401);

  const text = String(form.get("text") ?? "").trim().slice(0, MAX_TEXT);
  if (!text) return fail("Пустой текст", 400);

  const format: SendFormat = form.get("format") === "audio" ? "audio" : "voice";
  let settings;
  try {
    settings = sanitizeSettings(JSON.parse(String(form.get("settings") ?? "{}")));
  } catch {
    return fail("Некорректные настройки голоса", 400);
  }
  const name = String(form.get("name") ?? "").trim().slice(0, 60) || "Мой голос";

  try {
    const file = form.get("audio");
    const raw =
      file instanceof Blob && file.size > 0
        ? Buffer.from(await file.arrayBuffer())
        : await synthesizeEdge(text, settings);

    const converted = await processAudio(raw, settings, format);

    const preset = settings.preset ? ` · ${PRESET_LABEL[settings.preset]}` : "";
    const caption = `🎛 Голос: ${name}${preset}\n${settings.speed.toFixed(2)}x · тон ${settings.pitch}%`;
    await sendToChat({
      token,
      chatId: auth.user.id,
      format,
      data: converted,
      caption,
      title: name,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Ошибка отправки", 502);
  }
}
