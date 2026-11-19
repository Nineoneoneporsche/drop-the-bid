import type { DropStage, GameConfig } from "../context/GameContext";

// The pure part of calcPriceAndStage(): price/stage after rawElapsed
// seconds of (unpaused) game time. No React / Supabase, so it is shared by
// GameContext.tsx and app/lib/reviewDrop.ts and can be unit-tested.
export function priceAndStageAtElapsed(
  rawElapsed: number,
  config: GameConfig
): { price: number; stage: DropStage } {
  const {
    startPrice, floorPrice, dropAmount, fastDropPrice, fastDropAmount, finalDropPrice, finalDropAmount,
    dropIntervalSeconds, fastDropIntervalSeconds, finalDropIntervalSeconds,
  } = config;
  const normalInterval = dropIntervalSeconds > 0 ? dropIntervalSeconds : 1;
  const fastInterval    = fastDropIntervalSeconds > 0 ? fastDropIntervalSeconds : 1;
  const finalInterval   = finalDropIntervalSeconds > 0 ? finalDropIntervalSeconds : 1;
  const step = (t: number, interval: number) => Math.floor(t / interval) * interval;

  if (fastDropPrice == null || fastDropAmount == null) {
    const stepped = step(rawElapsed, normalInterval);
    return { price: Math.max(floorPrice, Math.round(startPrice - stepped * dropAmount)), stage: "normal" };
  }

  const tFast = (startPrice - fastDropPrice) / dropAmount;
  if (rawElapsed <= tFast) {
    const stepped = step(rawElapsed, normalInterval);
    return { price: Math.round(startPrice - stepped * dropAmount), stage: "normal" };
  }

  const fastElapsed = rawElapsed - tFast;

  if (finalDropPrice == null || finalDropAmount == null) {
    const stepped = step(fastElapsed, fastInterval);
    return {
      price: Math.max(floorPrice, Math.round(fastDropPrice - stepped * fastDropAmount)),
      stage: "fast",
    };
  }

  const tFinal = (fastDropPrice - finalDropPrice) / fastDropAmount;
  if (fastElapsed <= tFinal) {
    const stepped = step(fastElapsed, fastInterval);
    return { price: Math.round(fastDropPrice - stepped * fastDropAmount), stage: "fast" };
  }

  const finalElapsed = fastElapsed - tFinal;
  const stepped = step(finalElapsed, finalInterval);
  return {
    price: Math.max(floorPrice, Math.round(finalDropPrice - stepped * finalDropAmount)),
    stage: "final",
  };
}
