/**
 * Клиент Edge-TTS (Microsoft Read Aloud) без внешних SDK.
 *
 * Python-библиотека edge-tts 7.x перешла на токен Sec-MS-GEC v2 и версию
 * `2-143.0.3650.75`; старые JS-пакеты (включая edge-tts-universal 1.4.0)
 * используют v1 и получают 403. Здесь актуальный протокол реализован напрямую.
 *
 * Источник алгоритма: edge_tts/drm.py, edge_tts/communicate.py (MIT).
 */
import crypto from "node:crypto";
import { WebSocket } from "ws";
import { toEdgeParams, type VoiceSettings } from "@/lib/voice";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
  `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const SEC_MS_GEC_VERSION = "2-143.0.3650.75";
const CHROMIUM_VERSION = "143.0.3650.75";
const USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0`;
const WIN_EPOCH = 11644473600;
const MAX_CHUNK_BYTES = 1600;
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_CONCURRENCY = 4;

let clockSkewSeconds = 0;

// ───────────────────────── Sec-MS-GEC v2 ─────────────────────────

const u32 = (x: number) => x >>> 0;
const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;
const rol16 = (x: number) => ((x << 16) | (x >>> 16)) >>> 0;
const sigma0 = (x: number) => (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
const sigma1 = (x: number) => (rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)) >>> 0;

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const SHA256_INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const SHA256_STATE = [0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2];
const SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0,
  0xf9e70ab6, 0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564,
];
const SHA256_ADJUSTMENT = 0xc9dc06a7;
const SHA256_BLOCK_K = K.slice();
SHA256_BLOCK_K[14] = SHA256_ADJUSTMENT;

function sha256Compress(state: number[], words: number[], firstRound = 0, constants = K): number[] {
  let [a, b, c, d, e, f, g, h] = state;
  for (let i = firstRound; i < 64; i++) {
    const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
    const ch = (g ^ (e & (f ^ g))) >>> 0;
    const t1 = (h + s1 + ch + constants[i] + words[i]) >>> 0;
    const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
    const maj = ((a & b) | (c & (a | b))) >>> 0;
    const t2 = (s0 + maj) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  return [a, b, c, d, e, f, g, h];
}

function sha256Init(first7: Buffer): number[] {
  const words = new Array<number>(14).fill(0);
  words.push(((first7[0] << 16) | (first7[1] << 8) | first7[2]) >>> 0);
  words.push(((first7[3] << 24) | (first7[4] << 16) | (first7[5] << 8) | first7[6]) >>> 0);
  for (let i = 16; i <= 29; i++) {
    let value = SHA256_SCHEDULE[i - 16];
    if (i - 2 >= 14) {
      value += i === 16 ? ((sigma1(words[i - 2]) ^ 0x000b92c0) >>> 0) : sigma1(words[i - 2]);
    }
    if (i - 7 >= 14) value += words[i - 7];
    if (i - 15 >= 14) {
      value += i === 29 ? ((sigma0(words[i - 15]) ^ 0x059c0b80) >>> 0) : sigma0(words[i - 15]);
    }
    words.push(value >>> 0);
  }
  words.push((sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + SHA256_ADJUSTMENT - K[14]) >>> 0);
  for (let i = 31; i < 64; i++) {
    words.push((sigma1(words[i - 2]) + words[i - 7] + sigma0(words[i - 15]) + words[i - 16]) >>> 0);
  }
  const working = sha256Compress(SHA256_STATE, words, 14, SHA256_BLOCK_K);
  return working.map((x, i) => (SHA256_INITIAL[i] + x) >>> 0);
}

/** Нестандартный SHA-256 из edge_tts/drm.py (кастомный IV для первых 7 байт). */
function tokenSha256(data: Buffer): Buffer {
  const length = 57 + data.length;
  const padLen = (((55 - length) % 64) + 64) % 64;
  const tail = Buffer.concat([
    data.subarray(7),
    Buffer.from([0x80]),
    Buffer.alloc(padLen),
    Buffer.alloc(8),
  ]);
  tail.writeBigUInt64BE(BigInt(length) * BigInt(8), tail.length - 8);

  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < tail.length; offset += 64) {
    const words: number[] = [];
    for (let i = 0; i < 16; i++) words.push(tail.readUInt32BE(offset + i * 4));
    for (let i = 16; i < 64; i++) {
      words.push((sigma1(words[i - 2]) + words[i - 7] + sigma0(words[i - 15]) + words[i - 16]) >>> 0);
    }
    const working = sha256Compress(state, words);
    state = state.map((x, i) => (x + working[i]) >>> 0);
  }

  const out = Buffer.alloc(32);
  state.forEach((x, i) => out.writeUInt32BE(x, i * 4));
  return out;
}

