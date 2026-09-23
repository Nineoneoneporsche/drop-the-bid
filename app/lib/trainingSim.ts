// Training Mode's own price-drop + competitor simulation — entirely local,
// no coupling to production config/state (see app/practice/page.tsx). Deliberately
// duplicates the *shape* of calcPriceAndStage() in app/context/GameContext.tsx
// (NORMAL → FAST → FINAL zones) so the visual staging (DROP ZONE transitions)
// matches the real auction, but every number here is training-only and must
// never be derived from GameContext/game_state.

export type TrainingDropStage = "normal" | "fast" | "final";

export interface TrainingConfig {
  productName: string;
  startPrice: number;
  floorPrice: number;
  dropAmount: number;      // NORMAL zone, ₩/sec
  fastDropPrice: number;   // FAST zone starts once price reaches this
  fastDropAmount: number;  // FAST zone, ₩/sec
  finalDropPrice: number;  // FINAL zone starts once price reaches this
  finalDropAmount: number; // FINAL zone, ₩/sec
}

// Product name copied as a literal string from GameContext.tsx's
// DEFAULT_CONFIG.productName (as of writing) — a one-time snapshot, not a
// live reference. Deliberately NOT imported from GameContext: this file
// must stay readable/auditable as fully independent of production config,
// and this name will not follow the real product if an admin changes it.
export const TRAINING_CONFIG: TrainingConfig = {
  productName: "Apple iPad Air 11형 Wi-Fi 128GB",
  startPrice: 500_000,
  floorPrice: 200_000,
  dropAmount: 5_000,
  fastDropPrice: 380_000,
  fastDropAmount: 5_000,
  finalDropPrice: 280_000,
  finalDropAmount: 8_000,
};

export function calcTrainingPriceAndStage(
  elapsedMs: number,
  cfg: TrainingConfig = TRAINING_CONFIG
): { price: number; stage: TrainingDropStage } {
  const elapsed = Math.max(0, elapsedMs / 1000);
  const { startPrice, floorPrice, dropAmount, fastDropPrice, fastDropAmount, finalDropPrice, finalDropAmount } = cfg;

  const tFast = (startPrice - fastDropPrice) / dropAmount;
  if (elapsed <= tFast) {
    return { price: Math.round(startPrice - elapsed * dropAmount), stage: "normal" };
  }

  const fastElapsed = elapsed - tFast;
  const tFinal = (fastDropPrice - finalDropPrice) / fastDropAmount;
  if (fastElapsed <= tFinal) {
    return { price: Math.round(fastDropPrice - fastElapsed * fastDropAmount), stage: "fast" };
  }

  const finalElapsed = fastElapsed - tFinal;
  return {
    price: Math.max(floorPrice, Math.round(finalDropPrice - finalElapsed * finalDropAmount)),
    stage: "final",
  };
}

// Three fixed scenarios instead of one continuous random range, so a run is
// simple to reason about/test — one is picked once, at training start.
export type CompetitorScenario = "early" | "normal" | "late";

const SCENARIOS: CompetitorScenario[] = ["early", "normal", "late"];

export function pickScenario(): CompetitorScenario {
  return SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
}

// The price range the virtual competitor claims within — one scenario is
// picked once per round (pickScenario above), then the exact claim price is
// randomized within that scenario's range so repeated rounds don't land on
// the same number, while each range still stays inside a single zone (so
// all three DROP ZONE stages stay reachable depending on the scenario).
export const COMPETITOR_CLAIM_RANGE: Record<CompetitorScenario, [number, number]> = {
  early: [400_000, 460_000],  // NORMAL zone
  normal: [300_000, 365_000], // FAST zone
  late: [210_000, 270_000],   // FINAL zone
};

// Picked once at training start and reused for the whole round — never
// re-rolled mid-round.
export function pickCompetitorClaimPrice(scenario: CompetitorScenario): number {
  const [min, max] = COMPETITOR_CLAIM_RANGE[scenario];
  const raw = min + Math.random() * (max - min);
  return Math.round(raw / 1_000) * 1_000; // clean 1,000-won increments
}

// Scripted chat — fires on a fixed elapsed-time schedule (not price
// thresholds) so lines show up quickly and predictably regardless of which
// competitor scenario is picked — a price-% threshold could take 15+
// seconds to cross in the "early" scenario, which read as "chat never
// shows up." Short, plausible live-auction reactions, kept to a handful of
// lines (not a continuous filler stream).
export const TRAINING_CHAT_EVENTS: { atSec: number; nickname: string; message: string }[] = [
  { atSec: 2, nickname: "참가자1", message: "아직 아무도 안 눌렀네요" },
  { atSec: 4, nickname: "참가자2", message: "조금 더 기다려볼까..." },
  { atSec: 6, nickname: "참가자3", message: "이제 슬슬 눌러야 하나" },
];
