import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { ffmpegEqFilter, toEdgeParams, type VoiceSettings } from "@/lib/voice";
import { synthesizeEdge as synthesizeEdgeTts } from "@/lib/server/edge-tts";

function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string | null) || "ffmpeg";
}

/** Синтез речи через Edge-TTS (mp3, без эквалайзера) */
export function synthesizeEdge(text: string, settings: VoiceSettings): Promise<Buffer> {
  return synthesizeEdgeTts(text, settings);
}

function runFfmpeg(input: Buffer, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(/*turbopackIgnore: true*/ ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", ...args, "pipe:1"]);
    const out: Buffer[] = [];
    let err = "";
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.stderr.on("data", (d: Buffer) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg завершился с кодом ${code}: ${err.slice(-300)}`));
    });
    proc.stdin.on("error", () => {});
    proc.stdin.end(input);
  });
}

/** FFmpeg: параметрический EQ + конвертация. voice → OGG/Opus 48 кГц моно, audio → MP3 */
export function processAudio(
  input: Buffer,
  settings: VoiceSettings,
  format: "voice" | "audio",
): Promise<Buffer> {
  const eq = ffmpegEqFilter(toEdgeParams(settings));
  if (format === "voice") {
    return runFfmpeg(input, ["-af", eq, "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "48k", "-f", "ogg"]);
  }
  return runFfmpeg(input, ["-af", eq, "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3"]);
}
