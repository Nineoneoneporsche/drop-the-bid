"use client";

import { useCallback, useState } from "react";

/* ─── Kakao JS SDK ───────────────────────────────────────────────────────
 * Loaded on demand (first time the share menu opens), not on every page
 * load — this component only lives on /strategy, but there's no reason to
 * pull the SDK for spectators who never open the share menu at all.
 *
 * Full SDK 2.8.3 (latest as of 2026-09-21) — src + integrity copied
 * verbatim from Kakao Developers' own copy-to-clipboard button at
 * https://developers.kakao.com/docs/latest/ko/javascript/download
 * (최신 버전 > Full SDK row). If this is ever bumped, copy both the src
 * and integrity from that same page — don't hand-edit the hash. */
const KAKAO_SDK_SRC = "https://t1.kakaocdn.net/kakao_js_sdk/2.8.3/kakao.min.js";
const KAKAO_SDK_INTEGRITY = "sha384-oroumrnFVE0xtgqyDZJARgERibXg2C28380uaUZz2kHDS5CR7tu20eGiOU6GkTpy";

declare global {
  interface Window {
    Kakao?: {
      init: (key: string) => void;
      isInitialized: () => boolean;
      Share: {
        sendDefault: (options: {
          objectType: "feed";
          content: {
            title: string;
            description: string;
            imageUrl: string;
            link: { mobileWebUrl: string; webUrl: string };
          };
          buttons: Array<{
            title: string;
            link: { mobileWebUrl: string; webUrl: string };
          }>;
        }) => void;
      };
    };
  }
}

// Module-scoped so concurrent/repeated opens of the share menu (or multiple
// mounts of this component) never trigger more than one script load.
let kakaoLoadPromise: Promise<boolean> | null = null;

function loadKakaoSdk(): Promise<boolean> {
  if (kakaoLoadPromise) return kakaoLoadPromise;

  kakaoLoadPromise = new Promise((resolve) => {
    if (typeof window === "undefined") { resolve(false); return; }

    const key = process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY;
    if (!key) { resolve(false); return; }

    const initAndResolve = () => {
      try {
        if (!window.Kakao) { resolve(false); return; }
        if (!window.Kakao.isInitialized()) window.Kakao.init(key);
        resolve(window.Kakao.isInitialized());
      } catch {
        // A malformed/rejected key throws from init() — never let a bad
        // Kakao config take the rest of the page down with it.
        resolve(false);
      }
    };

    if (window.Kakao) { initAndResolve(); return; }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${KAKAO_SDK_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", initAndResolve, { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = KAKAO_SDK_SRC;
    script.integrity = KAKAO_SDK_INTEGRITY;
    script.crossOrigin = "anonymous";
    script.async = true;
    script.addEventListener("load", initAndResolve, { once: true });
    script.addEventListener("error", () => resolve(false), { once: true });
    document.head.appendChild(script);
  });

  return kakaoLoadPromise;
}

/* ─── More sheet ─── */
const MORE_ITEMS = [
  { label: "게임 규칙" },
  { label: "FAQ" },
  { label: "신고하기" },
  { label: "이벤트 안내" },
];

function MoreSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-md bg-white rounded-t-3xl pb-10 pt-2 px-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* drag handle */}
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
        <div className="space-y-1">
          {MORE_ITEMS.map((item) => (
            <button
              key={item.label}
              onClick={onClose}
              className="w-full text-left px-4 py-4 text-gray-800 font-medium text-base rounded-2xl hover:bg-gray-50 active:bg-gray-100 transition-colors"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Share sheet: 카카오톡 | 링크 복사 | 더보기 ─── */
function ShareItemBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 active:scale-90 transition-transform"
    >
      <div className="w-14 h-14 rounded-full flex items-center justify-center">
        {icon}
      </div>
      <span className="text-gray-700 text-xs font-medium">{label}</span>
    </button>
  );
}

function ShareSheet({
  onClose,
  onKakao,
  onCopyLink,
  onMore,
}: {
  onClose: () => void;
  onKakao: () => void;
  onCopyLink: () => void;
  onMore: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-md bg-white rounded-t-3xl pb-10 pt-2 px-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
        <p className="text-center text-gray-400 text-xs font-semibold mb-5">공유하기</p>
        <div className="flex items-start justify-center gap-8">
          <ShareItemBtn
            icon={
              <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "#FEE500" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="#191919">
                  <path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.7 1.607 5.085 4.054 6.534L5.1 20.72a.375.375 0 0 0 .54.41l4.335-2.87C10.302 18.41 11.143 18.5 12 18.5c5.523 0 10-3.477 10-7.7S17.523 3 12 3z"/>
                </svg>
              </div>
            }
            label="카카오톡"
            onClick={onKakao}
          />
          <ShareItemBtn
            icon={
              <div className="w-14 h-14 rounded-full border border-gray-200 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
              </div>
            }
            label="링크 복사"
            onClick={onCopyLink}
          />
          <ShareItemBtn
            icon={
              <div className="w-14 h-14 rounded-full border border-gray-200 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="5" cy="12" r="1.6" fill="#374151" stroke="none"/>
                  <circle cx="12" cy="12" r="1.6" fill="#374151" stroke="none"/>
                  <circle cx="19" cy="12" r="1.6" fill="#374151" stroke="none"/>
                </svg>
              </div>
            }
            label="더보기"
            onClick={onMore}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── Toast ─── */
function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
      <div className="bg-gray-900/90 text-white text-sm font-medium px-5 py-2.5 rounded-full shadow-lg whitespace-nowrap">
        {message}
      </div>
    </div>
  );
}

/* ─── Action button ─── */
function ActionBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center active:scale-90 transition-transform"
    >
      <div className="w-11 h-11 rounded-full text-white border border-white/30 shadow-xl flex items-center justify-center backdrop-blur-sm">
        {icon}
      </div>
      <span className="text-white/50 text-xs mt-1 text-center leading-tight">
        {label}
      </span>
    </button>
  );
}

