"use client";

import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

function fmt(n: number) {
  return "₩" + n.toLocaleString("ko-KR");
}

/* ── Mock data ── */
const USER = { nickname: "샘플유저", level: "일반 참가자", since: "2025.11" };

const STATS = [
  { label: "참여 횟수",  value: "12회",     sub: "총 참가" },
  { label: "낙찰 성공",  value: "3회",      sub: "우승" },
  { label: "총 절약",    value: "₩387,000", sub: "누적" },
  { label: "승률",       value: "25%",      sub: "성공률" },
];

const HISTORY = [
  {
    product: "NUVY 누비 유모차 자전거",
    date: "2025.12.01",
    retail: 250_000,
    price: 187_000,
    won: true,
  },
  {
    product: "배민 상품권 50,000원",
    date: "2025.11.28",
    retail: 50_000,
    price: null,
    won: false,
  },
  {
    product: "iPad Pro 11형",
    date: "2025.11.15",
    retail: 1_499_000,
    price: null,
    won: false,
  },
];

const ACHIEVEMENTS = [
  { emoji: "🏆", label: "첫 낙찰",    desc: "첫 번째 낙찰 성공",    unlocked: true  },
  { emoji: "⚡", label: "반응왕",      desc: "반응속도 0.2초 이내",  unlocked: true  },
  { emoji: "💪", label: "버티기 고수", desc: "20회 이상 참여",       unlocked: false },
  { emoji: "🎯", label: "연습왕",      desc: "모의훈련 5회 완료",    unlocked: false },
  { emoji: "👑", label: "레전드",      desc: "50만원 이상 절약",     unlocked: false },
  { emoji: "🔥", label: "연속 참가",   desc: "7일 연속 참가",        unlocked: false },
];

const MENU = [
  { label: "게임방법",     href: "/guide",     icon: "❓" },
  { label: "모의훈련",     href: "/practice",  icon: "🎯" },
  { label: "낙찰 훈련소",  href: "/mini-game", icon: "⚡" },
  { label: "지난결과보기", href: "/results",   icon: "🏆" },
];

/* ── Chevron icon ── */
function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/* ── Page ── */
export default function MyPage() {
  const initials = USER.nickname[0].toUpperCase();

  return (
    <main className="min-h-screen bg-[#fffbf5] flex flex-col items-center pb-28">
      <div className="w-full max-w-md">

        {/* ── Profile header ── */}
        <div
          className="w-full px-5 pt-14 pb-8 flex flex-col items-center text-center relative"
          style={{ background: "linear-gradient(180deg,#fff7ed 0%,#fffbf5 100%)" }}
        >
          <div className="absolute top-4 left-4">
            <HomeButton />
          </div>
          {/* Avatar */}
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-black text-white mb-4 shadow-lg"
            style={{
              background: "linear-gradient(135deg,#fb923c 0%,#f97316 100%)",
              boxShadow: "0 6px 24px rgba(249,115,22,0.35)",
            }}
          >
            {initials}
          </div>

          {/* Name + level */}
          <h1 className="text-xl font-black text-gray-900 mb-1">{USER.nickname}</h1>
          <span className="bg-orange-100 text-orange-600 text-xs font-bold px-3 py-1 rounded-full border border-orange-200 mb-2">
            {USER.level}
          </span>
          <p className="text-gray-400 text-xs">
            {USER.since}부터 함께하는 중 🙌
          </p>
        </div>

        <div className="px-4 space-y-4">

          {/* ── Stats grid ── */}
          <div className="grid grid-cols-2 gap-3">
            {STATS.map(({ label, value, sub }) => (
              <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4">
                <p className="text-gray-400 text-[10px] uppercase tracking-wider mb-1">{label}</p>
                <p className="text-orange-500 font-black text-xl font-mono tabular-nums leading-none">
                  {value}
                </p>
                <p className="text-gray-300 text-[10px] mt-0.5">{sub}</p>
              </div>
            ))}
          </div>

          {/* ── Participation history ── */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 pt-5 pb-3 border-b border-gray-50">
              <p className="text-gray-900 font-bold text-sm">참여 내역</p>
            </div>
            <div>
              {HISTORY.map((item, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 px-5 py-4 ${
                    i < HISTORY.length - 1 ? "border-b border-gray-50" : ""
                  }`}
                >
                  {/* Result indicator */}
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm flex-shrink-0 ${
                      item.won
                        ? "bg-green-100 text-green-600"
                        : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {item.won ? "🏆" : "😔"}
                  </div>

                  {/* Product info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-800 text-sm font-semibold truncate">{item.product}</p>
                    <p className="text-gray-400 text-xs mt-0.5">
                      {item.date} · {item.won ? `${fmt(item.price!)} 낙찰` : "미낙찰"}
                    </p>
                  </div>

                  {/* Badge */}
                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${
                      item.won
                        ? "bg-green-100 text-green-600"
                        : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {item.won ? "성공" : "실패"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Achievements ── */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-gray-900 font-bold text-sm">획득 배지</p>
              <span className="text-gray-400 text-xs">
                {ACHIEVEMENTS.filter((a) => a.unlocked).length}/{ACHIEVEMENTS.length}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {ACHIEVEMENTS.map(({ emoji, label, desc, unlocked }) => (
                <div
                  key={label}
                  className={`rounded-2xl p-3 flex flex-col items-center text-center ${
                    unlocked
                      ? "bg-orange-50 border border-orange-100"
                      : "bg-gray-50 border border-gray-100"
                  }`}
                >
                  <span
                    className="text-2xl mb-1.5 leading-none"
                    style={{ filter: unlocked ? "none" : "grayscale(1) opacity(0.3)" }}
                  >
                    {emoji}
                  </span>
                  <p
                    className={`text-[11px] font-bold leading-tight mb-0.5 ${
                      unlocked ? "text-gray-800" : "text-gray-300"
                    }`}
                  >
                    {label}
                  </p>
                  <p className={`text-[9px] leading-tight ${unlocked ? "text-gray-400" : "text-gray-200"}`}>
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Quick links ── */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 pt-5 pb-3 border-b border-gray-50">
              <p className="text-gray-900 font-bold text-sm">바로가기</p>
            </div>
            {MENU.map(({ label, href, icon }, i) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-5 py-4 hover:bg-gray-50 active:bg-gray-100 transition-colors ${
                  i < MENU.length - 1 ? "border-b border-gray-50" : ""
                }`}
              >
                <span className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center text-base flex-shrink-0">
                  {icon}
                </span>
                <span className="flex-1 text-gray-700 text-sm font-medium">{label}</span>
                <Chevron />
              </Link>
            ))}
          </div>

          {/* ── App info ── */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-900 font-bold text-sm">앱 정보</p>
            </div>
            <div className="space-y-2">
              {[
                ["버전",    "0.4.0 (MVP Demo)"],
                ["제작",    "Drop The Bid Team"],
                ["문의",    "hello@dtb.kr"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">{k}</span>
                  <span className="text-gray-600 text-sm font-medium">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── CTA ── */}
          <Link
            href="/"
            className="block w-full py-4 rounded-2xl text-white font-bold text-base text-center active:scale-[0.98] transition-transform shadow-md"
            style={{
              background: "linear-gradient(135deg,#fb923c,#f97316)",
              boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
            }}
          >
            오늘의 DTB 참여하기 →
          </Link>

          {/* ── Sign out placeholder ── */}
          <button className="w-full py-3 text-gray-400 text-sm font-medium active:opacity-70 transition-opacity">
            로그아웃
          </button>

        </div>
      </div>

      <BottomNav />
    </main>
  );
}
