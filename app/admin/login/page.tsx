"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.ok) {
        router.push("/admin");
        router.refresh();
      } else {
        setError(data.error || "비밀번호가 올바르지 않습니다");
      }
    } catch {
      setError("오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#fffbf5] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-400 font-medium mb-1">Drop The Bid</p>
          <h1 className="text-2xl font-black text-gray-900">관리자 로그인</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }}
            placeholder="비밀번호를 입력하세요"
            className="w-full bg-white border-2 border-gray-200 rounded-2xl px-4 py-3.5 text-gray-900 placeholder-gray-300 focus:outline-none focus:border-orange-400 transition-colors shadow-sm"
            autoFocus
            autoComplete="current-password"
          />
          {error && <p className="text-red-500 text-sm px-1">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-4 font-bold text-white rounded-2xl transition-all active:scale-[0.98] disabled:opacity-40 shadow-md"
            style={{ background: "linear-gradient(135deg,#fb923c 0%,#f97316 100%)" }}
          >
            {loading ? "확인 중..." : "입장"}
          </button>
        </form>
      </div>
    </main>
  );
}