const CS64_COEFFICIENTS: [number, number][] = [
  [0xe82e91b1, 0xb32700d0], [0x44de24c6, 0x88dff51d], [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf], [0x8d1ec211, 0xd405b4d5], [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6], [0xf0a5b9d5, 0x82b2c1fb], [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464], [0xbed20560, 0x3c3c74f3], [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1], [0xcb49e3c6, 0xc5626167],
];

function wordsLe4Even(data: Buffer): number[] {
  const padded = Buffer.alloc(Math.ceil(data.length / 4) * 4);
  data.copy(padded);
  const words: number[] = [];
  for (let i = 0; i < padded.length; i += 4) words.push(padded.readUInt32LE(i));
  if (words.length % 2) words.push(0);
  return words;
}

function cs64Digest(data: Buffer, digest: Buffer): [number, number] {
  const keyA = (digest.readUInt32LE(0) | 1) >>> 0;
  const keyB = (digest.readUInt32LE(4) | 1) >>> 0;
  const factors = [Math.imul(keyA, 0x82893933) >>> 0, Math.imul(keyB, 0x82893933) >>> 0];
  const terms = CS64_COEFFICIENTS.map(([coef], i) => Math.imul(coef, factors[i % 2]) >>> 0);
  const offsets = CS64_COEFFICIENTS.map(([, off]) => off >>> 0);

  wordsLe4Even(Buffer.concat([Buffer.from([0]), data])).forEach((word, index) => {
    let term = Math.imul(word, index % 2 === 0 ? keyA : keyB) >>> 0;
    let offset = Math.imul(rol16(word), index % 2 === 0 ? 0xef0569fb : 0xc31713db) >>> 0;
    if (index === 0) {
      term = (term + Math.imul(0xf2f90b1a, factors[0])) >>> 0;
      offset = (offset + 0x0b1a0000) >>> 0;
    }
    terms.push(term);
    offsets.push(offset);
  });

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index];
    const y = terms[index + 1];
    let t = rol16((offsets[index] + x) >>> 0);
    let q = Math.imul(t, 0x76f50f34) >>> 0;
    swapAcc = (swapAcc + ((Math.imul(rol16(q), 0xc3efea97) + q) >>> 0)) >>> 0;
    t = rol16((offsets[index + 1] + y) >>> 0);
    q = Math.imul(t, 0x1881ce3c) >>> 0;
    swapLast = (Math.imul(rol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;

    state = (Math.imul(state, keyA) + x) >>> 0;
    state = Math.imul(rol16(state), 0xcf98b111) >>> 0;
    state = Math.imul(rol16(state), 0x87085b9f) >>> 0;
    state = Math.imul(rol16(state), 0x12ceb96d) >>> 0;
    state = Math.imul(rol16(state), 0x257e1d83) >>> 0;
    acc = (acc + state) >>> 0;
    t = (Math.imul(state, keyB) + y) >>> 0;
    t = Math.imul(rol16(t), 0xa27416f5) >>> 0;
    t = Math.imul(rol16(t), 0xd38396ff) >>> 0;
    state = Math.imul(rol16(Math.imul(rol16(t), 0x7c932b89) >>> 0), 0xbfa49f69) >>> 0;
    acc = (acc + state) >>> 0;
  }
  return [u32(swapLast ^ state), u32(swapAcc ^ acc)];
}

