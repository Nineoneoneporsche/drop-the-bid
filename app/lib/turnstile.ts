// Cloudflare Turnstile loader — same on-demand, cache-the-promise shape as
// RightActionMenu.tsx's Kakao SDK loader. Only used on /join, and only
// when NEXT_PUBLIC_TURNSTILE_SITE_KEY is actually set (see that file for
// why a missing key must never break the page it's used on).
const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

let turnstileLoadPromise: Promise<boolean> | null = null;

export function loadTurnstile(): Promise<boolean> {
  if (turnstileLoadPromise) return turnstileLoadPromise;

  turnstileLoadPromise = new Promise((resolve) => {
    if (typeof window === "undefined") { resolve(false); return; }
    if (window.turnstile) { resolve(true); return; }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(!!window.turnstile), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.addEventListener("load", () => resolve(!!window.turnstile), { once: true });
    script.addEventListener("error", () => resolve(false), { once: true });
    document.head.appendChild(script);
  });

  return turnstileLoadPromise;
}
