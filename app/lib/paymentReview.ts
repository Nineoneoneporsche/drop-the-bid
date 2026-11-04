// What /mypage shows after "결제 상태 확인" (POST /api/payment/recheck).
// Pure, so it can be unit-tested; the texts are ours only — nothing from
// Toss reaches the page.
export type ReviewItem = {
  orderId: string;
  productName: string | null;
  amount: number;
  createdAt: string | null;
  lastCheckedAt: string | null;
};

export type ReviewResult = { tone: "done" | "failed" | "pending"; text: string; settled: boolean };

export const REVIEW_STILL_UNKNOWN = "아직 결제 상태를 확인할 수 없습니다. 다시 결제하지 마시고, 잠시 후 다시 확인하거나 고객센터로 문의해주세요.";

export function reviewResult(r: { ok?: unknown; status?: unknown } | null): ReviewResult {
  if (r?.ok === true && r.status === "paid") {
    return { tone: "done", text: "결제가 완료되었습니다. 낙찰 내역에서 확인할 수 있습니다.", settled: true };
  }
  if (r?.ok === true && r.status === "failed") {
    return { tone: "failed", text: "결제가 승인되지 않아 취소 처리되었습니다. 청구되지 않았습니다.", settled: true };
  }
  return { tone: "pending", text: REVIEW_STILL_UNKNOWN, settled: false };
}
