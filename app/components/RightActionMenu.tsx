"use client";

import { useState, useCallback } from "react";

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
  const [sheet, setSheet] = useState<"more" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const handleShare = useCallback(async () => {
    // Never share the live game/strategy URL directly — an outside visitor
    // landing mid-round has no session/role there. Send them through /join
    // instead, which is the safe, generic entry point for new participants.
    const url = typeof window !== "undefined"
      ? `${window.location.origin}/join?utm_source=share`
      : "";
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
  }, [productName, showToast]);

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
          onClick={handleShare}
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
      {toast && <Toast message={toast} />}
    </>
  );
}
