"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

function fmt(n: number) { return "₩" + n.toLocaleString("ko-KR"); }

const TAG_COLOR: Record<string, { text: string; bg: string; border: string }> = {
  레전드: { text: "text-amber-400",  bg: "bg-amber-400/10",  border: "border-amber-400/30" },
  역대급: { text: "text-violet-400", bg: "bg-violet-400/10", border: "border-violet-400/30" },
  폭발:   { text: "text-red-400",    bg: "bg-red-400/10",    border: "border-red-400/30" },
  데일리: { text: "text-sky-400",    bg: "bg-sky-400/10",    border: "border-sky-400/30" },
};

const RESULTS = [
  {
    id: 3,
    name: "iPhone 17 Pro",
    retail: 1_790_000,
    winning: 499_000,
    discount: 72,
    winner: "폰바꿀때됐다",
    participants: 3_412,
    tag: "폭발",
    highlight: "이건 진짜 참여했어야 했다...",
  },
  {
    id: 2,
    name: "삼성 Neo QLED 65형 TV",
    retail: 2_390_000,
    winning: 699_000,
    discount: 71,
    winner: "거실왕",
    participants: 2_031,
    tag: "역대급",
    highlight: "단합력 무엇... TV가 70% 빠짐 ㄷㄷ",
  },
  {
    id: 1,
    name: "iPad Pro 11형",
    retail: 1_499_000,
    winning: 399_000,
    discount: 73,
    winner: "버티는민수",
    participants: 1_284,
    tag: "레전드",
    highlight: "와 이걸 40만원 밑으로 보냈다고?",
  },
  {
    id: 4,
    name: "배민 상품권 50,000원",
    retail: 50_000,
    winning: 18_900,
    discount: 62,
    winner: "점심은배민",
    participants: 684,
    tag: "데일리",
    highlight: "5만원권이 만원대까지 감 ㅋㅋ",
  },
];

export default function ResultsPage() {
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("card-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -48px 0px" }
    );

    cardRefs.current.forEach((el) => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center pb-28">
      <div className="w-full max-w-md px-4 pt-10">

        <div className="flex mb-5">
          <HomeButton />
        </div>

        <div className="mb-8">
          <p className="text-xs uppercase tracking-[0.14em] text-white/55 font-medium mb-1">Drop The Bid</p>
          <h1 className="text-[22px] font-black text-white leading-tight">지난 결과</h1>
          <p className="text-white/65 text-base mt-2">끝까지 버텨낸 레전드 드랍.</p>
        </div>

        <div className="flex flex-col gap-4">
          {RESULTS.map((r, i) => {
            const saved = r.retail - r.winning;
            const isFirst = i === 0;
            const tag = TAG_COLOR[r.tag];
            return (
              <div
                key={r.id}
                ref={(el) => { cardRefs.current[i] = el; }}
                className="card-rise bg-[#141414] border border-white/10 rounded-2xl p-5 overflow-hidden"
                style={{ transitionDelay: `${i * 70}ms` }}
              >
                {/* Top row: name + tag badge */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <p className="text-base font-bold text-white/85 leading-snug">{r.name}</p>
                  <span className={`text-xs font-black uppercase tracking-wider flex-shrink-0 px-2 py-0.5 rounded-full border ${tag.text} ${tag.bg} ${tag.border}`}>
                    {r.tag}
                  </span>
                </div>

                {/* Retail strikethrough */}
                <p className="text-xs text-white/35 line-through mb-1">{fmt(r.retail)}</p>

                {/* Price row */}
                <div className="flex items-end gap-3 mb-3">
                  <span
                    className="font-black font-mono tabular-nums leading-none"
                    style={{ fontSize: isFirst ? "3rem" : "2.4rem", color: "#c084fc" }}
                  >
                    {fmt(r.winning)}
                  </span>
                  <span className="mb-1 text-white/90 text-base font-black">-{r.discount}%</span>
                </div>

                {/* Divider */}
                <div className="border-t border-white/8 mb-3" />

                {/* Meta + quote */}
                <div className="flex items-center gap-2 text-sm text-white/55 mb-2">
                  <span className="text-green-400 font-semibold">{fmt(saved)} 절약</span>
                  <span>·</span>
                  <span>{r.winner}</span>
                  <span>·</span>
                  <span>{r.participants.toLocaleString()}명</span>
                </div>
                <p className="text-white/45 text-xs italic">"{r.highlight}"</p>
              </div>
            );
          })}
        </div>

        {/* FOMO */}
        <div
          ref={(el) => { cardRefs.current[RESULTS.length] = el; }}
          className="card-rise pt-8 pb-2 flex items-center justify-between gap-4"
          style={{ transitionDelay: `${RESULTS.length * 70}ms` }}
        >
          <p className="text-base text-white/65">
            오늘의 레전드는{" "}
            <span className="font-black" style={{ color: "#c084fc" }}>당신이 만들 수 있어요.</span>
          </p>
          <Link
            href="/"
            className="flex-shrink-0 px-4 py-2.5 text-white text-base font-bold rounded-xl transition-opacity active:opacity-80"
            style={{ background: "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)" }}
          >
            참여 →
          </Link>
        </div>

      </div>
      <BottomNav />
    </main>
  );
}