/* ─── Main export ─── */
export default function RightActionMenu({
  containerClassName = "absolute right-3 top-[95px] z-50 flex flex-col gap-3",
  productName,
}: {
  containerClassName?: string;
  /** Current auction item's name, used to build the share title. */
  productName?: string;
}) {
  const [sheet, setSheet] = useState<"more" | "share" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  // Never share the live game/strategy URL directly — an outside visitor
  // landing mid-round has no session/role there. Send them through /join
  // instead, which is the safe, generic entry point for new participants.
  // utm_source differs per channel purely for attribution.
  const shareUrl = useCallback(
    (utmSource: string) =>
      typeof window !== "undefined" ? `${window.location.origin}/join?utm_source=${utmSource}` : "",
    []
  );

  const handleOpenShareMenu = useCallback(() => {
    setSheet("share");
    // Kick the SDK load off now so it's likely ready by the time the user
    // actually taps 카카오톡 — sendDefault() below still awaits it either
    // way, this just hides the latency in the common case.
    void loadKakaoSdk();
  }, []);

  const handleKakaoShare = useCallback(async () => {
    setSheet(null);
    const ready = await loadKakaoSdk();
    if (!ready || !window.Kakao) {
      showToast("카카오톡 공유를 사용할 수 없습니다");
      return;
    }
    const url = shareUrl("kakao_share");
    try {
      window.Kakao.Share.sendDefault({
        objectType: "feed",
        content: {
          title: `${productName ? productName + " · " : ""}드랍더비드`,
          description: "가격은 계속 내려갑니다. 어디까지 기다리시겠어요?",
          imageUrl: `${window.location.origin}/kakao-share-image.jpg`,
          link: { mobileWebUrl: url, webUrl: url },
        },
        buttons: [
          { title: "경매 보러가기", link: { mobileWebUrl: url, webUrl: url } },
        ],
      });
    } catch {
      showToast("카카오톡 공유를 사용할 수 없습니다");
    }
  }, [productName, shareUrl, showToast]);

  const handleCopyLink = useCallback(async () => {
    setSheet(null);
    try {
      await navigator.clipboard.writeText(shareUrl("share"));
      showToast("링크를 복사했습니다");
    } catch {
      // clipboard unavailable — nothing more we can do here.
    }
  }, [shareUrl, showToast]);

  const handleMoreShare = useCallback(async () => {
    setSheet(null);
    const url = shareUrl("share");
    const title = `${productName ? productName + " · " : ""}드랍더비드`;
    const text = "🔥 지금 가격이 실시간으로 떨어지고 있어요. 낙찰의 짜릿함, DTB에서 확인해보세요!";

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        // User dismissed the system share sheet — not an error, do nothing.
        if (err instanceof Error && err.name === "AbortError") return;
        // Any other failure (unsupported, permission denied, etc.) — fall
        // through to the clipboard fallback below.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      showToast("링크를 복사했습니다");
    } catch {
      // clipboard unavailable — nothing more we can do here.
    }
  }, [productName, shareUrl, showToast]);

  return (
    <>
      {/* Right-side vertical menu — position controlled by caller */}
      <div className={containerClassName}>
        <ActionBtn
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
              <polyline points="16 6 12 2 8 6"/>
              <line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
          }
          label="공유"
          onClick={handleOpenShareMenu}
        />
        <ActionBtn
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="1.5" fill="white" stroke="none"/>
              <circle cx="12" cy="12" r="1.5" fill="white" stroke="none"/>
              <circle cx="12" cy="19" r="1.5" fill="white" stroke="none"/>
            </svg>
          }
          label="더보기"
          onClick={() => setSheet("more")}
        />
      </div>

      {/* Overlays */}
      {sheet === "more" && <MoreSheet onClose={() => setSheet(null)} />}
      {sheet === "share" && (
        <ShareSheet
          onClose={() => setSheet(null)}
          onKakao={handleKakaoShare}
          onCopyLink={handleCopyLink}
          onMore={handleMoreShare}
        />
      )}
      {toast && <Toast message={toast} />}
    </>
  );
}
