"""
Аудио-пульт — серверная часть на Python (FastAPI + aiogram + Edge-TTS + FFmpeg).

Запуск:
    pip install -r requirements.txt
    export BOT_TOKEN=123:ABC
    export WEBAPP_URL=https://your-domain.example      # URL Mini App (для кнопки в /start)
    export ALLOWED_ORIGIN=https://your-domain.example  # CORS (необязательно, по умолчанию *)
    uvicorn bot:app --host 0.0.0.0 --port 8000

Требуется установленный ffmpeg с libopus и libmp3lame.

Эндпоинты:
    POST /api/send-voice  (multipart/form-data) — валидирует initData, синтезирует речь Edge-TTS
                          (или берёт загруженный файл `audio`), применяет 3-полосный EQ в FFmpeg
                          и отправляет sendVoice (OGG/Opus) либо sendAudio (MP3) в чат пользователя.
    POST /api/tts         (json) — mp3 для предпрослушивания (EQ в браузере).
    GET  /api/health
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Optional
from urllib.parse import parse_qsl

import edge_tts
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import (
    BufferedInputFile,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    WebAppInfo,
)
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("audio-pult")

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
WEBAPP_URL = os.environ.get("WEBAPP_URL", "")
FFMPEG = os.environ.get("FFMPEG_PATH", "ffmpeg")
MAX_TEXT = 3000
INIT_DATA_TTL = 60 * 60 * 24

# ───────────────────────── Маппинг параметров пульта ─────────────────────────

VOICES = {
    "neutral": "ru-RU-SvetlanaNeural",
    "deep": "en-US-BrianMultilingualNeural",
    "soft": "en-US-EmmaMultilingualNeural",
    "announcer": "en-US-BrianMultilingualNeural",  # + питч -12 Гц и бас +4 дБ
}
PRESET_LABEL = {
    "podcast": "Подкаст",
    "audiobook": "Аудиокнига",
    "radio": "Радио-диктор",
    "shorts": "Озвучка Shorts",
}
# Экспрессия: лёгкие сдвиги rate (%), pitch (Гц) и усиление НЧ/ВЧ (дБ)
EXPRESSION = [
    {"rate": -6, "pitch_hz": -3, "low_db": 0.0, "high_db": -1.5},  # Низкий
    {"rate": 0, "pitch_hz": 0, "low_db": 0.0, "high_db": 0.0},  # Средний
    {"rate": 4, "pitch_hz": 4, "low_db": 0.5, "high_db": 1.5},  # Высокий
    {"rate": 8, "pitch_hz": 8, "low_db": 1.0, "high_db": 3.0},  # Максимум
]


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def fmt_signed(n: int, unit: str) -> str:
    return f"{'+' if n >= 0 else '-'}{abs(n)}{unit}"


def speed_to_rate(speed: float) -> int:
    """1.00x → +0%, 1.25x → +25%, 0.80x → -20%"""
    return int(round(clamp((speed - 1.0) * 100, -50, 100)))


def pitch_pct_to_hz(pct: float) -> int:
    """0% → +0Hz, +10% → +15Hz, -10% → -15Hz"""
    return int(round(pct * 1.5))


class Settings(BaseModel):
    voice: str = "neutral"
    speed: float = 1.0
    pitch: float = 0.0
    expression: int = 1
    lowDb: float = 0.0
    midDb: float = 0.0
    highDb: float = 0.0
    preset: Optional[str] = None


def to_params(s: Settings) -> dict:
    voice = s.voice if s.voice in VOICES else "neutral"
    expr = EXPRESSION[int(clamp(s.expression, 0, 3))]
    announcer = voice == "announcer"
    deep = voice == "deep"

    rate = int(clamp(speed_to_rate(clamp(s.speed, 0.5, 2.0)) + expr["rate"], -50, 100))
    pitch_hz = int(
        clamp(
            pitch_pct_to_hz(clamp(s.pitch, -50, 50))
            + expr["pitch_hz"]
            + (-12 if announcer else -6 if deep else 0),
            -100,
            100,
        )
    )
    low = clamp(clamp(s.lowDb, -12, 12) + expr["low_db"] + (4 if announcer else 2 if deep else 0), -15, 15)
    mid = clamp(s.midDb, -12, 12)
    high = clamp(clamp(s.highDb, -12, 12) + expr["high_db"], -15, 15)
    return {
        "voice": VOICES[voice],
        "rate": fmt_signed(rate, "%"),
        "pitch": fmt_signed(pitch_hz, "Hz"),
        "low_db": round(low, 1),
        "mid_db": round(mid, 1),
        "high_db": round(high, 1),
    }


# ───────────────────────── Edge-TTS + FFmpeg ─────────────────────────


async def synthesize(text: str, p: dict) -> bytes:
    communicate = edge_tts.Communicate(text, p["voice"], rate=p["rate"], pitch=p["pitch"])
    chunks = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.extend(chunk["data"])
    if not chunks:
        raise RuntimeError("Edge-TTS вернул пустой ответ")
    return bytes(chunks)


async def ffmpeg_process(data: bytes, p: dict, fmt: str) -> bytes:
    eq = (
        f"equalizer=f=100:t=q:w=1:g={p['low_db']},"
        f"equalizer=f=1000:t=q:w=1:g={p['mid_db']},"
        f"equalizer=f=8000:t=q:w=1:g={p['high_db']}"
    )
    if fmt == "voice":
        # OGG Opus 48 кГц моно — Telegram показывает как нативное голосовое с волной
        codec = ["-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "48k", "-f", "ogg"]
    else:
        codec = ["-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3"]
    proc = await asyncio.create_subprocess_exec(
        FFMPEG, "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-af", eq, *codec, "pipe:1",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate(data)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg: {err.decode(errors='ignore')[-300:]}")
    return out


# ───────────────────────── Валидация initData ─────────────────────────


def validate_init_data(init_data: str) -> dict:
    """Проверка подписи Telegram WebApp initData. Возвращает объект user (с id = chat_id)."""
    if not init_data:
        raise HTTPException(401, "initData пуст")
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise HTTPException(401, "В initData нет hash")
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    calc = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calc, received_hash):
        raise HTTPException(401, "Неверная подпись initData")
    if time.time() - int(pairs.get("auth_date", "0")) > INIT_DATA_TTL:
        raise HTTPException(401, "initData устарел")
    try:
        user = json.loads(pairs.get("user", "null"))
    except json.JSONDecodeError:
        user = None
    if not user or "id" not in user:
        raise HTTPException(401, "В initData нет пользователя")
    return user


# ───────────────────────── aiogram + FastAPI ─────────────────────────

bot: Bot | None = Bot(BOT_TOKEN) if BOT_TOKEN else None
dp = Dispatcher()


@dp.message(CommandStart())
async def on_start(message: Message):
    kb = None
    if WEBAPP_URL:
        kb = InlineKeyboardMarkup(
            inline_keyboard=[[InlineKeyboardButton(text="🎛 Открыть Аудио-пульт", web_app=WebAppInfo(url=WEBAPP_URL))]]
        )
    await message.answer("Привет! Настрой голос в Аудио-пульте, и я пришлю озвучку прямо сюда.", reply_markup=kb)


@dp.message(F.text)
async def on_text(message: Message):
    await message.answer("Откройте Аудио-пульт командой /start 🎛")


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(dp.start_polling(bot)) if bot else None
    yield
    if task:
        task.cancel()
    if bot:
        await bot.session.close()


app = FastAPI(title="Audio Pult", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("ALLOWED_ORIGIN", "*")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"ok": True, "bot": bool(bot)}


class TtsRequest(BaseModel):
    text: str
    settings: Settings = Settings()


@app.post("/api/tts")
async def tts(req: TtsRequest):
    text = req.text.strip()[:MAX_TEXT]
    if not text:
        raise HTTPException(400, "Пустой текст")
    try:
        audio = await synthesize(text, to_params(req.settings))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, str(e)) from e
    return Response(audio, media_type="audio/mpeg")


@app.post("/api/send-voice")
async def send_voice(
    initData: str = Form(""),
    text: str = Form(""),
    settings: str = Form("{}"),
    format: str = Form("voice"),
    name: str = Form("Мой голос"),
    audio: Optional[UploadFile] = File(None),
):
    if not bot:
        raise HTTPException(503, "BOT_TOKEN не задан")
    user = validate_init_data(initData)  # chat_id берём ТОЛЬКО из проверенного initData
    text = text.strip()[:MAX_TEXT]
    if not text:
        raise HTTPException(400, "Пустой текст")
    fmt = "audio" if format == "audio" else "voice"
    try:
        st = Settings(**json.loads(settings))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, "Некорректные настройки голоса") from e
    p = to_params(st)
    name = (name.strip() or "Мой голос")[:60]

    try:
        raw = await audio.read() if audio and audio.filename else b""
        if not raw:
            raw = await synthesize(text, p)
        processed = await ffmpeg_process(raw, p, fmt)

        preset = f" · {PRESET_LABEL[st.preset]}" if st.preset in PRESET_LABEL else ""
        caption = f"🎛 Голос: {name}{preset}\n{st.speed:.2f}x · тон {st.pitch:+.0f}%"

        if fmt == "voice":
            await bot.send_voice(user["id"], BufferedInputFile(processed, "voice.ogg"), caption=caption)
        else:
            await bot.send_audio(
                user["id"], BufferedInputFile(processed, f"{name}.mp3"),
                caption=caption, title=name, performer="Аудио-пульт",
            )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        log.exception("send failed")
        raise HTTPException(502, str(e)) from e
    return {"ok": True}
