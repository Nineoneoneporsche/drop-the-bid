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

/* ─── Payment method icons ─── */
function CardIcon() {
  return (
    <div className="w-9 h-9 rounded-xl bg-neutral-700 flex items-center justify-center flex-shrink-0">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e5e7eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2"/>
        <line x1="2" y1="10" x2="22" y2="10"/>
      </svg>
    </div>
  );
}
function KakaoIcon() {
  return (
    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#FEE500" }}>
      <span className="text-sm font-black" style={{ color: "#3A1D1D" }}>K</span>
    </div>
  );
}
function NaverIcon() {
  return (
    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#03C75A" }}>
      <span className="text-sm font-black text-white">N</span>
    </div>
  );
}
function TossIcon() {
  return (
    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#0064FF" }}>
      <span className="text-sm font-black text-white">T</span>
    </div>
  );
}

const PAYMENT_METHODS = [
  { label: "신용/체크카드", Icon: CardIcon },
  { label: "카카오페이",   Icon: KakaoIcon },
  { label: "네이버페이",   Icon: NaverIcon },
  { label: "토스페이",     Icon: TossIcon },
];

/* ─── Wallet bottom sheet ─── */
function WalletModal({ onClose, showToast }: { onClose: () => void; showToast: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-md rounded-t-3xl pb-10 pt-5 flex flex-col"
        style={{ background: "#1c1c1c", maxHeight: "70vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* drag handle */}
        <div className="w-10 h-1 rounded-full mx-auto mb-5 flex-shrink-0" style={{ background: "#3a3a3a" }} />

        {/* Header */}
        <div className="px-6 mb-6 flex-shrink-0 text-center">
          <h2 className="text-white text-lg font-bold mb-1">결제수단 추가</h2>
          <p className="text-neutral-400 text-sm">상품을 낙찰받기 전까지는 결제되지 않습니다.</p>
        </div>

        {/* Payment options */}
        <div className="flex-1 overflow-y-auto">
          {PAYMENT_METHODS.map(({ label, Icon }, idx) => (
            <button
              key={label}
              onClick={() => { showToast(); onClose(); }}
              className="w-full flex items-center gap-4 px-6 py-4 active:bg-neutral-800 transition-colors text-left"
            >
              <Icon />
              <span className="flex-1 text-white text-base font-medium">{label}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
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
      <div className="w-11 h-11 rounded-full bg-black/65 text-white border border-white/18 shadow-xl flex items-center justify-center backdrop-blur-sm">
        {icon}
      </div>
      <span className="text-white/50 text-[9px] mt-1 text-center leading-tight">
        {label}
      </span>
    </button>
  );
}

/* ─── Main export ─── */
export default function RightActionMenu({
  containerClassName = "absolute right-3 top-[95px] z-50 flex flex-col gap-3",
}: {
  containerClassName?: string;
}) {
  const [sheet, setSheet] = useState<"more" | "wallet" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const handleShare = useCallback(async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const text = "🔥 Drop The Bid 진행중! 지금 가격이 내려가고 있어요.";

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text, url });
        return;
      } catch {
        // user cancelled or API unavailable — fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // clipboard unavailable
    }

    showToast("링크가 복사되었습니다.");
  }, [showToast]);

  return (
    <>
      {/* Right-side vertical menu — position controlled by caller */}
      <div className={containerClassName}>
        <ActionBtn
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
              <line x1="12" y1="12" x2="12" y2="16"/>
              <line x1="10" y1="14" x2="14" y2="14"/>
            </svg>
          }
          label="지갑"
          onClick={() => setSheet("wallet")}
        />
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
      {sheet === "wallet" && (
        <WalletModal
          onClose={() => setSheet(null)}
          showToast={() => showToast("결제수단 연동은 추후 제공됩니다.")}
        />
      )}
      {toast && <Toast message={toast} />}
    </>
  );
}
