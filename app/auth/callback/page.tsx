"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(async ({ data, error }) => {
        if (!error && data.session?.user) {
          const user = data.session.user;
          const meta = user.user_metadata ?? {};
          const rawNick = (meta.nickname || meta.full_name || meta.name || user.email?.split("@")[0] || "사용자")
            .replace(/\s+/g, "_")
            .replace(/[^가-힣a-zA-Z0-9_]/g, "")
            .slice(0, 12);
          if (rawNick) {
            await supabase.from("profiles").upsert(
              { id: user.id, nickname: rawNick },
              { onConflict: "id", ignoreDuplicates: true }
            );
          }
        }
        router.replace("/mypage");
      });
    } else {
      router.replace("/mypage");
    }
  }, [router]);

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex items-center justify-center">
      <svg className="animate-spin w-6 h-6 text-[#a855f7]" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
      </svg>
    </main>
  );
}
