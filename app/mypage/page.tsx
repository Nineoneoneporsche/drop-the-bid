"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

function fmt(n: number) { return "₩" + n.toLocaleString("ko-KR"); }

interface StoredUser {
  nickname: string;
  email: string;
  password: string;
  phone: string;
  since: string;
}

const STATS = [
  { label: "참여",  value: "12회"     },
  { label: "낙찰",  value: "3회"      },
  { label: "절약",  value: "₩387,000" },
  { label: "승률",  value: "25%"      },
];

const HISTORY = [
  { product: "Apple iPad Air 11형 Wi-Fi 128GB", date: "2025.12.01", price: 680_000, won: true  },
  { product: "배민 상품권 50,000원",             date: "2025.11.28", price: null,    won: false },
  { product: "iPad Pro 11형",                    date: "2025.11.15", price: null,    won: false },
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

/* ── Logged-out view ──────────────────────────────────────────────── */
function LoggedOut() {
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loginErr, setLoginErr] = useState("");

  function handleLogin() {
    setLoginErr("");
    try {
      const raw = localStorage.getItem("dtb_user");
      if (!raw) { setLoginErr("가입된 계정을 찾을 수 없어요."); return; }
      const stored: StoredUser = JSON.parse(raw);
      if (stored.email !== email || stored.password !== pw) {
        setLoginErr("이메일 또는 비밀번호가 올바르지 않아요.");
        return;
      }
      // Force a page reload so MyPage re-reads localStorage
      window.location.reload();
    } catch {
      setLoginErr("로그인 중 오류가 발생했어요.");
    }
  }

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center pb-28">
      <div className="w-full max-w-md px-4 pt-10">

        <div className="mb-5"><HomeButton /></div>

        <div className="mb-8">
          <p className="text-xs uppercase tracking-[0.14em] text-white/55 font-medium mb-1">Drop The Bid</p>
          <h1 className="text-5xl font-black text-white leading-tight">My Page</h1>
        </div>

        {/* Guest card */}
        <div className="bg-[#141414] border border-white/10 rounded-2xl p-6 text-center mb-4">
          <div className="w-16 h-16 rounded-full bg-white/8 flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4"/>
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
            </svg>
          </div>
          <h2 className="text-xl font-black text-white mb-1.5">로그인이 필요해요</h2>
          <p className="text-white/50 text-sm mb-6 leading-relaxed">낙찰 내역, 배지, 절약 금액을<br/>확인하려면 로그인하세요.</p>

          <Link href="/signup" className="block w-full py-4 text-white font-bold text-base text-center bid-btn-purple rounded-xl mb-3">
            회원가입
          </Link>

          {!showLogin ? (
            <button
              onClick={() => setShowLogin(true)}
              className="w-full py-3 text-white/50 text-sm border border-white/12 rounded-xl transition-colors hover:border-white/25"
            >
              이미 계정이 있나요? 로그인
            </button>
          ) : (
            <div className="step-enter text-left mt-1">
              <div className="border-t border-white/10 pt-4 space-y-3">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-white/50 font-medium mb-1.5">이메일</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setLoginErr(""); }}
                    placeholder="가입한 이메일"
                    className="w-full bg-white/5 border border-white/12 focus:border-[#a855f7]/60 px-3.5 py-3 text-white placeholder-white/20 text-sm focus:outline-none rounded-xl transition-colors"
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-white/50 font-medium mb-1.5">비밀번호</label>
                  <input
                    type="password"
                    value={pw}
                    onChange={e => { setPw(e.target.value); setLoginErr(""); }}
                    onKeyDown={e => e.key === "Enter" && handleLogin()}
                    placeholder="비밀번호"
                    className="w-full bg-white/5 border border-white/12 focus:border-[#a855f7]/60 px-3.5 py-3 text-white placeholder-white/20 text-sm focus:outline-none rounded-xl transition-colors"
                    autoComplete="current-password"
                  />
                </div>
                {loginErr && <p className="text-red-400 text-xs">{loginErr}</p>}
                <button
                  onClick={handleLogin}
                  className="w-full py-3 text-white font-bold text-sm rounded-xl transition-opacity active:opacity-80"
                  style={{ background: "linear-gradient(180deg, #bf7af0 0%, #a855f7 55%, #8b3fd9 100%)" }}
                >
                  로그인
                </button>
                <button onClick={() => setShowLogin(false)} className="w-full text-white/35 text-xs py-1">취소</button>
              </div>
            </div>
          )}
        </div>

        {/* App info */}
        <div className="mt-8 space-y-1.5">
          {[["버전", "0.4.0 (MVP Demo)"], ["제작", "Drop The Bid Team"], ["문의", "hello@dtb.kr"]].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-[10px] uppercase tracking-wider text-white/50 font-medium">{k}</span>
              <span className="text-xs text-white/65">{v}</span>
            </div>
          ))}
        </div>

      </div>
      <BottomNav />
    </main>
  );
}

