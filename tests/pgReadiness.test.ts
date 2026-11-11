// PG 심사 대비 (사업자 정보 / 약관 / 용어): 사용자 화면에 경매 용어가
// 다시 들어오지 않는지, footer와 정책 본문이 사업자 정보를 담는지 확인한다.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import SiteFooter from "../app/components/SiteFooter";
import { BUSINESS_INFO } from "../app/lib/businessInfo";
import { MARKETING_CONSENT, PRIVACY_POLICY, REFUND_POLICY, TERMS_OF_SERVICE } from "../app/lib/legal";

const ROOT = path.resolve(__dirname, "..");
const AUCTION_WORDS = /역경매|경매|낙찰|입찰/;

// Admin pages and admin API messages are operator-only; comments don't ship as UI.
function consumerSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return /[\\/]app[\\/](admin|api[\\/]admin)$/.test(p) ? [] : consumerSourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
const isComment = (l: string) => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l);

describe("user-facing wording", () => {
  it("no auction wording outside comments in consumer app code", () => {
    const hits: string[] = [];
    for (const f of consumerSourceFiles(path.join(ROOT, "app"))) {
      fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => {
        if (!isComment(l) && AUCTION_WORDS.test(l)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
  it("signup collects no card details (payment goes through Toss only)", () => {
    const src = fs.readFileSync(path.join(ROOT, "app", "signup", "page.tsx"), "utf8");
    expect(src).not.toMatch(/cc-number|cc-csc|cardNumber|카드 번호/);
  });
  it("home hero sells, it doesn't pit buyers against each other", () => {
    const src = fs.readFileSync(path.join(ROOT, "app", "page.tsx"), "utf8");
    expect(src).toContain("원할 때 구매하세요");
    expect(src).not.toMatch(/과연 누가|가져갈까요|경쟁 중/);
    expect(src).toContain("최대 할인");
    expect(src).not.toMatch(/\/초|하락 속도/);
  });
  it("legal texts use 드랍/구매 wording only", () => {
    for (const t of [TERMS_OF_SERVICE, PRIVACY_POLICY, REFUND_POLICY, MARKETING_CONSENT]) expect(t).not.toMatch(AUCTION_WORDS);
  });
});

describe("legal texts", () => {
  it("terms define 드랍 as a sale and state participation is free", () => {
    expect(TERMS_OF_SERVICE).toContain('"드랍"이란');
    expect(TERMS_OF_SERVICE).toContain("한정 판매");
    expect(TERMS_OF_SERVICE).toContain("드랍 참여, 관전, 채팅, 구매 체험은 무료입니다");
    expect(TERMS_OF_SERVICE).toContain("30분 이내에 결제");
    expect(TERMS_OF_SERVICE).toContain(BUSINESS_INFO.companyName);
  });
  it("refund policy keeps the statutory withdrawal periods", () => {
    expect(REFUND_POLICY).toContain("7일 이내");
    expect(REFUND_POLICY).toContain("3개월 이내");
    expect(REFUND_POLICY).toContain("3영업일 이내");
    expect(REFUND_POLICY).toContain(BUSINESS_INFO.address);
    expect(REFUND_POLICY).toContain("영업일 기준 2일 이내에 출고");
    expect(REFUND_POLICY).toContain("결제일로부터 7일 이내 도착");
    expect(REFUND_POLICY).toContain("배송비: 무료");
  });
  it("privacy policy names the processors and the privacy officer", () => {
    for (const s of ["Supabase", "Vercel", "Cloudflare", "국외 이전", BUSINESS_INFO.privacyOfficer]) expect(PRIVACY_POLICY).toContain(s);
  });
  it("names no payment gateway that isn't contracted (Toss declined the application)", () => {
    for (const t of [TERMS_OF_SERVICE, PRIVACY_POLICY, REFUND_POLICY]) expect(t).not.toMatch(/토스|Toss/i);
  });
});

describe("SiteFooter", () => {
  it("shows every filled business field and the policy links", () => {
    const html = renderToStaticMarkup(createElement(SiteFooter));
    for (const v of Object.values(BUSINESS_INFO)) if (v) expect(html).toContain(v);
    for (const href of ["/terms", "/privacy", "/refund"]) expect(html).toContain(`href="${href}"`);
    expect(html).toContain("ftc.go.kr");
    expect(html).toContain("4446400462");
  });
  it("public policy pages exist", () => {
    for (const p of ["terms", "privacy", "refund"]) expect(fs.existsSync(path.join(ROOT, "app", p, "page.tsx"))).toBe(true);
  });
});

describe("auction-free imagery", () => {
  it("home hero, OG image and stage backdrop point at the new art; old auction art is gone", () => {
    const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
    expect(read("app/page.tsx")).toContain('src="/finalmainimage.png"');
    expect(read("app/components/StageBackdrop.tsx")).toContain('src="/finalmainimage.png"');
    for (const f of ["app/layout.tsx", "app/join/layout.tsx"]) expect(read(f)).toContain("/og-image-main.jpg");
    for (const p of ["public/finalmainimage.png", "public/og-image-main.jpg"]) expect(fs.existsSync(path.join(ROOT, p))).toBe(true);
    // main.png / og-image-drop.jpg had a ₩899,000 -> ₩405,000 board, a TIME LEFT countdown and a club crowd.
    for (const p of ["public/main.png", "public/og-image-drop.jpg", "public/newmainimage.png", "public/gamepagevideo.mp4", "public/og-image.jpg"]) expect(fs.existsSync(path.join(ROOT, p))).toBe(false);
    for (const f of consumerSourceFiles(path.join(ROOT, "app"))) expect(read(path.relative(ROOT, f))).not.toMatch(/newmainimage|gamepagevideo|\/og-image\.jpg|\/main\.png|og-image-drop/);
  });
});

describe("mypage app info", () => {
  it("shows version, maker and contact from businessInfo (no stale team name or old address)", () => {
    const src = fs.readFileSync(path.join(ROOT, "app", "mypage", "page.tsx"), "utf8");
    expect(src).toContain('["제작", BUSINESS_INFO.companyName]');
    expect(src).toContain('["문의", BUSINESS_INFO.customerEmail');
    expect(src).not.toMatch(/hello@dtb\.kr|Drop The Bid Team/);
  });
  it("email login sits above the signup button (reviewer test accounts log in by email)", () => {
    const src = fs.readFileSync(path.join(ROOT, "app", "mypage", "page.tsx"), "utf8");
    expect(src).toContain("이메일로 로그인");
    expect(src.indexOf("이메일로 로그인")).toBeLessThan(src.indexOf('href="/signup"'));
  });
});

describe("live drop chat", () => {
  it("shows no scripted fake-user chat (only real chat, narrator and operator messages)", () => {
    const src = fs.readFileSync(path.join(ROOT, "app", "strategy", "page.tsx"), "utf8");
    expect(src).not.toMatch(/LOUNGE_MESSAGES|RAPID_CHATS|CHAT_EVENTS|lounge-|rapid-/);
    expect(src).not.toMatch(/₩720,000/);
  });
});

describe("no staged records or game framing", () => {
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
  it("results page lists no hardcoded sample drops", () => {
    const src = read("app/results/page.tsx");
    expect(src).toContain("아직 진행된 드랍이 없습니다");
    expect(src).not.toMatch(/RESULTS|participants|winning|레전드|상품권/);
  });
  it("timing practice shows no fabricated leaderboard or percentile claim", () => {
    const src = read("app/mini-game/page.tsx");
    expect(src).not.toMatch(/LEADERBOARD|오늘의 랭킹|상위 10%|살아남습니다/);
  });
  it("consumer copy says 드랍/이용, not 게임/경기/심리전", () => {
    const hits: string[] = [];
    for (const f of consumerSourceFiles(path.join(ROOT, "app"))) {
      fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => {
        if (!isComment(l) && /게임방법|게임 규칙|게임 닉네임|게임에서|경기 시작|경기의|경기 전|심리전|먼저 누른 사람이 임자/.test(l)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

describe("이용방법 slides", () => {
  it("SLIDE_COUNT matches public/설명N.png (old 7-slide set with staged chat is gone)", () => {
    const src = fs.readFileSync(path.join(ROOT, "app", "guide", "page.tsx"), "utf8");
    const n = Number(/const SLIDE_COUNT = (\d+);/.exec(src)?.[1]);
    for (let i = 1; i <= n; i++) expect(fs.existsSync(path.join(ROOT, "public", `설명${i}.png`))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "public", `설명${n + 1}.png`))).toBe(false);
  });
});

describe("구매 체험 (/practice)", () => {
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
  it("has no virtual competitor and no scripted participant chat", () => {
    const src = read("app/practice/page.tsx") + read("app/lib/trainingSim.ts");
    expect(src).not.toMatch(/pickCompetitorClaimPrice|pickScenario|TRAINING_CHAT_EVENTS|한발 늦었습니다|다른 참여자|참가자\d|실전|훈련/);
  });
  it("uses the real default price range and says it runs faster than a real drop", async () => {
    const { TRAINING_CONFIG, calcTrainingPrice } = await import("../app/lib/trainingSim");
    // GameContext pulls in the Supabase client, so read DEFAULT_CONFIG from source.
    const ctx = read("app/context/GameContext.tsx");
    const num = (k: string) => Number(new RegExp(`DEFAULT_CONFIG[\\s\\S]*?${k}:\\s*([\\d_]+)`).exec(ctx)?.[1].replace(/_/g, ""));
    expect(TRAINING_CONFIG.startPrice).toBe(num("startPrice"));
    expect(TRAINING_CONFIG.floorPrice).toBe(num("floorPrice"));
    expect(calcTrainingPrice(10 * 60_000)).toBe(TRAINING_CONFIG.floorPrice);
    expect(calcTrainingPrice(3_700)).toBe(TRAINING_CONFIG.startPrice - 3 * TRAINING_CONFIG.dropAmount);
    const page = read("app/practice/page.tsx");
    expect(page).toContain("실제보다 빠르게");
    expect(page).not.toContain("실제 드랍과 동일하게");
  });
});

describe("드랍 일정 (catalog)", () => {
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
  it("lists at least 3 products, each with a list price and every 상품정보 제공고시 field", async () => {
    const { DROP_CATALOG } = await import("../app/lib/dropCatalog");
    expect(DROP_CATALOG.length).toBeGreaterThanOrEqual(3);
    expect(new Set(DROP_CATALOG.map((p) => p.id)).size).toBe(DROP_CATALOG.length);
    const labels = ["품명 및 모델명", "KC 인증정보", "정격전압·소비전력", "출시년월", "제조자(수입자)", "제조국", "크기·무게", "품질보증기준", "A/S 책임자와 전화번호"];
    for (const p of DROP_CATALOG) {
      expect(p.retailPrice).toBeGreaterThan(0);
      expect(p.notice.map((f) => f.label)).toEqual(labels);
      if (p.image) expect(fs.existsSync(path.join(ROOT, "public", p.image))).toBe(true);
    }
  });
  it("bottom nav shows 드랍 일정 instead of the mini game", () => {
    const nav = read("app/components/BottomNav.tsx");
    expect(nav).toContain('href: "/drops"');
    expect(nav).not.toMatch(/mini-game|미니게임/);
  });
  it("start price is labelled 시작가, and no page hardcodes a 정가", () => {
    for (const f of ["app/page.tsx", "app/strategy/page.tsx", "app/practice/page.tsx", "app/payment/page.tsx", "app/payment/success/page.tsx"]) {
      expect(read(f)).not.toMatch(/정가 \{formatKRW\(start\)\}|정가 \{fmt\(start\)\}|정가 ₩|RETAIL_PRICE/);
    }
  });
});

describe("assets and share copy", () => {
  it("gavel winner video and unused casino/gift-card assets are not served", () => {
    for (const f of ["winner-animation.mp4", "Jackpot.mp3", "baemincoupon.jpg", "Championship1.mp3"]) {
      expect(fs.existsSync(path.join(ROOT, "public", f))).toBe(false);
    }
  });
  it("share / meta copy has no competition framing", () => {
    for (const f of ["app/components/RightActionMenu.tsx", "app/join/layout.tsx", "app/layout.tsx"]) {
      expect(fs.readFileSync(path.join(ROOT, f), "utf8")).not.toMatch(/어디까지 기다리|뺏깁니다|먼저 선택/);
    }
  });
});

describe("service name", () => {
  it("is shown in Korean only (no English 'Drop The Bid' in business info or consumer pages)", () => {
    expect(BUSINESS_INFO.serviceName).toBe("드랍더비드");
    const hits: string[] = [];
    for (const f of consumerSourceFiles(path.join(ROOT, "app"))) {
      fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => {
        if (!isComment(l) && /Drop The Bid/i.test(l)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
