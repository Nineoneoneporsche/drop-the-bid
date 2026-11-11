import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import BottomNav from "../../components/BottomNav";
import HomeButton from "../../components/HomeButton";
import SiteFooter from "../../components/SiteFooter";
import CatalogThumb from "../../components/CatalogThumb";
import { DROP_CATALOG, catalogItem } from "../../lib/dropCatalog";

function fmt(n: number) { return "₩" + n.toLocaleString("ko-KR"); }

export function generateStaticParams() {
  return DROP_CATALOG.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const item = catalogItem((await params).id);
  return { title: item ? `${item.name} | 드랍더비드` : "드랍 일정 | 드랍더비드" };
}

export default async function DropItemPage({ params }: { params: Promise<{ id: string }> }) {
  const item = catalogItem((await params).id);
  if (!item) notFound();

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center">
      <div className="w-full max-w-md px-4 pt-10 pb-6">
        <div className="flex items-center justify-between mb-5">
          <HomeButton />
          <Link href="/drops" className="text-white/55 text-sm">드랍 일정 전체</Link>
        </div>

        <div className="flex justify-center mb-5">
          <CatalogThumb item={item} size={200} />
        </div>

        <p className="text-xs text-white/45">{item.brand} · {item.category}</p>
        <h1 className="text-xl font-extrabold text-white leading-snug mt-1">{item.name}</h1>
        <p className="text-white/70 text-sm mt-2 leading-relaxed">{item.summary}</p>

        <div className="mt-5 bg-[#141414] border border-white/10 rounded-2xl px-4 py-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-white/55">정가</span>
            <span className="text-white font-semibold tabular-nums">{fmt(item.retailPrice)}</span>
          </div>
          <p className="text-white/35 text-xs">{item.retailPriceSource}</p>
          <div className="flex justify-between text-sm pt-1">
            <span className="text-white/55">드랍 일정</span>
            <span className="text-[#c084fc] font-semibold">{item.scheduleLabel}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/55">배송비</span>
            <span className="text-white/85">무료</span>
          </div>
          <p className="text-white/45 text-xs pt-1 leading-relaxed">
            드랍 시작가·최저가·가격 하락 규칙·진행 일시는 드랍 시작 전에 공지합니다.
            드랍에서는 시간이 지날수록 판매가격이 내려가며, 구매하기를 누른 시점의 가격으로 구매합니다.
          </p>
        </div>

        <h2 className="text-white font-bold text-base mt-7 mb-3">상품정보 제공고시</h2>
        <div className="bg-[#141414] border border-white/10 rounded-2xl overflow-hidden">
          {item.notice.map((f, i) => (
            <div key={f.label} className={`flex gap-3 px-4 py-3 text-sm ${i < item.notice.length - 1 ? "border-b border-white/[0.06]" : ""}`}>
              <span className="w-32 flex-shrink-0 text-white/50">{f.label}</span>
              <span className={f.value ? "text-white/85" : "text-white/40"}>{f.value ?? "드랍 공지 시 고지"}</span>
            </div>
          ))}
        </div>

        <h2 className="text-white font-bold text-base mt-7 mb-3">배송·교환·환불</h2>
        <div className="bg-[#141414] border border-white/10 rounded-2xl px-4 py-4 text-sm text-white/70 leading-relaxed space-y-1">
          <p>결제 완료 후 영업일 기준 2일 이내 출고, 배송비 무료 (국내 배송).</p>
          <p>상품을 받은 날부터 7일 이내 청약철회가 가능합니다.</p>
          <p>
            자세한 내용은 <Link href="/refund" className="underline text-white/85">환불정책</Link>을 확인해주세요.
          </p>
        </div>
      </div>

      <SiteFooter withBottomNav />
      <BottomNav />
    </main>
  );
}
