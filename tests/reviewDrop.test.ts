// Review mode helpers (app/lib/reviewDrop.ts) and the pure price function
// they rely on.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GameConfig } from "../app/context/GameContext";
import { priceAndStageAtElapsed } from "../app/lib/dropPrice";
import { floorReachedAtMs } from "../app/lib/reviewDrop";

const ROOT = path.join(__dirname, "..");
const H = 3600;

// Literal copy of GameContext.tsx's DEFAULT_CONFIG fields that matter here
// (GameContext pulls in the Supabase client, so it is not imported).
const DEFAULT_CONFIG: GameConfig = {
  productName: "Apple iPad Air 11형 Wi-Fi 128GB", startPrice: 899_000, dropAmount: 1_000, floorPrice: 550_000,
  gameStartTime: null, joinLeadMinutes: 30, fastDropPrice: null, fastDropAmount: null, finalDropPrice: null,
  finalDropAmount: null, dropIntervalSeconds: 1, fastDropIntervalSeconds: 1, finalDropIntervalSeconds: 1,
  operatorNickname: "운영자", operatorMessages: [],
};

// The review drop's intended admin settings: ₩1/s stepped every 4 h
// (₩14,400 per step), ₩899,000 -> ₩812,600 (6 steps = 24 h).
const REVIEW: GameConfig = { ...DEFAULT_CONFIG, startPrice: 899_000, floorPrice: 812_600, dropAmount: 1, dropIntervalSeconds: 4 * H };

describe("priceAndStageAtElapsed", () => {
  it("steps every interval and stops at the floor", () => {
    expect(priceAndStageAtElapsed(0, REVIEW).price).toBe(899_000);
    expect(priceAndStageAtElapsed(4 * H - 1, REVIEW).price).toBe(899_000);
    expect(priceAndStageAtElapsed(4 * H, REVIEW).price).toBe(884_600);
    expect(priceAndStageAtElapsed(24 * H, REVIEW).price).toBe(812_600);
    expect(priceAndStageAtElapsed(100 * H, REVIEW).price).toBe(812_600);
  });
});

describe("floorReachedAtMs", () => {
  it("is the first step that lands on the floor, shifted by paused time", () => {
    const t0 = Date.UTC(2026, 10, 20, 0, 0, 0);
    expect(floorReachedAtMs(t0, REVIEW, 0)).toBe(t0 + 24 * H * 1000);
    expect(floorReachedAtMs(t0, REVIEW, 90_000)).toBe(t0 + 24 * H * 1000 + 90_000);
  });
  it("works for the default fast config too", () => {
    const t0 = 1_000_000;
    // ₩1,000/s from 899,000 to 550,000 = 349 s
    expect(floorReachedAtMs(t0, DEFAULT_CONFIG, 0)).toBe(t0 + 349_000);
  });
});

describe("review mode wiring", () => {
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
  it("/join asks am_i_review_account() only during a live round and treats errors as no", () => {
    const src = read("app/join/page.tsx");
    expect(src).toContain('supabase.rpc("am_i_review_account")');
    expect(src).toContain('status !== "game"');
    expect(src).toContain("!error && data === true");
  });
  it("home shows 상시 참여 가능 for a live round in review mode", () => {
    const src = read("app/page.tsx");
    expect(src).toContain("REVIEW_DROP_MODE && auctionLive");
    expect(src).toContain("상시 참여 가능");
  });
});

describe("live product -> detail page link", () => {
  it("catalogItemByName matches the admin product name exactly", async () => {
    const { catalogItemByName } = await import("../app/lib/dropCatalog");
    expect(catalogItemByName("Apple iPad Air 11형 Wi-Fi 128GB")?.id).toBe("ipad-air-11");
    expect(catalogItemByName("  Apple iPad Air 11형 Wi-Fi 128GB ")?.id).toBe("ipad-air-11");
    expect(catalogItemByName("없는 상품")).toBeUndefined();
    expect(catalogItemByName("")).toBeUndefined();
  });
  it("the live screen opens the detail page in a new tab; home links it too", () => {
    const strat = fs.readFileSync(path.join(ROOT, "app/strategy/page.tsx"), "utf8");
    expect(strat).toMatch(/href=\{`\/drops\/\$\{catalogItem\.id\}`\} target="_blank"/);
    expect(fs.readFileSync(path.join(ROOT, "app/page.tsx"), "utf8")).toContain("/drops/${todayItem.id}");
  });
});
