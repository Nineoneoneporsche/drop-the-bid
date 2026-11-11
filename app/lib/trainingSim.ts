// 구매 체험 (/practice) price simulation — entirely local, no coupling to
// production config/state (see app/practice/page.tsx).
//
// The price range is a literal snapshot of GameContext.tsx's DEFAULT_CONFIG
// (start ₩899,000 → floor ₩550,000, one linear zone), deliberately NOT
// imported so this file stays auditable as independent of production
// config. Only the speed differs: the real default drops ₩1,000/s, which
// would take minutes, so the experience runs faster — and the page says so.
// There is no virtual competitor: the experience teaches how to buy, not how
// to beat other people to the button.

import { WINNER_PAYMENT_WINDOW_MINUTES } from "./paymentWindow";

export interface TrainingConfig {
  productName: string;
  startPrice: number;
  floorPrice: number;
  dropAmount: number; // ₩/sec (real default: ₩1,000/sec)
}

export const TRAINING_CONFIG: TrainingConfig = {
  productName: "Apple iPad Air 11형 Wi-Fi 128GB",
  startPrice: 899_000,
  floorPrice: 550_000,
  dropAmount: 14_000,
};

export function calcTrainingPrice(elapsedMs: number, cfg: TrainingConfig = TRAINING_CONFIG): number {
  // Whole seconds only, like the real drop's stepped price — so the price is
  // always a clean multiple of dropAmount, never ₩772,762.
  const steps = Math.floor(Math.max(0, elapsedMs) / 1000);
  return Math.max(cfg.floorPrice, cfg.startPrice - steps * cfg.dropAmount);
}

// Seconds from start to floor at the experience's speed.
export function trainingDurationSec(cfg: TrainingConfig = TRAINING_CONFIG): number {
  return Math.ceil((cfg.startPrice - cfg.floorPrice) / cfg.dropAmount);
}

// Guide lines on a fixed schedule — the service explaining itself, not
// scripted "other participants".
export const TRAINING_GUIDE_EVENTS: { atSec: number; message: string }[] = [
  { atSec: 2, message: "가격이 내려가고 있습니다. 지금 가격은 구매하기 버튼에 표시됩니다." },
  { atSec: 7, message: "원하는 가격이 되면 구매하기를 누르세요." },
  { atSec: 13, message: `실제 드랍에서는 구매가 확정되면 ${WINNER_PAYMENT_WINDOW_MINUTES}분 안에 결제합니다.` },
];
