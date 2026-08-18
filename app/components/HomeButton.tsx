"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const HomeIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
    <polyline points="9 21 9 12 15 12 15 21"/>
  </svg>
);

export default function HomeButton() {
  const [showFAB, setShowFAB] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onScroll = () => setShowFAB(window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const fab = (
    <Link
      href="/"
      aria-label="메인화면"
      className={`fixed bottom-20 right-4 z-50 inline-flex items-center justify-center w-12 h-12 rounded-full border border-white/15 text-white/65 transition-all duration-300 active:scale-95 ${
        showFAB ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-3 pointer-events-none"
      }`}
      style={{ background: "rgba(15,15,15,0.85)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
    >
      <HomeIcon size={20} />
    </Link>
  );

  return (
    <>
      {/* 페이지 상단 인라인 버튼 */}
      <Link
        href="/"
        className="inline-flex items-center justify-center w-8 h-8 text-white/35 hover:text-white/75 transition-colors"
        aria-label="메인화면"
      >
        <HomeIcon size={20} />
      </Link>

      {/* FAB을 document.body에 포털로 렌더링 — transform 부모의 containing block 영향을 받지 않음 */}
      {mounted && createPortal(fab, document.body)}
    </>
  );
}
