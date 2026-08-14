"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

function ResetPasswordInner() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "ready" | "success" | "error">("loading");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // PKCE flow: code in query string
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        setStatus(error ? "error" : "ready");
      });
      return;
    }
    // Legacy flow: token in hash
    supabase.auth.getSession().then(({ data: { session } }) => {
      setStatus(session ? "ready" : "error");
    });
  }, []);

  async function handleReset() {
    if (password.length < 8) { setError("8자 이상 입력하세요"); return; }
    if (password !== passwordConfirm) { setError("비밀번호가 일치하지 않습니다"); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); setSaving(false); return; }
    setStatus("success");
    setTimeout(() => router.push("/mypage"), 2000);
  }

  if (status === "loading") return (
    <main className="min-h-screen bg-[#0f0f0f] flex items-center justify-center">
      <svg className="animate-spin w-6 h-6 text-[#a855f7]" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
      </svg>
    </main>
  );

  if (status === "error") return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center px-4 text-center">
      <div className="w-14 h-14 rounded-full bg-white/8 flex items-center justify-center mb-5">
        <span className="material-symbols-outlined text-white/40" style={{ fontSize: "28px" }}>link_off</span>
      </div>
      <p className="text-white font-bold text-lg mb-2">링크가 만료되었습니다</p>
      <p className="text-white/45 text-sm mb-8 leading-relaxed">비밀번호 재설정을 다시 요청해주세요.</p>
      <a href="/mypage" className="text-[#a855f7] text-sm font-semibold">← 로그인 화면으로</a>
    </main>
  );

  if (status === "success") return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center px-4 text-center">
      <div className="w-14 h-14 rounded-full bg-[#a855f7]/15 border border-[#a855f7]/30 flex items-center justify-center mb-5">
        <svg viewBox="0 0 24 24" className="w-7 h-7 text-[#a855f7]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <p className="text-white font-bold text-lg mb-2">비밀번호가 변경되었습니다</p>
      <p className="text-white/45 text-sm">잠시 후 로그인 화면으로 이동합니다...</p>
    </main>
  );

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col max-w-md mx-auto px-4 pt-16 pb-12">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.14em] text-white/55 font-medium mb-1">Drop The Bid</p>
        <h1 className="text-4xl font-black text-white leading-tight">새 비밀번호 설정</h1>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-white/50 font-medium mb-1.5">새 비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }}
            placeholder="8자 이상"
            className="w-full bg-white/5 border border-white/12 focus:border-[#a855f7]/60 px-3.5 py-3 text-white placeholder-white/20 text-sm focus:outline-none rounded-xl transition-colors"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-white/50 font-medium mb-1.5">비밀번호 확인</label>
          <input
            type="password"
            value={passwordConfirm}
            onChange={e => { setPasswordConfirm(e.target.value); setError(""); }}
            placeholder="비밀번호 재입력"
            onKeyDown={e => e.key === "Enter" && handleReset()}
            className="w-full bg-white/5 border border-white/12 focus:border-[#a855f7]/60 px-3.5 py-3 text-white placeholder-white/20 text-sm focus:outline-none rounded-xl transition-colors"
            autoComplete="new-password"
          />
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          onClick={handleReset}
          disabled={saving}
          className="w-full py-4 text-white font-bold text-base rounded-xl disabled:opacity-50 transition-opacity active:opacity-80"
          style={{ background: "linear-gradient(180deg, #bf7af0 0%, #a855f7 55%, #8b3fd9 100%)" }}
        >
          {saving ? "변경 중..." : "비밀번호 변경"}
        </button>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}
