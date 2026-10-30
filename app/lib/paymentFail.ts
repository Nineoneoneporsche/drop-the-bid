// /payment/fail screens. Toss redirects there (failUrl) with
// ?code=…&message=… when the payment window was closed or the payment
// failed BEFORE our server ever confirmed it — nothing was approved or
// charged. The URL is attacker-editable, so its `message` is never shown: a
// known `code` picks one of our texts, any other code gets the generic one,
// and only a known code is displayed.
export type FailScreen = { cancel: boolean; title: string; body: string };
const FAIL_SCREENS: Record<string, FailScreen> = {
  PAY_PROCESS_CANCELED: { cancel: true, title: "결제가 취소되었습니다.", body: "결제창을 닫아 결제가 진행되지 않았습니다. 청구되지 않았습니다." },
  USER_CANCEL: { cancel: true, title: "결제가 취소되었습니다.", body: "결제창을 닫아 결제가 진행되지 않았습니다. 청구되지 않았습니다." },
  PAY_PROCESS_ABORTED: { cancel: false, title: "결제가 진행되지 않았습니다.", body: "결제 진행 중 문제가 발생해 결제가 승인되지 않았습니다. 청구되지 않았으며, 다시 시도할 수 있습니다." },
  REJECT_CARD_COMPANY: { cancel: false, title: "카드사에서 결제를 승인하지 않았습니다.", body: "청구되지 않았습니다. 다른 카드나 결제수단으로 다시 시도해주세요." },
};
const GENERIC: FailScreen = { cancel: false, title: "결제에 실패했습니다.", body: "결제가 완료되지 않았습니다. 청구되지 않았으며, 다시 시도할 수 있습니다." };

export function failScreenFor(code: string): FailScreen & { shownCode: string | null } {
  const known = Object.prototype.hasOwnProperty.call(FAIL_SCREENS, code) ? FAIL_SCREENS[code] : null;
  return { ...(known ?? GENERIC), shownCode: known ? code : null };
}
