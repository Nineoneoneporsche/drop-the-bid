"use client";

import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

function fmt(n: number) { return "₩" + n.toLocaleString("ko-KR"); }

const USER = { nickname: "샘플유저", level: "일반 참가자", since: "2025.11" };

const STATS = [
  { label: "참여",  value: "12회"     },
  { label: "낙찰",  value: "3회"      },
  { label: "절약",  value: "₩387,000" },
  { label: "승률",  value: "25%"      },
];

const HISTORY = [
  { product: "Apple iPad Air 11형 Wi-Fi 128GB", date: "2025.12.01", price: 680_000, won: true  },
  { product: "배민 상품권 50,000원",    date: "2025.11.28", price: null,    won: false },
  { product: "iPad Pro 11형",           date: "2025.11.15", price: null,    won: false },
];

const ACHIEVEMENTS = [
  { emoji: "🏆", label: "첫 낙찰",    unlocked: true  },
  { emoji: "⚡", label: "반응왕",      unlocked: true  },
  { emoji: "💪", label: "버티기 고수", unlocked: false },
  { emoji: "🎯", label: "연습왕",      unlocked: false },
  { emoji: "👑", label: "레전드",      unlocked: false },
  { emoji: "🔥", label: "연속 참가",   unlocked: false },
];

const MENU = [
  { label: "게임방법",     href: "/guide"     },
  { label: "모의훈련",     href: "/practice"  },
  { label: "낙찰 훈련소",  href: "/mini-game" },
  { label: "지난결과보기", href: "/results"   },
];

export default function MyPage() {
  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center pb-28">
      <div className="w-full max-w-md px-4 pt-10">

        <div className="mb-5">
          <HomeButton />
        </div>

        {/* Page header */}
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.14em] text-white/55 font-medium mb-1">Drop The Bid</p>
          <h1 className="text-5xl font-black text-white leading-tight">My Page</h1>
        </div>

        {/* Profile */}
        <div className="flex items-center gap-4 mb-6">
          <div
            className="w-14 h-14 flex-shrink-0 flex items-center justify-center text-2xl font-black text-white"
            style={{ background: "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)" }}
          >
            {USER.nickname[0]}
          </div>
          <div>
            <p className="text-xl font-black text-white">{USER.nickname}</p>
            <p className="text-sm text-white/55 mt-0.5">{USER.level} · {USER.since}부터</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 mb-8">
          {STATS.map(({ label, value }, i) => (
            <div key={label} className={`text-center ${i > 0 ? "border-l border-white/15" : ""}`}>
              <p className="text-xs uppercase tracking-wider text-white/55 font-medium mb-0.5">{label}</p>
              <p className="font-black text-base font-mono tabular-nums" style={{ color: "#c084fc" }}>{value}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-white/15 mb-6" />

        {/* History */}
        <div className="mb-6">
          <p className="text-sm uppercase tracking-[0.12em] text-white/55 font-medium mb-3">참여 내역</p>
          {HISTORY.map((item, i) => (
            <div key={i} className={`flex items-center gap-3 py-3.5 ${i < HISTORY.length - 1 ? "border-b border-white/12" : ""}`}>
              <span className={`text-sm flex-shrink-0 ${item.won ? "" : "opacity-30"}`}>{item.won ? "🏆" : "😔"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-white/80 truncate">{item.product}</p>
                <p className="text-sm text-white/55 mt-0.5">{item.date}</p>
              </div>
              <div className="text-right flex-shrink-0">
                {item.won
                  ? <p className="text-sm font-black font-mono" style={{ color: "#c084fc" }}>{fmt(item.price!)}</p>
                  : <p className="text-xs text-white/45">미낙찰</p>
                }
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-white/15 mb-6" />

        {/* Achievements */}
        <div className="mb-6">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-sm uppercase tracking-[0.12em] text-white/55 font-medium">획득 배지</p>
            <span className="text-xs text-white/55">{ACHIEVEMENTS.filter(a => a.unlocked).length}/{ACHIEVEMENTS.length}</span>
          </div>
          <div className="flex gap-5">
            {ACHIEVEMENTS.map(({ emoji, label, unlocked }) => (
              <div key={label} className="flex flex-col items-center gap-1">
                <span
                  className="text-3xl leading-none"
                  style={{ filter: unlocked ? "none" : "grayscale(1) opacity(0.25)" }}
                >
                  {emoji}
                </span>
                <p className={`text-xs font-medium text-center ${unlocked ? "text-white/70" : "text-white/45"}`}>
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-white/15 mb-6" />

        {/* Quick links */}
        <div className="mb-6">
          <p className="text-sm uppercase tracking-[0.12em] text-white/55 font-medium mb-1">바로가기</p>
          {MENU.map(({ label, href }, i) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center justify-between py-3.5 text-base font-medium text-white/70 transition-colors ${
                i < MENU.length - 1 ? "border-b border-white/12" : ""
              }`}
              style={{}}
              onMouseEnter={e => (e.currentTarget.style.color = "#a855f7")}
              onMouseLeave={e => (e.currentTarget.style.color = "")}
            >
              {label}
              <span className="text-white/50 text-xs">→</span>
            </Link>
          ))}
        </div>

        {/* App info */}
        <div className="mb-8 space-y-1.5">
          {[["버전", "0.4.0 (MVP Demo)"], ["제작", "Drop The Bid Team"], ["문의", "hello@dtb.kr"]].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-[10px] uppercase tracking-wider text-white/50 font-medium">{k}</span>
              <span className="text-xs text-white/65">{v}</span>
            </div>
          ))}
        </div>

        <Link
          href="/"
          className="block w-full py-4 text-white font-bold text-base text-center transition-opacity active:opacity-80 mb-3 bid-btn-purple"
        >
          오늘의 DTB 참여하기 →
        </Link>
        <button className="w-full py-3 text-white/50 text-sm transition-opacity active:opacity-70">
          로그아웃
        </button>

      </div>
      <BottomNav />
    </main>
  );
}
