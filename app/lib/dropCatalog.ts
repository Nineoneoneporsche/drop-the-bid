// 드랍 일정 — products the company plans to sell in upcoming drops, shown on
// /drops and /drops/[id]. Every entry must be a product that will really be
// sold (listing products that won't be is the same problem as the fake
// results page that was removed). Edit this file and redeploy to change the
// lineup; a DB-backed admin editor can replace it later.
//
// retailPrice is the manufacturer's Korean list price (출고가/권장소비자가)
// as checked on the date in retailPriceSource — not the drop's start price,
// which is announced per drop. Notice fields follow 전자상거래법 상품정보
// 제공고시 (소형전자 / 가정용 전기제품); a null value is shown as "드랍 공지 시
// 고지" and must be filled before that product's drop opens.

export type NoticeField = { label: string; value: string | null };

export type CatalogItem = {
  id: string;
  name: string;
  brand: string;
  category: string;
  icon: string;            // material symbol shown when there is no photo
  image: string | null;    // /public path; null shows the category icon
  // Where the image came from. Manufacturer images are used provisionally
  // (no license yet) and must be replaced with own photos or licensed
  // images before/at launch — see imageSource for what to swap.
  imageSource: string | null;
  retailPrice: number;
  retailPriceSource: string;
  scheduleLabel: string;   // honest schedule text — "일정 미정" until a date is set
  summary: string;
  notice: NoticeField[];
};

const APPLE_AS = "Apple 고객지원 080-333-4000";
const APPLE_MAKER = "Apple Inc. (수입: 애플코리아 유한회사)";
const WARRANTY = "제조사 보증 1년, 소비자분쟁해결기준(공정거래위원회 고시)에 따름";

export const DROP_CATALOG: CatalogItem[] = [
  {
    id: "ipad-air-11",
    name: "Apple iPad Air 11형 Wi-Fi 128GB",
    brand: "Apple",
    category: "태블릿",
    icon: "tablet_mac",
    image: "/product.png",
    imageSource: "기존 사이트 이미지 (출처 확인 필요)",
    retailPrice: 1_249_000,
    retailPriceSource: "Apple 공식 온라인 스토어 판매가 (M4, 2026-11-11 확인)",
    scheduleLabel: "드랍 예정 · 일정 미정",
    summary: "M4 칩, 11형 Liquid Retina 디스플레이, Wi-Fi 128GB 모델입니다.",
    notice: [
      { label: "품명 및 모델명", value: "iPad Air 11형 (M4) Wi-Fi 128GB" },
      { label: "KC 인증정보", value: null },
      { label: "정격전압·소비전력", value: null },
      { label: "출시년월", value: null },
      { label: "제조자(수입자)", value: APPLE_MAKER },
      { label: "제조국", value: null },
      { label: "크기·무게", value: null },
      { label: "품질보증기준", value: WARRANTY },
      { label: "A/S 책임자와 전화번호", value: APPLE_AS },
    ],
  },
  {
    id: "airpods-pro-3",
    name: "Apple AirPods Pro 3",
    brand: "Apple",
    category: "이어폰",
    icon: "headphones",
    image: "/products/airpods-pro-3.png",
    imageSource: "Apple 공식 온라인 스토어 상품 이미지 (임시 사용, 2026-11-11)",
    retailPrice: 369_000,
    retailPriceSource: "Apple 공식 온라인 스토어 판매가 (2026-11-11 확인)",
    scheduleLabel: "드랍 예정 · 일정 미정",
    summary: "액티브 노이즈 캔슬링과 심박수 측정을 지원하는 무선 이어폰입니다.",
    notice: [
      { label: "품명 및 모델명", value: "AirPods Pro 3 (MFHP4KH/A)" },
      { label: "KC 인증정보", value: null },
      { label: "정격전압·소비전력", value: null },
      { label: "출시년월", value: "2025년 9월" },
      { label: "제조자(수입자)", value: APPLE_MAKER },
      { label: "제조국", value: null },
      { label: "크기·무게", value: null },
      { label: "품질보증기준", value: WARRANTY },
      { label: "A/S 책임자와 전화번호", value: APPLE_AS },
    ],
  },
  {
    id: "apple-watch-series-11",
    name: "Apple Watch Series 11 GPS 42mm 알루미늄",
    brand: "Apple",
    category: "스마트워치",
    icon: "watch",
    image: "/products/apple-watch-series-11.png",
    imageSource: "Apple Newsroom 보도 이미지 (임시 사용, 2026-11-11)",
    retailPrice: 599_000,
    retailPriceSource: "Apple 국내 출고가 (2025년 9월 출시 기준)",
    scheduleLabel: "드랍 예정 · 일정 미정",
    summary: "GPS 모델, 42mm 알루미늄 케이스입니다.",
    notice: [
      { label: "품명 및 모델명", value: "Apple Watch Series 11 GPS 42mm 알루미늄" },
      { label: "KC 인증정보", value: null },
      { label: "정격전압·소비전력", value: null },
      { label: "출시년월", value: "2025년 9월" },
      { label: "제조자(수입자)", value: APPLE_MAKER },
      { label: "제조국", value: null },
      { label: "크기·무게", value: null },
      { label: "품질보증기준", value: WARRANTY },
      { label: "A/S 책임자와 전화번호", value: APPLE_AS },
    ],
  },
  {
    id: "dyson-airwrap-coanda-2x",
    name: "다이슨 에어랩 코안다2x 멀티 스타일러 앤 드라이어",
    brand: "Dyson",
    category: "헤어 스타일러",
    icon: "air",
    image: "/products/dyson-airwrap-coanda-2x.png",
    imageSource: "다이슨코리아 공식몰 상품 이미지 (임시 사용, 2026-11-11)",
    retailPrice: 879_000,
    retailPriceSource: "다이슨 권장소비자가 (2026년 6월 출시 기준)",
    scheduleLabel: "드랍 예정 · 일정 미정",
    summary: "드라이, 컬, 스트레이트가 가능한 노즐 6종 구성의 멀티 스타일러입니다.",
    notice: [
      { label: "품명 및 모델명", value: "에어랩 코안다2x 멀티 스타일러 앤 드라이어" },
      { label: "KC 인증정보", value: null },
      { label: "정격전압·소비전력", value: null },
      { label: "출시년월", value: "2026년 6월" },
      { label: "제조자(수입자)", value: "Dyson (수입: 다이슨코리아 유한회사)" },
      { label: "제조국", value: null },
      { label: "크기·무게", value: null },
      { label: "품질보증기준", value: WARRANTY },
      { label: "A/S 책임자와 전화번호", value: null },
    ],
  },
];

export function catalogItem(id: string): CatalogItem | undefined {
  return DROP_CATALOG.find((p) => p.id === id);
}
