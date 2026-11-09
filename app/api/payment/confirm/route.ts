import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkPaymentDeadline, PAYMENT_WINDOW_EXPIRED } from "../../../lib/paymentWindow";
import { missingShippingFields, shippingFromMetadata, SHIPPING_INFO_REQUIRED } from "../../../lib/shipping";
import { ACTIVE_ATTEMPT_STATUSES, ALREADY_PAID, PAYMENT_CONFIG_ERROR, PAYMENT_IN_PROGRESS } from "../../../lib/paymentCodes";
import { AUTH_REQUIRED, AUTH_SESSION_INVALID } from "../../../lib/confirmWithAuthRecovery";
import { isWinId } from "../../../lib/auctionWin";
import { resolveTossServerConfig } from "../../../lib/tossEnv";
import { paymentSummary } from "../../../lib/tossClient";
import {
  applyVerdict, isRecheckable, markAttempt, recheckReconciliation, refuse, RESPONSE_NEEDS_REVIEW, RESPONSE_UNAVAILABLE,
  settleWithToss, type AuctionWin,
} from "../../../lib/paymentSettle";

// The Toss confirm (30 s) + lookup (10 s) timeouts in app/lib/tossClient.ts
// are sized to finish well inside this, so the route's own error handling
// always runs. 60 s is allowed on every Vercel plan.
export const maxDuration = 60;

const RESPONSE_ALREADY_PAID = () => refuse(ALREADY_PAID, 409);
const RESPONSE_IN_PROGRESS = () => refuse(PAYMENT_IN_PROGRESS, 409);

// Name of the unique constraint/index behind a 23505, from PostgREST's
// message ('duplicate key value violates unique constraint "<name>"'), so
// each duplicate is handled for what it is instead of all 23505s alike.
// null = not a unique violation; "" = a 23505 whose name couldn't be read.
function uniqueViolation(err: { code?: string; message?: string } | null): string | null {
  if (!err || err.code !== "23505") return null;
  return /unique constraint "([^"]+)"/.exec(err.message ?? "")?.[1] ?? "";
}

// payment_reserve_attempt() refusals (raised inside the reserving
// transaction, after it re-checked the win under a row lock).
const RESERVE_REFUSALS: Record<string, () => NextResponse> = {
  "reserve:window_expired": () => refuse(PAYMENT_WINDOW_EXPIRED, 403),
  "reserve:not_winner": () => NextResponse.json({ ok: false, error: "구매자 본인만 결제할 수 있습니다" }, { status: 403 }),
  "reserve:amount_mismatch": () => NextResponse.json({ ok: false, error: "결제 금액이 구매가와 일치하지 않습니다" }, { status: 400 }),
  "reserve:no_win": () => NextResponse.json({ ok: false, error: "구매 정보를 찾을 수 없습니다" }, { status: 400 }),
  "reserve:order_in_use": () => NextResponse.json({ ok: false, error: "이미 사용된 주문번호입니다" }, { status: 409 }),
  "reserve:busy": RESPONSE_IN_PROGRESS,
  "reserve:invalid": () => NextResponse.json({ ok: false, error: "잘못된 결제 요청입니다" }, { status: 400 }),
  "reserve:shipping_required": () => NextResponse.json(
    { ok: false, code: SHIPPING_INFO_REQUIRED, error: "배송지 정보(받는 분, 휴대폰 번호, 주소)를 먼저 등록해주세요." }, { status: 422 }),
};

