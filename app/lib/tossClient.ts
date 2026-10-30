// Server-only Toss Payments client (M4-A): payment confirm and lookup with a
// bounded timeout, Idempotency-Key on the confirm POST, a parsed / validated
// Payment, and the classification that decides what a Toss answer means for
// a DTB payment attempt. Never logs; callers log only what they pass in
// (and never the secret key or Authorization header).

export const TOSS_API_BASE = "https://api.tosspayments.com";

// Timeouts. The confirm route exports maxDuration = 60 (s), valid on every
// Vercel plan; in the worst case one request spends the confirm timeout plus
// the lookup timeout plus a few short DB round trips (< 45 s), well under
// that, so the route's own error handling always runs (a function killed by
// the platform would leave the attempt 'pending' with no diagnosis). 30 s is
// far above a normal approval (a few seconds) so a slow-but-successful
// approval isn't cut off; and a timeout no longer means "failed" — it goes
// to the lookup below, so cutting it short costs a lookup, not a payment.
export const TOSS_CONFIRM_TIMEOUT_MS = 30_000;
export const TOSS_LOOKUP_TIMEOUT_MS = 10_000;

// Payment methods the CARD 통합결제창 can complete with (Payment.method).
export const ALLOWED_METHODS = ["카드", "간편결제"] as const;

export type TossPayment = {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
  currency: string;
  method: string | null;
  approvedAt: string | null;
  orderName: string | null;
  raw: Record<string, unknown>;
};

export type TossCallResult =
  | { kind: "payment"; httpStatus: number; payment: TossPayment }
  | { kind: "error"; httpStatus: number; code: string; message: string | null }
  | { kind: "unknown"; reason: "network" | "timeout" | "unreadable_body" | "unexpected_body"; httpStatus: number | null };

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function parseTossPayment(json: unknown): TossPayment | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const r = json as Record<string, unknown>;
  if (typeof r.paymentKey !== "string" || typeof r.orderId !== "string" || typeof r.status !== "string"
      || typeof r.totalAmount !== "number" || !Number.isFinite(r.totalAmount) || typeof r.currency !== "string") {
    return null;
  }
  return {
    paymentKey: r.paymentKey, orderId: r.orderId, status: r.status, totalAmount: r.totalAmount, currency: r.currency,
    method: str(r.method), approvedAt: str(r.approvedAt), orderName: str(r.orderName), raw: r,
  };
}

