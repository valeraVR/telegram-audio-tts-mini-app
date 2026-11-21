# Аудио-пульт · Telegram Mini App

Telegram Mini App для озвучки текста через Edge-TTS с настройкой голоса, трёхполосным эквалайзером (100 Гц / 1 кГц / 8 кГц) и отправкой аудио в чат ботом.

## Стек

- **Next.js 16** (App Router) + React 19 + TypeScript
- **Edge-TTS** (собственный WebSocket-клиент, актуальный токен v2)
- **FFmpeg** (`ffmpeg-static`) для EQ и конвертации в OGG/Opus (голосовое) или MP3 (аудио)
- Валидация Telegram `initData` по `BOT_TOKEN`, отправка только в чат авторизованного пользователя
- Деплой на Vercel

## Локальный запуск

### 1. Установка

```bash
npm install
```

### 2. Переменные окружения

Создайте `.env.local` (см. `.env.example`):

```env
BOT_TOKEN=123456:ABC-DEF...
WEBAPP_URL=https://<ваш-публичный-https-адрес>
TELEGRAM_WEBHOOK_SECRET=любая-строка-секрет
```

- `BOT_TOKEN` — токен от [@BotFather](https://t.me/BotFather).
- `WEBAPP_URL` — публичный HTTPS-адрес. Для локальной разработки используйте туннель (ngrok / cloudflared).
- `TELEGRAM_WEBHOOK_SECRET` — необязательно, но рекомендуется.

### 3. Запуск dev-сервера

```bash
npm run dev
```

Приложение: http://localhost:3000. Health-check: http://localhost:3000/api/health.

### 4. Настройка Telegram-бота

После того как `WEBAPP_URL` указывает на работающий HTTPS-эндпоинт:

```bash
npm run telegram:setup
```

Скрипт настроит кнопку меню, команды `/start` и `/help`, а также webhook на `WEBAPP_URL/api/telegram/webhook`.

## Проверка

```bash
npm run typecheck
npm run build
```

## Деплой на Vercel

1. Импортируйте репозиторий в [Vercel](https://vercel.com).
2. В настройках проекта задайте переменные окружения `BOT_TOKEN`, `WEBAPP_URL` (URL деплоя), `TELEGRAM_WEBHOOK_SECRET`.
3. После деплоя запустите локально с теми же переменными:
   ```bash
   npm run telegram:setup
   ```
   (скрипт использует `WEBAPP_URL` из `.env.local`.)

## Структура API

- `GET /api/health` — живость приложения и статус бота.
- `POST /api/tts` — синтез MP3 (без EQ) для предпрослушивания в браузере.
- `POST /api/send-voice` — multipart: `initData`, `text`, `settings`, `format` (`voice`/`audio`), `name`, опционально `audio`. Валидирует initData, синтезирует/конвертирует и отправляет в чат.
- `POST /api/telegram/webhook` — приём обновлений Telegram (`/start`, `/help`).

## Альтернативный бэкенд (Python)

В каталоге `backend/bot.py` — FastAPI + aiogram + edge-tts + ffmpeg. Запуск:

```bash
cd backend
pip install -r requirements.txt
BOT_TOKEN=... WEBAPP_URL=... uvicorn bot:app --host 0.0.0.0 --port 8000
```

Требуется установленный ffmpeg с libopus и libmp3lame.

## Примечания

- `edge-tts-universal` не используется: версия 1.4.0 получает 403 от Microsoft из-за устаревшего Sec-MS-GEC v1. Реализован собственный клиент с токеном v2.
- Голоса: `neutral` → `ru-RU-SvetlanaNeural`, `deep`/`announcer` → `en-US-BrianMultilingualNeural`, `soft` → `en-US-EmmaMultilingualNeural`.
- Длинный текст (до 3000 символов) разбивается на чанки ≤1600 байт и синтезируется параллельно.
- Проект не использует базу данных; `src/db` и `drizzle.config.json` остались от шаблона.