// TEMPORARY font comparison tool — not linked from nav, not applied anywhere
// else in the app. Safe to delete once the font decision is made.
//
// Replicates Home's hero (font-black / 2.1rem / letter-spacing -0.025em /
// leading-1.08) plus a body line and the real CTA button styling, once per
// candidate font. Only `fontFamily` changes between sections — every other
// class/style is copied verbatim from app/page.tsx so size/weight/spacing
// stay identical across all three.

const CANDIDATES: { label: string; fontFamily: string | undefined }[] = [
  { label: "1. System UI (Mac 원본 — 지금 Home 상태)", fontFamily: undefined },
  { label: "2. SUIT Variable", fontFamily: "'SUIT Variable Test'" },
  { label: "3. Wanted Sans Variable", fontFamily: "'Wanted Sans Variable Test'" },
];

function FontSample({ fontFamily }: { fontFamily?: string }) {
  return (
    <div style={{ fontFamily }}>
      {/* Hero — exact classes/style from app/page.tsx's headline */}
      <h1
        className="font-black leading-[1.08] mb-3"
        style={{ fontSize: "2.1rem", letterSpacing: "-0.025em" }}
      >
        <span className="text-white">과연 누가,</span>
        <br />
        <span className="gold-shimmer-text">가장 낮은 가격에</span>
        <br />
        <span className="text-white">가져갈까요?</span>
      </h1>

      <p
        className="text-sm font-medium flex items-center gap-1.5 mb-6"
        style={{ color: "rgba(255,255,255,0.70)" }}
      >
        <span className="text-orange-400 font-bold tabular-nums">128명</span>
        이 기다리고 있습니다.
      </p>

      {/* General body copy — regular weight, for reading comparison */}
      <p className="text-white/70 text-sm leading-relaxed mb-6">
        가격이 원하는 수준에 도달하면 손을 들어 낙찰받을 수 있어요.
        더 기다릴수록 싸지지만, 누군가 먼저 낙찰받을 수 있습니다.
      </p>

      {/* CTA button — exact classes/style from app/page.tsx's "경매 참여하기" button */}
      <button
        className="w-full font-black text-base text-white tracking-wide transition-all active:scale-[0.98] active:opacity-90 flex flex-col items-center py-4 gap-1 bid-btn-purple-plain rounded-[10px] relative overflow-hidden"
      >
        <span className="flex items-center gap-2">경매 참여하기</span>
        <span className="text-xs font-medium text-white/60 tracking-normal">
          경매에 참여하고 낙찰 기회를 잡으세요!
        </span>
      </button>
    </div>
  );
}

export default function FontComparePage() {
  return (
    <>
      <style>{`
        @font-face {
          font-family: 'SUIT Variable Test';
          font-weight: 100 900;
          font-display: swap;
          src: url('/fonts/SUIT-Variable.woff2') format('woff2-variations');
        }
        @font-face {
          font-family: 'Wanted Sans Variable Test';
          font-weight: 400 1000;
          font-display: swap;
          src: url('/fonts/WantedSansVariable.woff2') format('woff2-variations');
        }
      `}</style>

      <main className="min-h-screen bg-[#0a0a0a] flex flex-col items-center">
        <div className="w-full max-w-md px-4 py-8">
          <p className="text-white/40 text-xs mb-8 leading-relaxed">
            임시 폰트 비교 페이지 — DTB 어디에도 적용되지 않은 상태입니다.
            아래 3개 섹션은 font-family만 다르고 font-size / font-weight /
            letter-spacing / line-height / 레이아웃은 전부 동일합니다.
          </p>

          {CANDIDATES.map(({ label, fontFamily }, i) => (
            <div key={label} className={i > 0 ? "mt-10 pt-10 border-t border-white/15" : ""}>
              <p className="text-[#4ade80] text-xs font-bold uppercase tracking-wider mb-4">
                {label}
              </p>
              <FontSample fontFamily={fontFamily} />
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
