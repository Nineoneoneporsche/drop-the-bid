"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";
import { supabase } from "../lib/supabase";

function fmt(n: number) { return "₩" + n.toLocaleString("ko-KR"); }

interface StoredUser {
  nickname: string;
  email: string;
  phone: string;
  since: string;
  postcode: string;
  address: string;
  addressDetail: string;
}

const STATS = [
  { label: "참여",  value: "12회"     },
  { label: "낙찰",  value: "3회"      },
  { label: "절약",  value: "₩387,000" },
  { label: "승률",  value: "25%"      },
];

interface Order {
  product_name: string;
  amount: number;
  created_at: string;
}

const ACHIEVEMENTS = [
  { icon: "emoji_events",          label: "첫 낙찰",    unlocked: true  },
  { icon: "bolt",                  label: "반응왕",      unlocked: true  },
  { icon: "fitness_center",        label: "버티기 고수", unlocked: false },
  { icon: "gps_fixed",             label: "연습왕",      unlocked: false },
  { icon: "workspace_premium",     label: "레전드",      unlocked: false },
  { icon: "local_fire_department", label: "연속 참가",   unlocked: false },
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

  async function handleLogin() {
    setLoginErr("");
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) {
      setLoginErr("이메일 또는 비밀번호가 올바르지 않아요.");
      return;
    }
    window.location.reload();
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
  const [orders, setOrders] = useState<Order[]>([]);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const meta = session.user.user_metadata ?? {};
        setUser({
          nickname:      meta.name          || session.user.email?.split("@")[0] || "사용자",
          email:         session.user.email ?? "",
          phone:         meta.phone         ?? "",
          since:         meta.since         ?? session.user.created_at?.slice(0, 7).replace("-", ".") ?? "",
          postcode:      meta.postcode      ?? "",
          address:       meta.address       ?? "",
          addressDetail: meta.addressDetail ?? "",
        });

        // Load real order history
        const { data } = await supabase
          .from("orders")
          .select("product_name, amount, created_at")
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false })
          .limit(20);
        if (data) setOrders(data);
      }
      setLoaded(true);
    });
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

  async function handleLogout() {
    await supabase.auth.signOut();
    setUser(null);
  }

  const [editingAddr, setEditingAddr] = useState(false);
  const [addrForm, setAddrForm] = useState({ postcode: "", address: "", addressDetail: "", phone: "" });
  const [addrSaving, setAddrSaving] = useState(false);
  const [addrSaved, setAddrSaved] = useState(false);

  function openAddrEdit() {
    setAddrForm({
      postcode:      user?.postcode      ?? "",
      address:       user?.address       ?? "",
      addressDetail: user?.addressDetail ?? "",
      phone:         user?.phone         ?? "",
    });
    setEditingAddr(true);
  }

  function searchPostcode() {
    function open() {
      new (window as any).daum.Postcode({ // eslint-disable-line @typescript-eslint/no-explicit-any
        oncomplete: (data: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          setAddrForm(f => ({ ...f, postcode: data.zonecode, address: data.roadAddress || data.jibunAddress }));
        },
      }).open();
    }
    if ((window as any).daum?.Postcode) { open(); return; } // eslint-disable-line @typescript-eslint/no-explicit-any
    const s = document.createElement("script");
    s.src = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
    s.onload = open;
    document.head.appendChild(s);
  }

  async function saveAddr() {
    setAddrSaving(true);
    const { error } = await supabase.auth.updateUser({
      data: {
        phone:         addrForm.phone,
        postcode:      addrForm.postcode,
        address:       addrForm.address,
        addressDetail: addrForm.addressDetail,
      },
    });
    setAddrSaving(false);
    if (!error) {
      setUser(u => u ? { ...u, ...addrForm } : u);
      setAddrSaved(true);
      setTimeout(() => { setAddrSaved(false); setEditingAddr(false); }, 1200);
    }
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
            <p className="text-sm uppercase tracking-[0.12em] text-white/55 font-medium">낙찰 내역</p>
          </div>
          {orders.length === 0 ? (
            <div className="px-5 py-4">
              <p className="text-white/35 text-sm">아직 낙찰 내역이 없습니다.</p>
            </div>
          ) : orders.map((order, i) => {
            const date = new Date(order.created_at);
            const dateStr = `${date.getFullYear()}.${String(date.getMonth()+1).padStart(2,"0")}.${String(date.getDate()).padStart(2,"0")}`;
            return (
              <div key={i} className={`flex items-center gap-3 px-5 py-3.5 ${i < orders.length - 1 ? "border-b border-white/8" : ""}`}>
                <span className="material-symbols-outlined flex-shrink-0" style={{fontSize:"20px"}}>emoji_events</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white/80 truncate">{order.product_name}</p>
                  <p className="text-xs text-white/50 mt-0.5">{dateStr}</p>
                </div>
                <p className="text-sm font-black font-mono flex-shrink-0" style={{ color: "#c084fc" }}>{fmt(order.amount)}</p>
              </div>
            );
          })}
        </div>

        {/* Delivery address */}
        <div ref={setRef(5)} className="card-rise bg-[#141414] border border-white/10 rounded-2xl mb-5 overflow-hidden" style={{ transitionDelay: "225ms" }}>
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <p className="text-sm uppercase tracking-[0.12em] text-white/55 font-medium">배송지</p>
            {!editingAddr && (
              <button onClick={openAddrEdit} className="text-[11px] text-[#a855f7] font-semibold">
                {user.address ? "수정" : "등록"}
              </button>
            )}
          </div>

          {!editingAddr ? (
            <div className="px-5 pb-4">
              {user.address ? (
                <>
                  <p className="text-white/75 text-sm font-semibold">{user.nickname}{user.phone ? ` · ${user.phone}` : ""}</p>
                  {user.postcode && <p className="text-white/45 text-xs mt-0.5">({user.postcode})</p>}
                  <p className="text-white/65 text-sm mt-1">{user.address}</p>
                  {user.addressDetail && <p className="text-white/65 text-sm">{user.addressDetail}</p>}
                </>
              ) : (
                <p className="text-white/35 text-sm pb-1">등록된 배송지가 없습니다.</p>
              )}
            </div>
          ) : (
            <div className="px-5 pb-5 space-y-3">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-white/45 font-medium mb-1.5">휴대폰 번호</label>
                <input
                  type="tel"
                  value={addrForm.phone}
                  onChange={e => setAddrForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="010-0000-0000"
                  className="w-full bg-white/5 border border-white/12 focus:border-[#a855f7]/60 px-3.5 py-2.5 text-white placeholder-white/20 text-sm focus:outline-none rounded-xl transition-colors"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-white/45 font-medium mb-1.5">우편번호</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={addrForm.postcode}
                    placeholder="우편번호"
                    className="flex-1 bg-white/5 border border-white/12 px-3.5 py-2.5 text-white placeholder-white/20 text-sm focus:outline-none rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={searchPostcode}
                    className="flex-shrink-0 px-4 py-2.5 text-sm font-bold text-white rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    검색
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-white/45 font-medium mb-1.5">기본 주소</label>
                <input
                  readOnly
                  value={addrForm.address}
                  placeholder="주소 검색 후 자동 입력"
                  className="w-full bg-white/5 border border-white/12 px-3.5 py-2.5 text-white placeholder-white/20 text-sm focus:outline-none rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-white/45 font-medium mb-1.5">상세 주소</label>
                <input
                  value={addrForm.addressDetail}
                  onChange={e => setAddrForm(f => ({ ...f, addressDetail: e.target.value }))}
                  placeholder="동·호수, 건물명 등"
                  className="w-full bg-white/5 border border-white/12 focus:border-[#a855f7]/60 px-3.5 py-2.5 text-white placeholder-white/20 text-sm focus:outline-none rounded-xl transition-colors"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setEditingAddr(false)}
                  className="flex-1 py-2.5 text-sm text-white/45 border border-white/12 rounded-xl"
                >
                  취소
                </button>
                <button
                  onClick={saveAddr}
                  disabled={addrSaving || !addrForm.address}
                  className="flex-[2] py-2.5 text-sm font-bold text-white rounded-xl disabled:opacity-40 transition-colors"
                  style={{ background: addrSaved ? "#22c55e" : "linear-gradient(180deg,#bf7af0 0%,#a855f7 55%,#8b3fd9 100%)" }}
                >
                  {addrSaved ? "저장 완료!" : addrSaving ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Achievements */}
        <div ref={setRef(6)} className="card-rise bg-[#141414] border border-white/10 rounded-2xl mb-5 px-5 py-4" style={{ transitionDelay: "260ms" }}>
          <div className="flex items-baseline justify-between mb-4">
            <p className="text-sm uppercase tracking-[0.12em] text-white/55 font-medium">획득 배지</p>
            <span className="text-xs text-white/50">{ACHIEVEMENTS.filter(a => a.unlocked).length}/{ACHIEVEMENTS.length}</span>
          </div>
          <div className="flex gap-5">
            {ACHIEVEMENTS.map(({ icon, label, unlocked }) => (
              <div key={label} className="flex flex-col items-center gap-1">
                <span className="material-symbols-outlined leading-none" style={{ fontSize: "1.8rem", opacity: unlocked ? 1 : 0.25 }}>
                  {icon}
                </span>
                <p className={`text-xs font-medium text-center ${unlocked ? "text-white/70" : "text-white/40"}`}>{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Quick links */}
        <div ref={setRef(7)} className="card-rise bg-[#141414] border border-white/10 rounded-2xl mb-5 overflow-hidden" style={{ transitionDelay: "300ms" }}>
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
        <div ref={setRef(8)} className="card-rise mb-6 space-y-1.5" style={{ transitionDelay: "340ms" }}>
          {[["버전", "0.4.0 (MVP Demo)"], ["제작", "Drop The Bid Team"], ["문의", "hello@dtb.kr"]].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-[10px] uppercase tracking-wider text-white/45 font-medium">{k}</span>
              <span className="text-xs text-white/60">{v}</span>
            </div>
          ))}
        </div>

        <div ref={setRef(9)} className="card-rise space-y-2" style={{ transitionDelay: "380ms" }}>
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
