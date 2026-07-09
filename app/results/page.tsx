"use client";

import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

function fmt(n: number) { return "₩" + n.toLocaleString("ko-KR"); }

const TAG_COLOR: Record<string, string> = {
  레전드: "text-amber-400",
  역대급: "text-violet-400",
  폭발:   "text-red-400",
  데일리: "text-sky-400",
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
  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center pb-28">
      <div className="w-full max-w-md px-4 pt-10">

        <div className="flex mb-5">
          <HomeButton />
        </div>

        <div className="mb-8">
          <p className="text-[10px] uppercase tracking-[0.14em] text-white/55 font-medium mb-1">Drop The Bid</p>
          <h1 className="text-3xl font-black text-white">지난 결과</h1>
          <p className="text-white/65 text-sm mt-1.5">끝까지 버텨낸 레전드 드랍.</p>
        </div>

        <div>
          {RESULTS.map((r, i) => {
            const saved = r.retail - r.winning;
            const isFirst = i === 0;
            return (
              <div key={r.id} className={`py-6 ${i < RESULTS.length - 1 ? "border-b border-white/15" : ""}`}>
                {/* Name + tag */}
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <p className="text-sm font-bold text-white/80 leading-snug">{r.name}</p>
                  <span className={`text-[10px] font-black uppercase tracking-wider flex-shrink-0 ${TAG_COLOR[r.tag]}`}>
                    {r.tag}
                  </span>
                </div>

                {/* Retail strikethrough */}
                <p className="text-[11px] text-white/40 line-through mb-0.5">{fmt(r.retail)}</p>

                {/* Price — hero of each row */}
                <div className="flex items-end gap-3 mb-2">
                  <span
                    className="font-black text-orange-500 font-mono tabular-nums leading-none"
                    style={{ fontSize: isFirst ? "3rem" : "2.4rem" }}
                  >
                    {fmt(r.winning)}
                  </span>
                  <span className="mb-0.5 text-white text-sm font-black">-{r.discount}%</span>
                </div>

                {/* Meta line */}
                <div className="flex items-center gap-2 text-xs text-white/60">
                  <span className="text-green-400 font-semibold">{fmt(saved)} 절약</span>
                  <span>·</span>
                  <span>{r.winner}</span>
                  <span>·</span>
                  <span>{r.participants.toLocaleString()}명</span>
                </div>

                {/* Quote */}
                <p className="text-white/55 text-[11px] italic mt-2">"{r.highlight}"</p>
              </div>
            );
          })}
        </div>

        {/* FOMO */}
        <div className="pt-8 pb-2 flex items-center justify-between gap-4">
          <p className="text-sm text-white/65">
            오늘의 레전드는 <span className="font-black text-orange-500">당신이 만들 수 있어요.</span>
          </p>
          <Link
            href="/"
            className="flex-shrink-0 px-4 py-2.5 text-white text-sm font-bold transition-opacity active:opacity-80"
            style={{ background: "#f97316" }}
          >
            참여 →
          </Link>
        </div>

      </div>
      <BottomNav />
    </main>
  );
}
