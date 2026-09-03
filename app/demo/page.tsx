"use client";

import { useRouter } from "next/navigation";
import { ProductImageFill, ProductThumb } from "../components/ProductImage";
import { formatKRW } from "../context/GameContext";

const PRODUCT_NAME = "Apple iPad Air 11형 Wi-Fi 128GB";
const PRODUCT_DESC = "강력한 M3 칩과 11형 Liquid Retina 디스플레이를 탑재한 iPad Air";
const START_PRICE = 899_000;
const FLOOR_PRICE = 550_000;
const DROP_AMOUNT = 1_000;

const STATS = [
  { label: "참여자 수", value: "0명", icon: "back_hand" },
  { label: "관전자 수", value: "0명", icon: "visibility" },
  { label: "시작가", value: formatKRW(START_PRICE), icon: "payments" },
  { label: "목표 하한가", value: formatKRW(FLOOR_PRICE), icon: "gps_fixed" },
  { label: "하락 속도", value: `${formatKRW(DROP_AMOUNT)}/초`, icon: "trending_down" },
  { label: "최대 절약", value: formatKRW(START_PRICE - FLOOR_PRICE), icon: "auto_awesome" },
];

const FLOW_STEPS = [
  { icon: "chat_bubble",   title: "전략 회의 1분", desc: "참여자들과 실시간 채팅으로 전략을 세워요" },
  { icon: "trending_down", title: "가격 하락 시작", desc: `초당 ${formatKRW(DROP_AMOUNT)} 씩 자동으로 내려가요` },
  { icon: "back_hand",     title: "손들기", desc: "원하는 가격이 됐을 때 손을 들어요" },
  { icon: "emoji_events",  title: "낙찰 확정", desc: "가장 먼저 손든 참여자가 그 가격에 낙찰!" },
];

