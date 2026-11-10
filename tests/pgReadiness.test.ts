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
  it("legal texts use 드랍/구매 wording only", () => {
    for (const t of [TERMS_OF_SERVICE, PRIVACY_POLICY, REFUND_POLICY, MARKETING_CONSENT]) expect(t).not.toMatch(AUCTION_WORDS);
  });
});

describe("legal texts", () => {
  it("terms define 드랍 as a sale and state participation is free", () => {
    expect(TERMS_OF_SERVICE).toContain('"드랍"이란');
    expect(TERMS_OF_SERVICE).toContain("한정 판매");
    expect(TERMS_OF_SERVICE).toContain("드랍 참여, 관전, 채팅, 모의훈련은 무료입니다");
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
  });
  it("privacy policy names the processors and the privacy officer", () => {
    for (const s of ["토스페이먼츠", "Supabase", "Vercel", "Cloudflare", "국외 이전", BUSINESS_INFO.privacyOfficer]) expect(PRIVACY_POLICY).toContain(s);
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
    expect(read("app/page.tsx")).toContain('src="/main.png"');
    expect(read("app/components/StageBackdrop.tsx")).toContain('src="/main.png"');
    for (const f of ["app/layout.tsx", "app/join/layout.tsx"]) expect(read(f)).toContain("/og-image-drop.jpg");
    for (const p of ["public/main.png", "public/og-image-drop.jpg"]) expect(fs.existsSync(path.join(ROOT, p))).toBe(true);
    for (const p of ["public/newmainimage.png", "public/gamepagevideo.mp4", "public/og-image.jpg"]) expect(fs.existsSync(path.join(ROOT, p))).toBe(false);
    for (const f of consumerSourceFiles(path.join(ROOT, "app"))) expect(read(path.relative(ROOT, f))).not.toMatch(/newmainimage|gamepagevideo|\/og-image\.jpg/);
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
