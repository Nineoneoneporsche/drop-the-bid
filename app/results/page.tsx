"use client";

import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

function fmt(n: number) {
  return "₩" + n.toLocaleString("ko-KR");
}

/* ── Tag badge styles ── */
const TAG: Record<string, { pill: string; dot: string }> = {
  레전드: { pill: "bg-amber-100 text-amber-700 border border-amber-200",  dot: "bg-amber-400" },
  역대급: { pill: "bg-violet-100 text-violet-700 border border-violet-200", dot: "bg-violet-400" },
  폭발:   { pill: "bg-red-100 text-red-600 border border-red-200",         dot: "bg-red-400" },
  데일리: { pill: "bg-sky-100 text-sky-600 border border-sky-200",         dot: "bg-sky-400" },
};

/* ── Mock results — ordered newest first ── */
const RESULTS = [
  {
    id: 3,
    name: "iPhone 17 Pro",
    retail: 1_790_000,
    winning: 499_000,
    discount: 72,
    winner: "폰바꿀때됐다",
    participants: 3_412,
    spectators: 12_830,
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
    spectators: 8_420,
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
    spectators: 4_912,
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
    spectators: 2_130,
    tag: "데일리",
    highlight: "5만원권이 만원대까지 감 ㅋㅋ",
  },
];

/* The featured hero — Samsung TV */
const HERO = RESULTS.find((r) => r.id === 2)!;

/* ── Result card ── */
function ResultCard({ r, featured = false }: { r: typeof RESULTS[0]; featured?: boolean }) {
  const saved = r.retail - r.winning;
  const t = TAG[r.tag] ?? TAG["데일리"];

  return (
    <div
      className={`bg-white rounded-3xl border shadow-sm overflow-hidden ${
        featured ? "border-violet-200 shadow-violet-100" : "border-gray-100"
      }`}
    >
      {/* Card header */}
      <div className={`px-5 pt-5 pb-4 ${featured ? "border-b border-violet-100" : "border-b border-gray-100"}`}>
        {/* Tag + name row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className={`font-bold text-gray-900 leading-snug ${featured ? "text-lg" : "text-base"}`}>
            {r.name}
          </h3>
          <span className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${t.pill}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
            {r.tag}
          </span>
        </div>

        {/* Price block */}
        <div className="flex items-end gap-3 mb-3">
          <div>
            <p className="text-gray-400 text-xs mb-0.5 line-through">{fmt(r.retail)}</p>
            <p
              className="font-black text-orange-500 font-mono tabular-nums"
              style={{ fontSize: featured ? "2.4rem" : "2rem", lineHeight: 1.1 }}
            >
              {fmt(r.winning)}
            </p>
          </div>
          <span className="mb-1 bg-orange-500 text-white text-sm font-black px-2.5 py-1 rounded-xl">
            -{r.discount}%
          </span>
        </div>

        {/* Savings callout */}
        <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2 flex items-center gap-2 mb-3">
          <span className="text-green-500 text-sm">💰</span>
          <p className="text-green-700 text-sm font-semibold">
            {fmt(saved)} 절약
          </p>
        </div>

        {/* Winner row */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-400 to-amber-400 flex items-center justify-center text-xs font-black text-white flex-shrink-0">
            {r.winner[0]}
          </div>
          <div>
            <p className="text-gray-900 text-sm font-bold">{r.winner}</p>
            <p className="text-gray-400 text-[10px]">낙찰자</p>
          </div>
          <div className="ml-auto flex gap-3 text-right">
            <div>
              <p className="text-gray-700 text-xs font-semibold">{r.participants.toLocaleString()}명</p>
              <p className="text-gray-400 text-[10px]">참가자</p>
            </div>
            <div>
              <p className="text-gray-700 text-xs font-semibold">{r.spectators.toLocaleString()}명</p>
              <p className="text-gray-400 text-[10px]">관전자</p>
            </div>
          </div>
        </div>
      </div>

      {/* Chat highlight */}
      <div className="px-5 py-3 bg-gray-50 flex items-start gap-2">
        <span className="text-gray-300 text-lg leading-none select-none">"</span>
        <p className="text-gray-500 text-sm italic flex-1">{r.highlight}</p>
      </div>
    </div>
  );
}

/* ── Page ── */
export default function ResultsPage() {
  const otherResults = RESULTS.filter((r) => r.id !== HERO.id);

  return (
    <main className="min-h-screen bg-[#fffbf5] flex flex-col items-center pb-28">
      <div className="w-full max-w-md px-4 pt-10">

        <div className="flex mb-4">
          <HomeButton />
        </div>

        {/* Page header */}
        <div className="mb-5">
          <h1 className="text-2xl font-black text-gray-900 mb-1">지난 결과</h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            사람들이 끝까지 버텨낸 레전드 드랍을 확인해보세요.
          </p>
        </div>

        {/* FOMO hook */}
        <div
          className="rounded-3xl p-5 mb-6 flex items-center justify-between gap-4"
          style={{ background: "linear-gradient(135deg,#fff7ed,#ffedd5)", border: "1px solid #fed7aa" }}
        >
          <div>
            <p className="text-orange-600 text-xs font-semibold uppercase tracking-wider mb-1">
              오늘의 레전드는 누가 만들까요?
            </p>
            <p className="text-gray-700 text-sm leading-snug">
              지금 참여하면<br />
              <span className="font-black text-orange-500">당신이 주인공</span>이 될 수 있어요.
            </p>
          </div>
          <Link
            href="/"
            className="flex-shrink-0 px-4 py-2.5 rounded-2xl text-white text-sm font-bold active:scale-[0.97] transition-transform shadow-md"
            style={{
              background: "linear-gradient(135deg,#fb923c,#f97316)",
              boxShadow: "0 4px 16px rgba(249,115,22,0.4)",
            }}
          >
            오늘의<br />DTB 보기
          </Link>
        </div>

        {/* ── Featured hero result ── */}
        <div className="mb-2">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">🏆</span>
            <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">역대 최고 절약</p>
          </div>
          <ResultCard r={HERO} featured />
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-gray-200" />
          <p className="text-gray-400 text-xs font-medium">전체 결과</p>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Other results */}
        <div className="space-y-4">
          {otherResults.map((r) => (
            <ResultCard key={r.id} r={r} />
          ))}
        </div>

        {/* Bottom FOMO nudge */}
        <div className="mt-6 text-center">
          <p className="text-gray-400 text-xs mb-3">
            다음 레전드 드랍을 놓치지 마세요
          </p>
          <Link
            href="/"
            className="inline-block px-8 py-3 rounded-2xl text-white text-sm font-bold active:scale-[0.98] transition-transform shadow-md"
            style={{
              background: "linear-gradient(135deg,#fb923c,#f97316)",
              boxShadow: "0 4px 16px rgba(249,115,22,0.35)",
            }}
          >
            지금 참여하기 →
          </Link>
        </div>

      </div>
      <BottomNav />
    </main>
  );
}
