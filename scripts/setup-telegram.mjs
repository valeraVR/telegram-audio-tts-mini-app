#!/usr/bin/env node
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const token = process.env.BOT_TOKEN?.trim();
const webappUrl = process.env.WEBAPP_URL?.trim().replace(/\/+$/, "");
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

if (!token) {
  console.error("BOT_TOKEN не задан. Добавьте его в .env.local или .env.");
  process.exit(1);
}
if (!webappUrl || !/^https:\/\//.test(webappUrl)) {
  console.error("WEBAPP_URL должен быть публичным HTTPS-адресом (например https://your-app.vercel.app).");
  process.exit(1);
}

const api = (method) => `https://api.telegram.org/bot${token}/${method}`;

async function call(method, body = {}) {
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!json?.ok) {
    throw new Error(`${method}: ${json?.description ?? `HTTP ${res.status}`}`);
  }
  return json.result;
}

try {
  const me = await call("getMe");
  console.log(`Бот: @${me.username} (${me.first_name ?? ""})`);

  await call("setChatMenuButton", {
    menu_button: { type: "web_app", text: "Аудио-пульт", web_app: { url: webappUrl } },
  });
  console.log("✓ Кнопка меню настроена");

  await call("setMyCommands", {
    commands: [
      { command: "start", description: "Открыть Аудио-пульт" },
      { command: "help", description: "Как пользоваться" },
    ],
  });
  console.log("✓ Команды бота заданы");

  await call("setWebhook", {
    url: `${webappUrl}/api/telegram/webhook`,
    ...(secret ? { secret_token: secret } : {}),
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  console.log(`✓ Webhook установлен: ${webappUrl}/api/telegram/webhook`);

  const info = await call("getWebhookInfo");
  console.log("\nWebhook info:");
  console.log(JSON.stringify(info, null, 2));
  console.log("\nГотово. Откройте бота в Telegram и отправьте /start.");
} catch (e) {
  console.error("Ошибка настройки Telegram:", e instanceof Error ? e.message : e);
  process.exit(1);
}