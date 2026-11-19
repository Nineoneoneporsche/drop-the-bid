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
      // 2026-11-19 확인: 아이스토어(Apple Premium Partner) 상품정보표시,
      // 크기·무게·구성품은 apple.com/kr/ipad-air/specs
      { label: "품명 및 모델명", value: "iPad Air 11형 (M4) Wi-Fi 128GB / A3459" },
      { label: "KC 인증정보", value: "R-C-APA-A3459, XU104221-26001" },
      { label: "정격전압·소비전력", value: "충전식 배터리 내장, 20W USB-C 전원 어댑터 포함" },
      { label: "출시년월", value: "2026년 3월" },
      { label: "제조자(수입자)", value: APPLE_MAKER },
      { label: "제조국", value: "중국" },
      { label: "크기·무게", value: "247.6 × 178.5 × 6.1mm, 464g" },
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
      // 2026-11-19 확인: 코스트코 코리아 상품정보 제공고시
      { label: "품명 및 모델명", value: "AirPods Pro 3 (MFHP4KH/A)" },
      { label: "KC 인증정보", value: "R-C-APL-A3063, R-C-APL-A3064, R-C-APL-A3122, R-C-APA-A3325" },
      { label: "정격전압·소비전력", value: "충전식 배터리 내장 (USB-C 충전)" },
      { label: "출시년월", value: "2025년 9월" },
      { label: "제조자(수입자)", value: APPLE_MAKER },
      { label: "제조국", value: "중국, 베트남 (출고 시점에 따라 다를 수 있음)" },
      { label: "크기·무게", value: "이어버드 19.2 × 30.9 × 27.0mm, 5.3g / 케이스 62.2 × 47.2 × 21.8mm, 43.99g" },
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
      // 2026-11-19 확인: 다이슨코리아 공식몰 상품정보 (세라믹 핑크/로즈 골드)
      { label: "품명 및 모델명", value: "에어랩 코안다2x 멀티 스타일러 앤 드라이어 (세라믹 핑크/로즈 골드) / 492466-01" },
      { label: "KC 인증정보", value: "전기용품 안전인증 HU073724-25001, 전자파적합성 R-R-DkL-HS09" },
      { label: "정격전압·소비전력", value: "220V 60Hz, 1700W" },
      { label: "출시년월", value: "2026년 6월" },
      { label: "제조자(수입자)", value: "Dyson Technology Limited (수입: 다이슨코리아 유한회사)" },
      { label: "제조국", value: "필리핀, 중국" },
      { label: "크기·무게", value: "169 × 481 × 190mm (높이×길이×너비), 410g" },
      { label: "품질보증기준", value: "제조사 보증 2년, 소비자분쟁해결기준(공정거래위원회 고시)에 따름" },
      { label: "A/S 책임자와 전화번호", value: "다이슨코리아 고객센터 080-300-4253 / 1588-4253" },
    ],
  },
];

export function catalogItem(id: string): CatalogItem | undefined {
  return DROP_CATALOG.find((p) => p.id === id);
}

// The live drop's product (game_state.product_name, set in the admin page)
// matched to its catalog entry, so the drop screens can link to the detail
// page (상품정보 제공고시, 배송·교환·환불). Exact name match only.
export function catalogItemByName(name: string | null | undefined): CatalogItem | undefined {
  const n = (name ?? "").trim();
  return n ? DROP_CATALOG.find((p) => p.name === n) : undefined;
}
