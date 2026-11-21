import crypto from "node:crypto";

export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}

/**
 * Валидация Telegram WebApp initData по алгоритму из документации:
 * secret = HMAC_SHA256("WebAppData", BOT_TOKEN); hash = HMAC_SHA256(secret, data_check_string)
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 60 * 60 * 24,
): { ok: true; user: TgUser } | { ok: false; error: string } {
  if (!initData) return { ok: false, error: "initData пуст" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "В initData нет hash" };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "Неверная подпись initData" };
  }

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) {
    return { ok: false, error: "initData устарел" };
  }

  try {
    const user = JSON.parse(params.get("user") ?? "null") as TgUser | null;
    if (!user?.id) return { ok: false, error: "В initData нет пользователя" };
    return { ok: true, user };
  } catch {
    return { ok: false, error: "Некорректный user в initData" };
  }
}

export async function sendToChat(opts: {
  token: string;
  chatId: number;
  format: "voice" | "audio";
  data: Buffer;
  caption: string;
  title: string;
}) {
  const form = new FormData();
  form.set("chat_id", String(opts.chatId));
  form.set("caption", opts.caption);

  let method: string;
  if (opts.format === "voice") {
    method = "sendVoice";
    form.set("voice", new Blob([new Uint8Array(opts.data)], { type: "audio/ogg" }), "voice.ogg");
  } else {
    method = "sendAudio";
    form.set("audio", new Blob([new Uint8Array(opts.data)], { type: "audio/mpeg" }), `${opts.title}.mp3`);
    form.set("title", opts.title);
    form.set("performer", "Аудио-пульт");
  }

  const res = await fetch(`https://api.telegram.org/bot${opts.token}/${method}`, {
    method: "POST",
    body: form,
  });
  const json = (await res.json().catch(() => null)) as { ok: boolean; description?: string } | null;
  if (!json?.ok) throw new Error(json?.description ?? `Telegram API ${res.status}`);
}
