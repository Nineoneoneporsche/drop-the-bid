import Link from "next/link";
import SiteFooter from "./SiteFooter";

// 공개 약관/정책 페이지 공통 레이아웃 (/terms, /privacy, /refund).
// 본문은 app/lib/legal.ts의 평문을 줄바꿈 그대로 보여준다.
export default function LegalDocument({ title, body }: { title: string; body: string }) {
  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center">
      <div className="w-full max-w-md px-5 pt-8">
        <Link href="/" className="text-white/50 text-sm hover:text-white">← 홈으로</Link>
        <h1 className="text-white text-xl font-extrabold mt-4 mb-6">{title}</h1>
        <article className="text-white/75 text-sm leading-relaxed whitespace-pre-wrap break-keep">{body}</article>
      </div>
      <SiteFooter />
    </main>
  );
}
