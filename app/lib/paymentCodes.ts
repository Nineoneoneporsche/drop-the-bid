// Machine-readable `code`s /api/payment/confirm returns, and the only text
// the user ever sees for them. Toss's own error code / message never
// reaches the browser — it stays in the server log and in
// payment_attempts (toss_response / error_detail) for an operator.
// app/payment/success/page.tsx keys off the codes, not the message text.
import { PAYMENT_WINDOW_EXPIRED, WINNER_PAYMENT_WINDOW_MINUTES } from "./paymentWindow";

export const ALREADY_PAID = "PAYMENT_ALREADY_PAID";
export const PAYMENT_IN_PROGRESS = "PAYMENT_PROCESSING";
export const PAYMENT_NEEDS_REVIEW = "PAYMENT_NEEDS_REVIEW";
export const PAYMENT_DECLINED = "PAYMENT_DECLINED";
export const PAYMENT_AUTH_EXPIRED = "PAYMENT_AUTH_EXPIRED";
export const PAYMENT_SYSTEM_UNAVAILABLE = "PAYMENT_SYSTEM_UNAVAILABLE";
export const PAYMENT_CONFIG_ERROR = "PAYMENT_CONFIG_ERROR";

export const PAYMENT_MESSAGES: Record<string, string> = {
  [ALREADY_PAID]: "이미 결제가 완료된 낙찰입니다.",
  [PAYMENT_IN_PROGRESS]: "이 낙찰의 결제가 이미 처리 중입니다. 잠시 후 주문 내역을 확인해주세요.",
  [PAYMENT_NEEDS_REVIEW]: "결제 결과를 확인 중입니다. 다시 결제하지 마시고, 잠시 후 주문 내역을 확인하거나 고객센터로 문의해주세요.",
  [PAYMENT_DECLINED]: "결제가 승인되지 않았습니다. 청구되지 않았으며, 다른 결제수단으로 다시 결제할 수 있습니다.",
  [PAYMENT_AUTH_EXPIRED]: "결제 인증 시간이 만료되어 결제가 승인되지 않았습니다. 청구되지 않았으며, 결제 페이지에서 다시 결제해주세요.",
  [PAYMENT_SYSTEM_UNAVAILABLE]: "결제 확인 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
  [PAYMENT_CONFIG_ERROR]: "결제 시스템 설정 오류로 결제를 진행할 수 없습니다. 운영자에게 문의해주세요.",
  [PAYMENT_WINDOW_EXPIRED]: `결제 가능 시간(낙찰 후 ${WINNER_PAYMENT_WINDOW_MINUTES}분)이 지나 결제를 승인할 수 없습니다.`,
};

// Statuses covered by the one-active-attempt-per-win unique index.
export const ACTIVE_ATTEMPT_STATUSES = ["pending", "paid", "reconciliation_required"] as const;