/* ── Logged-in view ───────────────────────────────────────────────── */
export default function MyPage() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("dtb_user");
      if (raw) setUser(JSON.parse(raw));
    } catch { }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded || !user) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { e.target.classList.add("card-visible"); observer.unobserve(e.target); }
        });
      },
      { threshold: 0.06, rootMargin: "0px 0px -32px 0px" }
    );
    cardRefs.current.forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [loaded, user]);

  function handleLogout() {
    localStorage.removeItem("dtb_user");
    setUser(null);
  }

  const setRef = (i: number) => (el: HTMLElement | null) => { cardRefs.current[i] = el; };

  if (!loaded) return null;
  if (!user) return <LoggedOut />;

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center pb-28">
      <div className="w-full max-w-md px-4 pt-10">

        <div ref={setRef(0)} className="card-rise mb-5">
          <HomeButton />
        </div>

        <div ref={setRef(1)} className="card-rise mb-6" style={{ transitionDelay: "50ms" }}>
          <p className="text-xs uppercase tracking-[0.14em] text-white/55 font-medium mb-1">Drop The Bid</p>
          <h1 className="text-5xl font-black text-white leading-tight">My Page</h1>
        </div>

        {/* Profile */}
        <div ref={setRef(2)} className="card-rise flex items-center gap-4 mb-6" style={{ transitionDelay: "100ms" }}>
          <div
            className="w-14 h-14 rounded-xl flex-shrink-0 flex items-center justify-center text-2xl font-black text-white"
            style={{ background: "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)" }}
          >
            {user.nickname[0]}
          </div>
          <div>
            <p className="text-xl font-black text-white">{user.nickname}</p>
            <p className="text-sm text-white/55 mt-0.5">일반 참가자 · {user.since}부터</p>
            <p className="text-xs text-white/35 mt-0.5">{user.email}</p>
          </div>
        </div>

        {/* Stats */}
        <div ref={setRef(3)} className="card-rise bg-[#141414] border border-white/10 rounded-2xl grid grid-cols-4 mb-5 overflow-hidden" style={{ transitionDelay: "150ms" }}>
          {STATS.map(({ label, value }, i) => (
            <div key={label} className={`text-center py-4 ${i > 0 ? "border-l border-white/10" : ""}`}>
              <p className="text-xs uppercase tracking-wider text-white/50 font-medium mb-0.5">{label}</p>
              <p className="font-black text-base font-mono tabular-nums" style={{ color: "#c084fc" }}>{value}</p>
            </div>
          ))}
        </div>

        {/* History */}
        <div ref={setRef(4)} className="card-rise bg-[#141414] border border-white/10 rounded-2xl mb-5 overflow-hidden" style={{ transitionDelay: "200ms" }}>
          <div className="px-5 pt-4 pb-1">
            <p className="text-sm uppercase tracking-[0.12em] text-white/55 font-medium">참여 내역</p>
          </div>
          {HISTORY.map((item, i) => (
            <div key={i} className={`flex items-center gap-3 px-5 py-3.5 ${i < HISTORY.length - 1 ? "border-b border-white/8" : ""}`}>
              <span className={`text-sm flex-shrink-0 ${item.won ? "" : "opacity-30"}`}>{item.won ? "🏆" : "😔"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-white/80 truncate">{item.product}</p>
                <p className="text-sm text-white/50 mt-0.5">{item.date}</p>
              </div>
              <div className="text-right flex-shrink-0">
                {item.won
                  ? <p className="text-sm font-black font-mono" style={{ color: "#c084fc" }}>{fmt(item.price!)}</p>
                  : <p className="text-xs text-white/40">미낙찰</p>}
              </div>
            </div>
          ))}
        </div>

        {/* Achievements */}
        <div ref={setRef(5)} className="card-rise bg-[#141414] border border-white/10 rounded-2xl mb-5 px-5 py-4" style={{ transitionDelay: "240ms" }}>
          <div className="flex items-baseline justify-between mb-4">
            <p className="text-sm uppercase tracking-[0.12em] text-white/55 font-medium">획득 배지</p>
            <span className="text-xs text-white/50">{ACHIEVEMENTS.filter(a => a.unlocked).length}/{ACHIEVEMENTS.length}</span>
          </div>
          <div className="flex gap-5">
            {ACHIEVEMENTS.map(({ emoji, label, unlocked }) => (
              <div key={label} className="flex flex-col items-center gap-1">
                <span className="text-3xl leading-none" style={{ filter: unlocked ? "none" : "grayscale(1) opacity(0.25)" }}>
                  {emoji}
                </span>
                <p className={`text-xs font-medium text-center ${unlocked ? "text-white/70" : "text-white/40"}`}>{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Quick links */}
        <div ref={setRef(6)} className="card-rise bg-[#141414] border border-white/10 rounded-2xl mb-5 overflow-hidden" style={{ transitionDelay: "280ms" }}>
          <div className="px-5 pt-4 pb-1">
            <p className="text-sm uppercase tracking-[0.12em] text-white/55 font-medium">바로가기</p>
          </div>
          {MENU.map(({ label, href }, i) => (
            <Link
              key={href} href={href}
              className={`flex items-center justify-between px-5 py-3.5 text-base font-medium text-white/65 transition-colors hover:text-[#a855f7] ${i < MENU.length - 1 ? "border-b border-white/8" : ""}`}
            >
              {label}
              <span className="text-white/40 text-xs">→</span>
            </Link>
          ))}
        </div>

        {/* App info */}
        <div ref={setRef(7)} className="card-rise mb-6 space-y-1.5" style={{ transitionDelay: "320ms" }}>
          {[["버전", "0.4.0 (MVP Demo)"], ["제작", "Drop The Bid Team"], ["문의", "hello@dtb.kr"]].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-[10px] uppercase tracking-wider text-white/45 font-medium">{k}</span>
              <span className="text-xs text-white/60">{v}</span>
            </div>
          ))}
        </div>

        <div ref={setRef(8)} className="card-rise space-y-2" style={{ transitionDelay: "360ms" }}>
          <Link href="/" className="block w-full py-4 text-white font-bold text-base text-center bid-btn-purple rounded-xl">
            오늘의 DTB 참여하기 →
          </Link>
          <button
            onClick={handleLogout}
            className="w-full py-3 text-white/40 text-sm rounded-xl border border-white/8 transition-colors hover:text-white/65 hover:border-white/20"
          >
            로그아웃
          </button>
        </div>

      </div>
      <BottomNav />
    </main>
  );
}