export default function DemoPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-[#fffbf5] flex flex-col items-center pb-16">
      <div className="w-full max-w-md px-4 pt-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-lg font-black text-gray-900 tracking-tight">Demo</h1>
            <p className="text-gray-400 text-xs mt-0.5">Rabbit — 투자자 데모</p>
          </div>
          <a
            href="/"
            className="text-xs text-gray-400 border border-gray-200 rounded-xl px-3 py-1.5 bg-white hover:border-orange-300 hover:text-orange-500 transition-colors shadow-sm"
          >
            ← 홈
          </a>
        </div>

        {/* LIVE badge */}
        <div className="flex items-center gap-2 mb-4">
          <span className="flex items-center gap-1.5 bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            LIVE
          </span>
          <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-200">
            데모 상품
          </span>
          <span className="ml-auto text-gray-400 text-xs flex items-center gap-1">
            <span className="material-symbols-outlined" style={{fontSize:"13px"}}>visibility</span>0명 관전 중
          </span>
        </div>

        {/* Hero product card */}
        <div className="bg-white rounded-3xl shadow-sm border border-orange-50 overflow-hidden mb-4">
          <div className="relative w-full" style={{ height: 280 }}>
            <ProductImageFill alt={PRODUCT_NAME} priority />
            <div className="absolute bottom-3 left-3">
              <span className="bg-orange-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg float-badge">
                <span className="material-symbols-outlined" style={{fontSize:"13px",verticalAlign:"-2px"}}>back_hand</span> 0명 대기 중
              </span>
            </div>
            <div className="absolute top-3 right-3">
              <span className="bg-white/90 backdrop-blur-sm text-orange-500 text-sm font-black px-3 py-1.5 rounded-full shadow-md border border-orange-100">
                {formatKRW(START_PRICE)}
              </span>
            </div>
          </div>

          <div className="px-5 pt-4 pb-5">
            <h2 className="text-gray-900 font-bold text-base leading-snug mb-1">
              {PRODUCT_NAME}
            </h2>
            <p className="text-gray-400 text-sm mb-4">{PRODUCT_DESC}</p>

            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-gray-400 text-xs">시작가</span>
              <span className="text-3xl font-black text-orange-500 font-mono tabular-nums">
                {formatKRW(START_PRICE)}
              </span>
            </div>
            <p className="text-gray-400 text-xs mb-5">
              ↓ {formatKRW(DROP_AMOUNT)}/초 하락 · 최저 {formatKRW(FLOOR_PRICE)}
            </p>

            <button
              onClick={() => router.push("/join")}
              className="w-full font-bold py-4 rounded-2xl text-base text-white transition-all active:scale-[0.98] shadow-md"
              style={{
                background: "linear-gradient(135deg, #fb923c 0%, #f97316 100%)",
                boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
              }}
            >
              지금 체험해보기 →
            </button>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {STATS.map(({ label, value, icon }) => (
            <div
              key={label}
              className="bg-white rounded-2xl p-3 text-center border border-gray-100 shadow-sm"
            >
              <div className="mb-1"><span className="material-symbols-outlined text-gray-400" style={{fontSize:"22px"}}>{icon}</span></div>
              <p className="text-gray-900 font-bold text-sm leading-tight">{value}</p>
              <p className="text-gray-400 text-xs mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* How it works */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 mb-4">
          <p className="text-gray-400 text-xs uppercase tracking-wider font-medium mb-4">
            진행 방식
          </p>
          <div className="space-y-4">
            {FLOW_STEPS.map(({ icon, title, desc }, i) => (
              <div key={title} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-orange-50 border border-orange-100 flex items-center justify-center text-xs flex-shrink-0 font-bold text-orange-500">
                  {i + 1}
                </div>
                <div>
                  <p className="text-gray-800 text-base font-semibold flex items-center gap-1"><span className="material-symbols-outlined text-gray-400" style={{fontSize:"15px"}}>{icon}</span>{title}</p>
                  <p className="text-gray-400 text-xs mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Product gallery strip */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 mb-4">
          <p className="text-gray-400 text-xs uppercase tracking-wider font-medium mb-4">
            상품 미리보기
          </p>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {[72, 72, 72].map((size, i) => (
              <ProductThumb
                key={i}
                alt={PRODUCT_NAME}
                size={size}
                rounded="rounded-2xl"
                className="object-contain flex-shrink-0"
              />
            ))}
            <div className="flex-shrink-0 w-[72px] h-[72px] rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center">
              <span className="text-orange-300 text-xs font-medium text-center leading-tight px-2">
                더보기
              </span>
            </div>
          </div>
        </div>

        {/* Social proof */}
        <div className="bg-white rounded-3xl shadow-sm border border-amber-100 p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-amber-500" style={{fontSize:"20px"}}>chat_bubble</span>
            <span className="text-amber-600 text-xs font-semibold uppercase tracking-wider">
              참여자 후기
            </span>
          </div>
          <div className="space-y-3">
            {[
              { nick: "Samdori", msg: "₩187,000에 낙찰! 정말 신기한 쇼핑 경험이었어요 🎉" },
              { nick: "minivelo_fan", msg: "라이브로 가격이 내려가는 걸 보는 게 너무 재미있어요" },
              { nick: "smart_buyer", msg: "타이밍 싸움이라 긴장감이 엄청나요 ㅎㅎ" },
            ].map(({ nick, msg }) => (
              <div key={nick} className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-400 to-amber-400 flex items-center justify-center text-xs font-black text-white flex-shrink-0">
                  {nick[0].toUpperCase()}
                </div>
                <div className="flex-1 bg-gray-50 rounded-2xl rounded-tl-sm px-3 py-2 text-xs border border-gray-100">
                  <span className="text-gray-400 mr-1.5">{nick}</span>
                  <span className="text-gray-700">{msg}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Final CTA */}
        <button
          onClick={() => router.push("/join")}
          className="w-full font-bold py-4 rounded-2xl text-base text-white transition-all active:scale-[0.98] shadow-md"
          style={{
            background: "linear-gradient(135deg, #fb923c 0%, #f97316 100%)",
            boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
          }}
        >
          데모 체험하기 →
        </button>
      </div>
    </main>
  );
}
