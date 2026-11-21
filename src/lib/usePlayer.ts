"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Единый плеер на HTMLAudioElement: play(blob) / stop(), прогресс 0..1 */
export function usePlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const cleanup = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.onended = null;
      a.ontimeupdate = null;
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    audioRef.current = null;
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setPlaying(false);
    setProgress(0);
  }, [cleanup]);

  const play = useCallback(
    async (blob: Blob) => {
      cleanup();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const a = new Audio(url);
      audioRef.current = a;
      a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
      a.onended = () => {
        setPlaying(false);
        setProgress(0);
      };
      setPlaying(true);
      try {
        await a.play();
      } catch {
        setPlaying(false);
      }
    },
    [cleanup],
  );

  useEffect(() => cleanup, [cleanup]);

  return { playing, progress, play, stop };
}