const basicAuth = (secretKey: string) => `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;

async function call(
  method: "GET" | "POST",
  path: string,
  opts: { secretKey: string; timeoutMs: number; idempotencyKey?: string; body?: unknown },
): Promise<TossCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const aborted = (e: unknown) =>
    controller.signal.aborted || (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"));
  try {
    const headers: Record<string, string> = { Authorization: basicAuth(opts.secretKey) };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    let res: Response;
    try {
      res = await fetch(`${TOSS_API_BASE}${path}`, {
        method, headers, signal: controller.signal,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
    } catch (e) {
      return { kind: "unknown", reason: aborted(e) ? "timeout" : "network", httpStatus: null };
    }
    let json: unknown;
    try {
      json = JSON.parse(await res.text());
    } catch (e) {
      return { kind: "unknown", reason: aborted(e) ? "timeout" : "unreadable_body", httpStatus: res.status };
    }
    if (res.ok) {
      const payment = parseTossPayment(json);
      return payment ? { kind: "payment", httpStatus: res.status, payment } : { kind: "unknown", reason: "unexpected_body", httpStatus: res.status };
    }
    const code = json && typeof json === "object" ? str((json as Record<string, unknown>).code) : null;
    if (!code) return { kind: "unknown", reason: "unexpected_body", httpStatus: res.status };
    return { kind: "error", httpStatus: res.status, code, message: str((json as Record<string, unknown>).message) };
  } finally {
    clearTimeout(timer);
  }
}

// POST /v1/payments/confirm. idempotencyKey is the attempt's stored key
// (payment_attempts.toss_idempotency_key) — the same on every retry of the
// attempt, so a retry after a lost response gets Toss's first answer back
// instead of a second approval / ALREADY_PROCESSED_PAYMENT.
export function confirmTossPayment(p: {
  secretKey: string; paymentKey: string; orderId: string; amount: number; idempotencyKey: string; timeoutMs?: number;
}): Promise<TossCallResult> {
  return call("POST", "/v1/payments/confirm", {
    secretKey: p.secretKey, timeoutMs: p.timeoutMs ?? TOSS_CONFIRM_TIMEOUT_MS, idempotencyKey: p.idempotencyKey,
    body: { paymentKey: p.paymentKey, orderId: p.orderId, amount: p.amount },
  });
}

// GET /v1/payments/{paymentKey}. The paymentKey must come from the DTB
// attempt row, never straight from a request.
export function getTossPayment(p: { secretKey: string; paymentKey: string; timeoutMs?: number }): Promise<TossCallResult> {
  return call("GET", `/v1/payments/${encodeURIComponent(p.paymentKey)}`, {
    secretKey: p.secretKey, timeoutMs: p.timeoutMs ?? TOSS_LOOKUP_TIMEOUT_MS,
  });
}

// ── Classification ─────────────────────────────────────────────────────────
// Confirm errors that mean "Toss did NOT approve this payment" — explicit
// rejections by the card company / payment method / limits, or a request
// Toss refused before processing it. Only these make an attempt 'failed'.
// Anything else (5xx, 408, 429, the codes in AMBIGUOUS_CONFIRM_CODES, any
// code not listed here) is not proof of a non-approval: it goes to the
// lookup, and stays reconciliation_required if that doesn't settle it.
export const DECLINE_CODES: ReadonlySet<string> = new Set([
  "REJECT_CARD_PAYMENT", "REJECT_CARD_COMPANY", "REJECT_ACCOUNT_PAYMENT", "REJECT_TOSSPAY_INVALID_ACCOUNT",
  "INVALID_REJECT_CARD", "INVALID_STOPPED_CARD", "INVALID_CARD_LOST_OR_STOLEN", "INVALID_CARD_EXPIRATION",
  "INVALID_CARD_NUMBER", "INVALID_PASSWORD", "EXCEED_MAX_AUTH_COUNT", "EXCEED_MAX_DAILY_PAYMENT_COUNT",
  "EXCEED_MAX_PAYMENT_AMOUNT", "EXCEED_MAX_AMOUNT", "EXCEED_MAX_ONE_DAY_AMOUNT", "EXCEED_MAX_MONTHLY_PAYMENT_AMOUNT",
  "EXCEED_MAX_ONE_DAY_WITHDRAW_AMOUNT", "EXCEED_MAX_ONE_TIME_WITHDRAW_AMOUNT", "EXCEED_MAX_CARD_INSTALLMENT_PLAN",
  "NOT_SUPPORTED_INSTALLMENT_PLAN_CARD_OR_MERCHANT", "INVALID_CARD_INSTALLMENT_PLAN", "NOT_SUPPORTED_MONTHLY_INSTALLMENT_PLAN",
  "NOT_ALLOWED_POINT_USE", "BELOW_MINIMUM_AMOUNT", "RESTRICTED_TRANSFER_ACCOUNT", "INVALID_ACCOUNT_INFO_RE_REGISTER",
  "NOT_AVAILABLE_BANK", "NOT_AVAILABLE_PAYMENT", "FDS_ERROR",
  "INVALID_REQUEST", "INVALID_AUTHORIZE_AUTH", "FORBIDDEN_REQUEST",
]);
// Our own key / merchant setup is wrong: rejected before processing.
export const CONFIG_ERROR_CODES: ReadonlySet<string> = new Set([
  "UNAUTHORIZED_KEY", "INVALID_API_KEY", "INCORRECT_BASIC_AUTH_FORMAT", "INVALID_IDEMPOTENCY_KEY",
  "NOT_FOUND_TERMINAL_ID", "INVALID_UNREGISTERED_SUBMALL", "NOT_REGISTERED_BUSINESS",
]);
// Documented on purpose (the default for an unlisted code is the same):
// the payment may already be approved, or its state is unknown.
export const AMBIGUOUS_CONFIRM_CODES: ReadonlySet<string> = new Set([
  "ALREADY_PROCESSED_PAYMENT", "ALREADY_PROCESSING_REQUEST", "IDEMPOTENT_REQUEST_PROCESSING",
  "PROVIDER_ERROR", "CARD_PROCESSING_ERROR", "UNAPPROVED_ORDER_ID",
  "NOT_FOUND_PAYMENT", "NOT_FOUND_PAYMENT_SESSION",
  "FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING", "FAILED_INTERNAL_SYSTEM_PROCESSING",
  "FAILED_CARD_COMPANY_RESPONSE", "UNKNOWN_PAYMENT_ERROR",
]);

export type ExpectedPayment = { paymentKey: string; orderId: string; amount: number };
export type NotApprovedCode = "PAYMENT_DECLINED" | "PAYMENT_AUTH_EXPIRED" | "PAYMENT_CONFIG_ERROR";

export type PaymentVerdict =
  | { verdict: "done"; payment: TossPayment }
  | { verdict: "not_approved"; userCode: NotApprovedCode; detail: string; payment?: TossPayment }
  | { verdict: "review"; detail: string; payment?: TossPayment }
  | { verdict: "ambiguous"; detail: string };

// Field names (never values) that differ from the DTB attempt.
export function identityMismatch(p: TossPayment, exp: ExpectedPayment): string[] {
  const bad: string[] = [];
  if (p.paymentKey !== exp.paymentKey) bad.push("paymentKey");
  if (p.orderId !== exp.orderId) bad.push("orderId");
  if (p.totalAmount !== exp.amount) bad.push("totalAmount");
  if (p.currency !== "KRW") bad.push("currency");
  return bad;
}

function judgePayment(p: TossPayment, exp: ExpectedPayment, source: "confirm" | "lookup"): PaymentVerdict {
  const bad = identityMismatch(p, exp);
  if (bad.length > 0) return { verdict: "review", detail: `${source}_identity_mismatch:${bad.join(",")}`, payment: p };
  if (p.status === "DONE") {
    if (!p.method || !(ALLOWED_METHODS as readonly string[]).includes(p.method)) {
      return { verdict: "review", detail: `${source}_unexpected_method`, payment: p };
    }
    return { verdict: "done", payment: p };
  }
  if (source === "lookup" && p.status === "ABORTED") return { verdict: "not_approved", userCode: "PAYMENT_DECLINED", detail: "lookup_status:ABORTED", payment: p };
  if (source === "lookup" && p.status === "EXPIRED") return { verdict: "not_approved", userCode: "PAYMENT_AUTH_EXPIRED", detail: "lookup_status:EXPIRED", payment: p };
  // READY / IN_PROGRESS / WAITING_FOR_DEPOSIT / CANCELED / PARTIAL_CANCELED /
  // anything new: not paid, not provably unpaid either.
  return { verdict: "review", detail: `${source}_status:${p.status}`, payment: p };
}

export function classifyConfirm(r: TossCallResult, exp: ExpectedPayment): PaymentVerdict {
  if (r.kind === "payment") return judgePayment(r.payment, exp, "confirm");
  if (r.kind === "unknown") return { verdict: "ambiguous", detail: `confirm_${r.reason}${r.httpStatus ? `:${r.httpStatus}` : ""}` };
  const detail = `confirm_http_${r.httpStatus}:${r.code}`;
  const definitiveStatus = r.httpStatus >= 400 && r.httpStatus < 500 && r.httpStatus !== 408 && r.httpStatus !== 429;
  if (definitiveStatus && DECLINE_CODES.has(r.code)) return { verdict: "not_approved", userCode: "PAYMENT_DECLINED", detail };
  if (definitiveStatus && CONFIG_ERROR_CODES.has(r.code)) return { verdict: "not_approved", userCode: "PAYMENT_CONFIG_ERROR", detail };
  return { verdict: "ambiguous", detail };
}

// The lookup settles it or leaves it for an operator — never ambiguous.
// A 404 is NOT proof of "no payment" (a test key asking about a live
// payment gets one too), so it is reviewed, not failed.
export function classifyLookup(r: TossCallResult, exp: ExpectedPayment): Exclude<PaymentVerdict, { verdict: "ambiguous" }> {
  if (r.kind === "payment") return judgePayment(r.payment, exp, "lookup") as Exclude<PaymentVerdict, { verdict: "ambiguous" }>;
  if (r.kind === "unknown") return { verdict: "review", detail: `lookup_${r.reason}${r.httpStatus ? `:${r.httpStatus}` : ""}` };
  return { verdict: "review", detail: `lookup_http_${r.httpStatus}:${r.code}` };
}

// ── What is stored / returned ──────────────────────────────────────────────
// Stored on payment_attempts.toss_response for new attempts: what operating
// the payment needs, nothing else — no card object, no Payment.secret, no
// checkout / receipt URLs, no customer fields.
export function storedTossPayment(p: TossPayment): Record<string, unknown> {
  const r = p.raw;
  const easyPay = r.easyPay && typeof r.easyPay === "object" ? (r.easyPay as Record<string, unknown>) : null;
  return {
    orderId: p.orderId, orderName: p.orderName, status: p.status, method: p.method,
    totalAmount: p.totalAmount, balanceAmount: typeof r.balanceAmount === "number" ? r.balanceAmount : null,
    currency: p.currency, type: str(r.type), requestedAt: str(r.requestedAt), approvedAt: p.approvedAt,
    lastTransactionKey: str(r.lastTransactionKey), easyPayProvider: easyPay ? str(easyPay.provider) : null,
  };
}

export function storedTossError(r: TossCallResult): Record<string, unknown> | null {
  if (r.kind !== "error") return null;
  return { httpStatus: r.httpStatus, code: r.code, message: r.message ? r.message.slice(0, 300) : null };
}

// The only payment fields the browser ever gets back. Works on a stored
// response of either shape (sanitized, or a full Toss object stored before
// M4-A) — the extra fields of the latter are dropped here.
export type PaymentSummary = { orderId: string; totalAmount: number; method: string | null; approvedAt: string | null; orderName: string | null };
export function paymentSummary(src: Record<string, unknown> | null | undefined, fallback: { orderId: string; amount: number; orderName?: string | null }): PaymentSummary {
  const s = src ?? {};
  return {
    orderId: str(s.orderId) ?? fallback.orderId,
    totalAmount: typeof s.totalAmount === "number" ? s.totalAmount : fallback.amount,
    method: str(s.method),
    approvedAt: str(s.approvedAt),
    orderName: fallback.orderName ?? str(s.orderName),
  };
}

// Logs never carry a paymentKey in full.
export function maskPaymentKey(key: string): string {
  if (key.length <= 10) return "***";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}
