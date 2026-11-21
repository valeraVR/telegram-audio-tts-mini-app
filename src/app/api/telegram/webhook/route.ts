import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TgUser {
  id?: number;
  first_name?: string;
}

interface TgMessage {
  chat?: { id?: number };
  text?: string;
  from?: TgUser;
}

interface TgUpdate {
  message?: TgMessage;
}

const ok = () => NextResponse.json({ ok: true });

export async function POST(req: Request) {
  const token = process.env.BOT_TOKEN;
  if (!token) return ok();

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return ok();
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  const text = (message?.text ?? "").trim();
  if (!chatId || !text.startsWith("/")) return ok();

  const command = text.split(/\s+/)[0]?.split("@")[0] ?? "";

  const webappUrl = process.env.WEBAPP_URL?.trim().replace(/\/+$/, "");
  const firstName = message?.from?.first_name;

  let reply: Record<string, unknown>;
  if (command === "/start") {
    reply = webappUrl
      ? {
          chat_id: chatId,
          text:
            `Привет${firstName ? `, ${firstName}` : ""}! 🎛 Это «Аудио-пульт» — озвучка текста с тонкой настройкой голоса и эквалайзером.\n\n` +
            "Открой мини-приложение и отправь первую озвучку — бот пришлёт аудио прямо в этот чат.",
          reply_markup: {
            inline_keyboard: [[{ text: "🎧 Открыть Аудио-пульт", web_app: { url: webappUrl } }]],
          },
        }
      : {
          chat_id: chatId,
          text: "Бот запущен, но WEBAPP_URL не настроен на сервере. Добавьте публичный HTTPS-адрес в переменные окружения.",
        };
  } else if (command === "/help") {
    reply = {
      chat_id: chatId,
      text:
        "Аудио-пульт — Telegram Mini App.\n\n" +
        "1) Открой мини-приложение через кнопку меню или /start.\n" +
        "2) Введи текст, выбери голос и настрой эквалайзер.\n" +
        "3) Нажми «Отправить в чат» — бот пришлёт озвучку сюда.\n\n" +
        "Форматы: голосовое (OGG/Opus) или аудио (MP3).",
      ...(webappUrl
        ? { reply_markup: { inline_keyboard: [[{ text: "🎧 Открыть Аудио-пульт", web_app: { url: webappUrl } }]] } }
        : {}),
    };
  } else {
    return ok();
  }

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reply),
    });
  } catch {
    // Telegram повторит webhook, если вернём ошибку — лучше проглотить
  }
  return ok();
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "Telegram webhook endpoint" });
}