export async function POST(req: NextRequest) {
  // Keys first: no fallback key exists, and a wrong-mode key (test keys in
  // production, live keys anywhere else) refuses every approval. Only the
  // failed check is logged, never a key.
  const toss = resolveTossServerConfig();
  if (!toss.ok) {
    console.error("[payment/confirm] Toss key configuration refused — no payment is approved", { reason: toss.reason, vercelEnv: toss.vercelEnv });
    return refuse(PAYMENT_CONFIG_ERROR, 503);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnon  = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const supabaseAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let body: { paymentKey?: unknown; orderId?: unknown; amount?: unknown; winId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Missing parameters" }, { status: 400 });
  }
  const { paymentKey, orderId, amount, winId } = body as { paymentKey: string; orderId: string; amount: number; winId?: string | null };

  if (!paymentKey || !orderId || !amount || typeof paymentKey !== "string" || typeof orderId !== "string") {
    return NextResponse.json({ ok: false, error: "Missing parameters" }, { status: 400 });
  }
  // winId (auction_wins.id) is sent by every confirmation started since M1.
  // Optional only for the replay of a legacy (pre-M1) order; when present
  // it must be a UUID. It identifies the win — it is never trusted for
  // who won or what it costs (both re-read from auction_wins below).
  if (winId !== undefined && winId !== null && !isWinId(winId)) {
    return NextResponse.json({ ok: false, error: "잘못된 구매 정보입니다" }, { status: 400 });
  }
  const requestWinId: string | null = winId ?? null;

  // Identity (Phase 3): a Supabase Auth access token is required and is
  // verified against Supabase Auth itself via getUser() — this makes a real
  // request to Auth to check the token, it does not just decode/trust it.
  // Every check below (and every record written) uses this verified user,
  // never a client-supplied id.
  //
  // Both 401s carry a `code` so the client can tell them apart:
  // AUTH_SESSION_INVALID is the one case app/lib/confirmWithAuthRecovery.ts
  // refreshes the session and retries once — safe because this is the first
  // check, so nothing (payment_attempts, reservation, Toss) has happened yet.
  // The log carries only Supabase's error status/code/name — never the
  // access/refresh token, paymentKey or orderId.
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ ok: false, code: AUTH_REQUIRED, error: "인증이 필요합니다" }, { status: 401 });
  }
  const { data: { user }, error: userError } = await supabaseAnon.auth.getUser(token);
  if (userError || !user) {
    console.warn("[payment/confirm] auth rejected", {
      status: (userError as { status?: number } | null)?.status ?? null,
      code: (userError as { code?: string } | null)?.code ?? null,
      name: userError?.name ?? null,
    });
    return NextResponse.json({ ok: false, code: AUTH_SESSION_INVALID, error: "유효하지 않은 인증 정보입니다" }, { status: 401 });
  }

  // payment_attempts is the durable, pre-Toss record of this order_id — it
  // exists BEFORE Toss is ever contacted, and is the single source of truth
  // for idempotency (same order_id, same identity/amount/paymentKey/win =>
  // safe replay; anything else about order_id reuse is rejected before
  // Toss is touched).
  //
  // Checked FIRST, before anything about the current round: a replay of an
  // already-decided attempt is answered from payment_attempts alone, so it
  // keeps working after admin_reset_game() has wiped game_state (refresh of
  // the success page, pending-confirm recovery after re-login, …).
  const { data: existingAttempt, error: attemptLookupError } = await supabaseAdmin
    .from("payment_attempts")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();

  if (attemptLookupError) {
    console.error("[payment/confirm] payment_attempts lookup failed", { orderId, error: attemptLookupError });
    return RESPONSE_UNAVAILABLE();
  }

  if (existingAttempt) {
    // Same request = same user, same amount, same paymentKey, same win.
    // A row with win_id is identified by it (the request must carry that
    // exact winId). A legacy row (win_id null, written before M1 / by the
    // pre-M1 code) is identified the old way — winner_id, which was always
    // the paying user — and only matches a request without a winId.
    const sameWin = existingAttempt.win_id != null
      ? existingAttempt.win_id === requestWinId
      : requestWinId === null;
    const isSameRequest =
      sameWin &&
      existingAttempt.user_id === user.id &&
      existingAttempt.winner_id === user.id &&
      existingAttempt.amount === amount &&
      existingAttempt.payment_key === paymentKey;

    if (!isSameRequest) {
      return NextResponse.json({ ok: false, error: "이미 사용된 주문번호입니다" }, { status: 409 });
    }

    if (existingAttempt.status === "paid") {
      // Toss confirmed it and the order is recorded — a page refresh,
      // back/forward or retry never triggers a second Toss call. Only the
      // summary goes back, never the stored Toss response itself.
      return NextResponse.json({
        ok: true,
        data: paymentSummary(existingAttempt.toss_response as Record<string, unknown> | null, { orderId, amount: existingAttempt.amount }),
      });
    }
    if (existingAttempt.status === "reconciliation_required") {
      // Whatever Toss said, DTB could not finish recording it (unknown
      // outcome, an unexpected state, or the order write failed): neither
      // "paid" nor "failed" can be claimed. An M4-A attempt (it has its
      // paymentKey and Toss Idempotency-Key) is re-checked with a Toss
      // lookup of that paymentKey — see recheckReconciliation(); anything
      // else (legacy row, no key) is left for an operator.
      if (!isRecheckable(existingAttempt)) return RESPONSE_NEEDS_REVIEW();
      const { data: recheckWin, error: recheckWinError } = await supabaseAdmin
        .from("auction_wins")
        .select("id, winner_id, product_name, winning_price, claimed_at, payment_deadline")
        .eq("id", existingAttempt.win_id)
        .maybeSingle();
      if (recheckWinError) {
        console.error("[payment/confirm] auction_wins lookup failed", { orderId, error: recheckWinError });
        return RESPONSE_UNAVAILABLE();
      }
      return recheckReconciliation(supabaseAdmin, toss.secretKey, existingAttempt, recheckWin as AuctionWin | null, user.id);
    }
    if (existingAttempt.status === "pending") {
      // Another request for this exact order is (or was) mid-flight with
      // Toss. Never call Toss a second time for it; a pending attempt is
      // only ever resolved by that request or by an operator (no timeout).
      return RESPONSE_IN_PROGRESS();
    }
    // status is 'failed' (Toss provably did not approve it) — safe to
    // retry; re-reserved below as a new approval of the same attempt.
  }

  // ── Everything from here on is a NEW approval ───────────────────────────
  // The win is the auction_wins row (M1) — the durable record claim_winner()
  // wrote in the same transaction that decided the winner. Its winner_id,
  // winning_price, product_name, claimed_at and payment_deadline are the
  // source of truth; game_state is not consulted (it may already have been
  // reset). A new approval without a winId is refused: since M1 every
  // payment page sends one.
  if (!requestWinId) {
    return NextResponse.json({ ok: false, error: "구매 정보를 찾을 수 없습니다" }, { status: 400 });
  }
  const { data: winRow, error: winLookupError } = await supabaseAdmin
    .from("auction_wins")
    .select("id, winner_id, product_name, winning_price, claimed_at, payment_deadline")
    .eq("id", requestWinId)
    .maybeSingle();
  if (winLookupError) {
    console.error("[payment/confirm] auction_wins lookup failed", { orderId, error: winLookupError });
    return RESPONSE_UNAVAILABLE();
  }
  const win = winRow as AuctionWin | null;
  if (!win) {
    return NextResponse.json({ ok: false, error: "구매 정보를 찾을 수 없습니다" }, { status: 400 });
  }
  if (win.winner_id !== user.id) {
    return NextResponse.json({ ok: false, error: "구매자 본인만 결제할 수 있습니다" }, { status: 403 });
  }
  if (win.winning_price !== amount) {
    return NextResponse.json({ ok: false, error: "결제 금액이 구매가와 일치하지 않습니다" }, { status: 400 });
  }

  // This win's earlier attempt is reconciliation_required (e.g. /mypage ->
  // /payment opened a new payment window, so this request carries a new
  // orderId / paymentKey): no new approval while it is unsettled — that
  // earlier attempt is re-checked with a Toss lookup instead, judged
  // against ITS paymentKey / orderId / amount; nothing of this request's
  // payment is used. Before the deadline check: the attempt was reserved in time,
  // and a Toss answer for it is recorded whenever it arrives. (A legacy
  // attempt without win_id is still refused by the reservation's 23505.)
  const { data: openReview, error: openReviewError } = await supabaseAdmin
    .from("payment_attempts")
    .select("*")
    .eq("win_id", win.id)
    .eq("status", "reconciliation_required")
    .maybeSingle();
  if (openReviewError) {
    console.error("[payment/confirm] payment_attempts lookup failed", { orderId, error: openReviewError });
    return RESPONSE_UNAVAILABLE();
  }
  if (openReview) {
    console.warn("[payment/confirm] win has a reconciliation_required attempt — re-checking it instead of a new approval", {
      orderId, reviewOrderId: openReview.order_id, winId: win.id,
    });
    return recheckReconciliation(supabaseAdmin, toss.secretKey, openReview, win, user.id);
  }

  // Payment deadline, early check (a clear answer before anything is
  // written): DB time (server_now()) against auction_wins.payment_deadline.
  // The binding check is repeated by payment_reserve_attempt() below in the
  // same transaction that reserves the attempt — the policy is "DTB secured
  // the right to call Toss before the deadline"; a Toss answer arriving
  // after it is still recorded normally. A failed clock read fails closed.
  const { data: serverNow, error: serverNowError } = await supabaseAnon.rpc("server_now");
  if (serverNowError) {
    console.error("[payment/confirm] server_now() failed — refusing to approve", { orderId, error: serverNowError });
    return RESPONSE_UNAVAILABLE(503);
  }
  const windowCheck = checkPaymentDeadline(win.payment_deadline, serverNow as string | null);
  if (!windowCheck.ok) {
    console.warn("[payment/confirm] payment deadline check refused approval", {
      orderId, userId: user.id, winId: win.id, reason: windowCheck.reason, elapsedMs: windowCheck.elapsedMs,
    });
    return refuse(PAYMENT_WINDOW_EXPIRED, 403);
  }

  // Shipping info, re-validated server-side for every new approval (the
  // payment page's own check is UX only). Read from the user object
  // getUser() just fetched from Supabase Auth — not from anything the
  // client sent. These exact, normalized values are what the reservation
  // snapshots onto the attempt, and what the order is later built from.
  const shipping = shippingFromMetadata(user.user_metadata);
  const missingShipping = missingShippingFields(shipping);
  if (missingShipping.length > 0) {
    return NextResponse.json(
      { ok: false, code: SHIPPING_INFO_REQUIRED, missing: missingShipping, error: "배송지 정보(받는 분, 휴대폰 번호, 주소)를 먼저 등록해주세요." },
      { status: 422 },
    );
  }

  // ── Reserve this win, atomically, BEFORE Toss ───────────────────────────
  // payment_reserve_attempt() (service_role only) locks the auction_wins
  // row, re-checks winner / price / deadline (DB now()), then inserts the
  // 'pending' attempt — or flips this order's own 'failed' attempt back to
  // 'pending' — with the shipping snapshot and the attempt's Toss
  // Idempotency-Key, all in one transaction. The unique indexes still
  // decide between concurrent requests: payment_attempts_one_active_per_win_id
  // allows one pending/paid/reconciliation_required attempt per win, so
  // exactly one reservation succeeds and the other gets 23505 and never
  // reaches Toss.
  const { data: reserved, error: reserveError } = await supabaseAdmin.rpc("payment_reserve_attempt", {
    p_order_id: orderId,
    p_user_id: user.id,
    p_win_id: win.id,
    p_amount: win.winning_price,
    p_payment_key: paymentKey,
    p_recipient_name: shipping.recipientName,
    p_phone: shipping.phone,
    p_postcode: shipping.postcode,
    p_address: shipping.address,
    p_address_detail: shipping.addressDetail || null,
  });

  if (reserveError) {
    const refusal = RESERVE_REFUSALS[reserveError.message ?? ""];
    if (refusal) return refusal();
    const violated = uniqueViolation(reserveError);
    if (violated === "payment_attempts_pkey") {
      // A concurrent request for this same order_id inserted it first —
      // that request owns it; never call Toss from this one.
      console.warn("[payment/confirm] concurrent reservation of the same order_id — refusing", { orderId, userId: user.id });
      return RESPONSE_IN_PROGRESS();
    }
    if (violated === "payment_attempts_one_active_per_win_id" || violated === "payment_attempts_one_active_per_win") {
      // This win already has an active attempt — report which, never call
      // Toss. Looked up by the key of the index that refused it: win_id for
      // new rows; (winner_id, win_claimed_at) for an attempt the pre-deploy
      // code wrote without win_id.
      const activeQuery = supabaseAdmin.from("payment_attempts").select("status").in("status", [...ACTIVE_ATTEMPT_STATUSES]);
      const { data: active } = await (violated === "payment_attempts_one_active_per_win_id"
        ? activeQuery.eq("win_id", win.id)
        : activeQuery.eq("winner_id", win.winner_id).eq("win_claimed_at", win.claimed_at)
      ).limit(1).maybeSingle();
      console.warn("[payment/confirm] win already has an active payment attempt — refusing new approval", {
        orderId, userId: user.id, winId: win.id, index: violated, activeStatus: active?.status ?? null,
      });
      if (active?.status === "paid") return RESPONSE_ALREADY_PAID();
      if (active?.status === "reconciliation_required") return RESPONSE_NEEDS_REVIEW();
      return RESPONSE_IN_PROGRESS();
    }
    console.error("[payment/confirm] failed to reserve payment_attempts row", { orderId, violated, error: reserveError });
    return RESPONSE_UNAVAILABLE();
  }
  const idempotencyKey = typeof reserved === "string" ? reserved : null;
  if (!idempotencyKey) {
    console.error("[payment/confirm] reservation returned no idempotency key — refusing before Toss", { orderId });
    await markAttempt(supabaseAdmin, orderId, "reconciliation_required", { error_detail: "reserve_no_idempotency_key" });
    return RESPONSE_NEEDS_REVIEW(503);
  }

  // ── Toss: confirm, and when the answer doesn't settle it, look it up ────
  // The attempt is the only source of the values sent: the paymentKey just
  // reserved (equal to the request's), the win's price, the attempt's own
  // idempotency key. Outcomes: see settleWithToss().
  const { verdict, tossError } = await settleWithToss(toss.secretKey, {
    paymentKey, orderId, amount: win.winning_price, idempotencyKey,
  });
  return applyVerdict(supabaseAdmin, verdict, tossError, {
    orderId, paymentKey, amount: win.winning_price, productName: win.product_name, from: "pending",
  });
}