/** Актуальный Sec-MS-GEC v2: "<16 hex>-<64 hex>" */
function generateSecMsGec(unixTimestamp = Date.now() / 1000): string {
  let ticks = unixTimestamp + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 1e7;
  const data = Buffer.from(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`, "ascii");
  const digest = tokenSha256(data);
  const [a, b] = cs64Digest(data, digest);
  const le = (n: number) => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(n);
    return buf.toString("hex").toUpperCase();
  };
  return `${le(a)}${le(b)}-${digest.toString("hex").toUpperCase()}`;
}

// ───────────────────────── SSML и текст ─────────────────────────

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeText(text: string): string {
  // Edge не принимает управляющие символы (вертикальная табуляция и т.п.)
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
}

const SENTENCE_END = new Set([0x2e, 0x21, 0x3f, 0x0a, 0xa6]); // . ! ? \n …

/** Ищет конец предложения в пределах лимита (возвращает индекс после знака). */
function findSentenceSplit(buffer: Buffer, limit: number): number {
  for (let i = Math.min(limit, buffer.length - 1); i > 0; i--) {
    if (SENTENCE_END.has(buffer[i])) return i + 1;
  }
  return -1;
}

/** Разбивает уже экранированный текст на куски ≤ MAX_CHUNK_BYTES по предложениям/словам. */
function splitText(text: string): Buffer[] {
  const chunks: Buffer[] = [];
  let buffer = Buffer.from(text, "utf8");

  while (buffer.length > MAX_CHUNK_BYTES) {
    const sentence = findSentenceSplit(buffer, MAX_CHUNK_BYTES);
    let splitAt = sentence >= MAX_CHUNK_BYTES * 0.4 ? sentence : -1;

    if (splitAt < 0) splitAt = buffer.lastIndexOf(0x20, MAX_CHUNK_BYTES);
    if (splitAt < 0) {
      splitAt = MAX_CHUNK_BYTES;
      while (splitAt > 0) {
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, splitAt));
          break;
        } catch {
          splitAt--;
        }
      }
    }
    if (splitAt <= 0) splitAt = MAX_CHUNK_BYTES;

    // не разрезаем XML-сущность вида &amp;
    const amp = buffer.lastIndexOf(0x26, splitAt);
    if (amp >= 0 && buffer.indexOf(0x3b, amp) >= splitAt) splitAt = amp;
    if (splitAt <= 0) splitAt = MAX_CHUNK_BYTES;

    const chunk = buffer.subarray(0, splitAt).toString("utf8").trim();
    if (chunk) chunks.push(Buffer.from(chunk, "utf8"));
    buffer = buffer.subarray(splitAt);
  }

  const rest = buffer.toString("utf8").trim();
  if (rest) chunks.push(Buffer.from(rest, "utf8"));
  return chunks;
}

function edgeVoiceName(voice: string): string {
  if (voice.startsWith("Microsoft Server Speech")) return voice;
  const match = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(voice);
  if (!match) return voice;
  let region = `${match[1]}-${match[2]}`;
  let name = match[3];
  const dash = name.indexOf("-");
  if (dash !== -1) {
    region = `${region}-${name.slice(0, dash)}`;
    name = name.slice(dash + 1);
  }
  return `Microsoft Server Speech Text to Speech Voice (${region}, ${name})`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dateToString(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${DAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${p(date.getUTCDate())} ${date.getUTCFullYear()} ` +
    `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

function parseHeaders(text: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of text.split("\r\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) headers.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  return headers;
}

class ClockSkewError extends Error {}

// ───────────────────────── WebSocket ─────────────────────────

function synthesizeChunk(chunk: Buffer, voice: string, rate: string, pitch: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const connectionId = crypto.randomBytes(16).toString("hex").toUpperCase();
    const url =
      `${WSS_URL}&ConnectionId=${connectionId}` +
      `&Sec-MS-GEC=${generateSecMsGec(Date.now() / 1000 + clockSkewSeconds)}` +
      `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

    const ws = new WebSocket(url, {
      handshakeTimeout: 15_000,
      headers: {
        "User-Agent": USER_AGENT,
        Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
        Cookie: `muid=${crypto.randomBytes(16).toString("hex").toUpperCase()};`,
      },
    });

    const audio: Buffer[] = [];
    let settled = false;
    let turnEnded = false;

    const finish = (error?: Error, result?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      if (error) reject(error);
      else resolve(result ?? Buffer.alloc(0));
    };

    const timer = setTimeout(() => finish(new Error("Edge-TTS: таймаут соединения")), REQUEST_TIMEOUT_MS);

    ws.on("unexpected-response", (_req, res) => {
      res.resume();
      if (res.statusCode === 403) {
        const date = res.headers.date;
        if (date) {
          const serverTime = Date.parse(date);
          if (Number.isFinite(serverTime)) {
            clockSkewSeconds += serverTime / 1000 - Date.now() / 1000;
          }
        }
        finish(new ClockSkewError("Edge-TTS: 403, нужна коррекция часов"));
        return;
      }
      finish(new Error(`Edge-TTS: HTTP ${res.statusCode}`));
    });

    ws.on("open", () => {
      const timestamp = dateToString();
      ws.send(
        `X-Timestamp:${timestamp}\r\n` +
          "Content-Type:application/json; charset=utf-8\r\n" +
          "Path:speech.config\r\n\r\n" +
          '{"context":{"synthesis":{"audio":{"metadataoptions":' +
          '{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},' +
          '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n',
      );
      ws.send(
        `X-RequestId:${crypto.randomBytes(16).toString("hex")}\r\n` +
          "Content-Type:application/ssml+xml\r\n" +
          `X-Timestamp:${timestamp}Z\r\n` +
          "Path:ssml\r\n\r\n" +
          `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
          `<voice name='${voice}'>` +
          `<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>` +
          chunk.toString("utf8") +
          "</prosody></voice></speak>",
      );
    });

    ws.on("message", (data, isBinary) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (isBinary) {
        if (buf.length < 2) return;
        const headerLength = buf.readUInt16BE(0);
        if (headerLength + 2 > buf.length) return;
        const headers = parseHeaders(buf.subarray(2, 2 + headerLength).toString("utf8"));
        if (headers.get("Path") !== "audio") return;
        const contentType = headers.get("Content-Type");
        if (contentType && contentType !== "audio/mpeg") return;
        const payload = buf.subarray(2 + headerLength);
        if (payload.length) audio.push(payload);
        return;
      }

      const sep = buf.indexOf("\r\n\r\n");
      if (sep < 0) return;
      const headers = parseHeaders(buf.subarray(0, sep).toString("utf8"));
      if (headers.get("Path") === "turn.end") {
        turnEnded = true;
        if (audio.length === 0) {
          finish(new Error("Edge-TTS: сервис не вернул аудио"));
          return;
        }
        finish(undefined, Buffer.concat(audio));
      }
    });

    ws.on("error", (error) => {
      finish(new Error(`Edge-TTS: ${error.message}`));
    });

    ws.on("close", () => {
      if (settled) return;
      if (turnEnded && audio.length) {
        finish(undefined, Buffer.concat(audio));
      } else {
        finish(new Error("Edge-TTS: соединение закрыто до получения аудио"));
      }
    });
  });
}

/**
 * Синтез речи через Edge-TTS. Возвращает MP3 (24 кГц, 48 кбит/с, моно).
 * При 403 один раз корректирует смещение часов и повторяет запрос.
 */
export async function synthesizeEdge(text: string, settings: VoiceSettings): Promise<Buffer> {
  const p = toEdgeParams(settings);
  const voice = edgeVoiceName(p.voice);
  const chunks = splitText(escapeXml(normalizeText(text)));
  if (chunks.length === 0) throw new Error("Пустой текст");

  const parts = await mapLimit(chunks, MAX_CONCURRENCY, (chunk) =>
    synthesizeChunkWithRetry(chunk, voice, p.rate, p.pitch),
  );
  return Buffer.concat(parts);
}

async function synthesizeChunkWithRetry(
  chunk: Buffer,
  voice: string,
  rate: string,
  pitch: string,
): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await synthesizeChunk(chunk, voice, rate, pitch);
    } catch (error) {
      lastError = error;
      if (error instanceof ClockSkewError) continue;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Edge-TTS: неизвестная ошибка");
}

/** Параллельная обработка с ограничением количества одновременных запросов. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
