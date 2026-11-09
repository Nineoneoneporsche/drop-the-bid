import Link from "next/link";
import { BUSINESS_INFO, businessNumberCheckUrl } from "../lib/businessInfo";

// 사업자 정보 footer — 전자상거래법상 사이버몰 운영자 표시 항목과 약관/정책
// 링크. 값은 app/lib/businessInfo.ts 한 곳에서만 관리한다. BottomNav가 있는
// 페이지에서는 pb-28로 nav 아래에 가려지지 않게 한다.
export default function SiteFooter({ withBottomNav = false }: { withBottomNav?: boolean }) {
  const b = BUSINESS_INFO;
  const rows: [string, string | null][] = [
    ["상호", b.companyName],
    ["대표자", b.representative],
    ["사업자등록번호", b.businessNumber],
    ["통신판매업 신고번호", b.mailOrderNumber],
    ["주소", b.address],
    ["고객센터", b.customerPhone],
    ["이메일", b.customerEmail],
    ["개인정보 보호책임자", b.privacyOfficer],
    ["호스팅 제공자", b.hostingProvider],
  ];
  return (
    <footer
      data-site-footer=""
      className={`w-full max-w-md mx-auto px-5 pt-8 text-white/40 text-[11px] leading-relaxed ${withBottomNav ? "pb-32" : "pb-10"}`}
    >
      <nav className="flex flex-wrap gap-x-4 gap-y-1 mb-4 text-xs text-white/60">
        <Link href="/terms" className="hover:text-white">이용약관</Link>
        <Link href="/privacy" className="font-semibold hover:text-white">개인정보처리방침</Link>
        <Link href="/refund" className="hover:text-white">환불정책</Link>
      </nav>
      <p className="text-white/55 font-semibold mb-1">{b.serviceName}</p>
      <dl className="space-y-0.5">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="flex-shrink-0">{k}</dt>
            <dd className="text-white/50 break-keep">{v}</dd>
          </div>
        ))}
      </dl>
      <a
        href={businessNumberCheckUrl(b.businessNumber)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block mt-2 underline underline-offset-2 hover:text-white"
      >
        사업자정보 확인
      </a>
      <p className="mt-3">
        드랍더비드는 실시간 가격하락 딜 방식으로 상품을 판매합니다. 드랍 참여는 무료이며, 구매를 확정한 상품의 구매가만 결제합니다.
      </p>
      <p className="mt-2">© {b.companyName}. All rights reserved.</p>
    </footer>
  );
}
