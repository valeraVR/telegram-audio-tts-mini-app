# Аудио-пульт — бэкенд

В проекте два взаимозаменяемых бэкенда с одинаковым контрактом `POST /api/send-voice`:

1. **Next.js (по умолчанию)** — `src/app/api/send-voice/route.ts` + `src/app/api/tts/route.ts`
   (Node.js, `edge-tts-universal`, `ffmpeg-static`). Нужен только `BOT_TOKEN` в окружении.
2. **Python FastAPI + aiogram** — `backend/bot.py` (Edge-TTS + FFmpeg). Чтобы использовать, задеплойте
   его на отдельный домен и проксируйте `/api/*` на него (или добавьте rewrites в `next.config.ts`).

## Переменные окружения
| Переменная | Назначение |
|---|---|
| `BOT_TOKEN` | токен бота от @BotFather (валидация initData и отправка аудио) |
| `WEBAPP_URL` | (bot.py) URL Mini App для кнопки в `/start` |
| `FFMPEG_PATH` | (необязательно) путь к ffmpeg |

## Запуск Python-версии
```bash
cd backend
pip install -r requirements.txt
BOT_TOKEN=123:ABC WEBAPP_URL=https://example.com uvicorn bot:app --port 8000
```

## Что делает сервер
1. Проверяет `initData` (HMAC-SHA256, ключ `WebAppData` + `BOT_TOKEN`), берёт `user.id` как `chat_id`.
2. Маппинг: Голос → Edge-TTS (`Нейтральный → ru-RU-SvetlanaNeural`, `Мужской глубокий → ru-RU-DmitryNeural`,
   `Женский мягкий → ru-RU-DariyaNeural`, `Дикторский → ru-RU-DmitryNeural`, питч −8 % и бас +4 дБ);
   скорость → `rate` (`1.25x → +25%`); тон → `pitch` в Гц (`+10% → +15Hz`); экспрессия → лёгкие сдвиги rate/pitch и EQ.
3. FFmpeg: `equalizer=f=100:t=q:w=1:g={low},equalizer=f=1000:t=q:w=1:g={mid},equalizer=f=8000:t=q:w=1:g={high}`
   → `voice`: OGG/Opus (libopus, 48 кГц, моно) → `sendVoice`; `audio`: MP3 → `sendAudio`.
