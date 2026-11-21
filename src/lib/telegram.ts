export interface TgWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; username?: string } };
  ready: () => void;
  expand: () => void;
  close: () => void;
  showAlert?: (message: string, cb?: () => void) => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  HapticFeedback?: {
    impactOccurred: (s: "light" | "medium" | "heavy") => void;
    notificationOccurred: (s: "error" | "success" | "warning") => void;
  };
  CloudStorage?: {
    getItem: (key: string, cb: (err: string | null, value?: string) => void) => void;
    setItem: (key: string, value: string, cb?: (err: string | null, ok?: boolean) => void) => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export function getWebApp(): TgWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

export function haptic(kind: "light" | "medium" | "success" | "error" = "light") {
  const tg = getWebApp();
  const h = tg?.HapticFeedback;
  if (h) {
    try {
      if (kind === "success" || kind === "error") h.notificationOccurred(kind);
      else h.impactOccurred(kind);
      return;
    } catch {
      /* fall through to vibration fallback */
    }
  }
  // Fallback для браузеров/устройств без Telegram HapticFeedback
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(kind === "error" ? [20, 40, 20] : kind === "success" ? 15 : 8);
    } catch {
      /* ignore */
    }
  }
}
