import type { Metadata } from "next";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";
import SiteFooter from "../components/SiteFooter";
import CatalogThumb from "../components/CatalogThumb";
import { DROP_CATALOG } from "../lib/dropCatalog";

export const metadata: Metadata = { title: "드랍 일정 | 드랍더비드" };

function fmt(n: number) { return "₩" + n.toLocaleString("ko-KR"); }

export default function DropsPage() {
  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center">
      <div className="w-full max-w-md px-4 pt-10 pb-6">
        <div className="flex mb-5">
          <HomeButton />
        </div>

        <div className="mb-6">
          <h1 className="text-[22px] font-extrabold text-white leading-tight">드랍 일정</h1>
          <p className="text-white/65 text-base mt-2">드랍더비드에서 판매할 예정인 상품입니다.</p>
          <p className="text-white/40 text-xs mt-1">드랍 시작가·최저가·진행 일시는 각 드랍 시작 전에 공지합니다.</p>
        </div>

        <div className="flex flex-col gap-3">
          {DROP_CATALOG.map((item) => (
            <Link
              key={item.id}
              href={`/drops/${item.id}`}
              className="flex items-center gap-4 bg-[#141414] border border-white/10 rounded-2xl px-4 py-4 transition-colors hover:border-white/25"
            >
              <CatalogThumb item={item} size={64} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/45">{item.brand} · {item.category}</p>
                <p className="text-white font-semibold text-base leading-snug mt-0.5">{item.name}</p>
                <p className="text-white/80 text-sm tabular-nums mt-1">정가 {fmt(item.retailPrice)}</p>
                <p className="text-[#c084fc] text-xs font-semibold mt-1">{item.scheduleLabel}</p>
              </div>
              <span className="material-symbols-outlined text-white/35" style={{ fontSize: 20 }} aria-hidden>chevron_right</span>
            </Link>
          ))}
        </div>
      </div>

      <SiteFooter withBottomNav />
      <BottomNav />
    </main>
  );
}
