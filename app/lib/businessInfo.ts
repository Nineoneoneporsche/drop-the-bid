// 사업자 정보 — footer와 약관/정책 페이지가 이 값을 그대로 보여준다.
// 전자상거래법 제10조(사이버몰 운영자 표시)와 PG/카드사 심사에서 요구하는
// 항목들이다. null인 항목은 화면에 표시하지 않으므로, PG 심사 신청 전에는
// 모든 값을 채워야 한다.

// 마이페이지 하단에 표시하는 서비스 버전.
export const APP_VERSION = "1.0.0";

export const BUSINESS_INFO = {
  serviceName: "드랍더비드 (Drop The Bid)",
  companyName: "에스피알씨",
  representative: "송종우",
  businessNumber: "444-64-00462",
  mailOrderNumber: "제 2026-경기구리-1192 호",
  address: "경기도 구리시 갈매중앙로 190, A동 8층 10호",
  customerPhone: "010-9972-0070" as string | null,
  customerEmail: "help@dropthebid.com" as string | null,
  privacyOfficer: "송종우",
  hostingProvider: "Vercel Inc.",
} as const;

// 공정거래위원회 사업자정보 공개 페이지 (통신판매업 신고 확인용 링크).
export function businessNumberCheckUrl(businessNumber: string): string {
  return `https://www.ftc.go.kr/bizCommPop.do?wrkr_no=${businessNumber.replace(/\D/g, "")}`;
}
