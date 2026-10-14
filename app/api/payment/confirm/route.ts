import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkPaymentWindow, PAYMENT_WINDOW_EXPIRED, WINNER_PAYMENT_WINDOW_MINUTES } from "../../../lib/paymentWindow";
import { missingShippingFields, shippingFromMetadata, SHIPPING_INFO_REQUIRED } from "../../../lib/shipping";
import { ACTIVE_ATTEMPT_STATUSES, ALREADY_PAID, PAYMENT_IN_PROGRESS, PAYMENT_NEEDS_REVIEW } from "../../../lib/paymentCodes";
import { AUTH_REQUIRED, AUTH_SESSION_INVALID } from "../../../lib/confirmWithAuthRecovery";

// Sandbox fallback only outside production — a missing env var in an
// actual production deploy must fail loudly (every payment rejected with a
// clear 500) rather than silently routing real users' charges through
// Toss's test/sandbox endpoint, which either doesn't move money at all or
// gets rejected by Toss for the production domain — both fail silently
// enough that it could go unnoticed for a while. `next dev`/local
// `next build && next start` still get the sandbox key with no setup.
const TOSS_SECRET_KEY: string | undefined =
  process.env.NODE_ENV === "production"
    ? process.env.TOSS_SECRET_KEY
    : (process.env.TOSS_SECRET_KEY ?? "test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R");

// Never let a paymentKey reach the logs in full — it's an opaque Toss
// token, not a secret in the same class as our own API keys, but there's
// no reason to leave a full copy sitting in whatever log aggregator this
// ends up in either. Masked, not removed — still useful for correlating
// log lines by eye.
function maskPaymentKey(key: string): string {
  if (key.length <= 10) return "***";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

// Toss's error object is not something we hand to the client as-is — it's
// meant for our own diagnostics (logged in full server-side, see below).
// The client gets just the message string, which is written to be
// user-displayable, with a safe generic fallback if that shape ever changes.
function safeTossErrorMessage(data: unknown): string {
  if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") {
    return (data as { message: string }).message;
  }
  return "결제 확인에 실패했습니다.";
}

const RESPONSE_ALREADY_PAID = () => NextResponse.json(
  { ok: false, code: ALREADY_PAID, error: "이미 결제가 완료된 낙찰입니다." },
  { status: 409 },
);
const RESPONSE_IN_PROGRESS = () => NextResponse.json(
  { ok: false, code: PAYMENT_IN_PROGRESS, error: "이 낙찰의 결제가 이미 처리 중입니다. 잠시 후 주문 내역을 확인해주세요." },
  { status: 409 },
);
const RESPONSE_NEEDS_REVIEW = (status = 409) => NextResponse.json(
  { ok: false, code: PAYMENT_NEEDS_REVIEW, error: "결제 결과 확인이 필요합니다. 고객센터로 문의해주세요." },
  { status },
);

export async function POST(req: NextRequest) {
  if (!TOSS_SECRET_KEY) {
    console.error("[payment/confirm] TOSS_SECRET_KEY is not set in production — refusing to process payment");
    return NextResponse.json({ ok: false, error: "결제 시스템이 설정되지 않았습니다. 운영자에게 문의해주세요." }, { status: 500 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnon  = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const supabaseAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { paymentKey, orderId, amount } = await req.json();

  if (!paymentKey || !orderId || !amount) {
    return NextResponse.json({ ok: false, error: "Missing parameters" }, { status: 400 });
  }

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

  // Winner + amount: both must match the current DB state before Toss is
  // ever contacted. phase must be 'ended' (claim_winner() only ever sets
  // winner_id atomically together with phase='ended', so this also covers
  // "game isn't in a normal claimed state").
  const { data: gameState } = await supabaseAnon
    .from("game_state")
    .select("phase, winner_id, winner_price, winner_claimed_at")
    .eq("id", 1)
    .single();

  if (!gameState || gameState.phase !== "ended" || !gameState.winner_id || !gameState.winner_price) {
    return NextResponse.json({ ok: false, error: "낙찰 정보를 찾을 수 없습니다" }, { status: 400 });
  }
  if (gameState.winner_id !== user.id) {
    return NextResponse.json({ ok: false, error: "낙찰자 본인만 결제할 수 있습니다" }, { status: 403 });
  }
  if (gameState.winner_price !== amount) {
    return NextResponse.json({ ok: false, error: "결제 금액이 낙찰가와 일치하지 않습니다" }, { status: 400 });
  }

  // Phase 3.6: payment_attempts is the durable, pre-Toss record of this
  // order_id — it exists BEFORE Toss is ever contacted, and is the single
  // source of truth for idempotency (same order_id, same identity/amount/
  // paymentKey => safe replay; anything else about order_id reuse is
  // rejected before Toss is touched).
  const { data: existingAttempt, error: attemptLookupError } = await supabaseAdmin
    .from("payment_attempts")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();

  if (attemptLookupError) {
    console.error("[payment/confirm] payment_attempts lookup failed", { orderId, error: attemptLookupError });
    return NextResponse.json({ ok: false, error: "결제 확인 중 오류가 발생했습니다" }, { status: 500 });
  }

  if (existingAttempt) {
    const isSameRequest =
      existingAttempt.user_id === user.id &&
      existingAttempt.winner_id === gameState.winner_id &&
      existingAttempt.amount === amount &&
      existingAttempt.payment_key === paymentKey;

    if (!isSameRequest) {
      return NextResponse.json({ ok: false, error: "이미 사용된 주문번호입니다" }, { status: 409 });
    }

    if (
      existingAttempt.status === "paid" ||
      (existingAttempt.status === "reconciliation_required" && existingAttempt.toss_response)
    ) {
      // Toss already genuinely confirmed this exact payment — a page
      // refresh, back/forward, or retry never needs (and must never
      // trigger) a second Toss confirm call for it. A 'reconciliation_required'
      // row that carries Toss's success response still reports success:
      // the charge succeeded, only our order record needs manual follow-up,
      // and telling the user "failed" would be the actual lie.
      const cached = (existingAttempt.toss_response as Record<string, unknown> | null) ?? { totalAmount: existingAttempt.amount, method: null };
      return NextResponse.json({ ok: true, data: cached });
    }
    if (existingAttempt.status === "reconciliation_required") {
      // No Toss response stored: the Toss call ended in a network
      // exception/timeout, so whether it was approved is unknown. Neither
      // success nor failure can be claimed, and Toss must not be called
      // again — an operator resolves it.
      return RESPONSE_NEEDS_REVIEW();
    }
    if (existingAttempt.status === "pending") {
      // Another request for this exact order is (or was) mid-flight with
      // Toss. Never call Toss a second time for it; a pending attempt is
      // only ever resolved by that request or by an operator (no timeout).
      return RESPONSE_IN_PROGRESS();
    }
    // status is 'failed' (Toss explicitly rejected it, nothing was
    // charged) — safe to retry; re-reserved below.
  }

  // Everything from here on is a NEW approval (no paid/reconciliation
  // record above short-circuited it), so the payment window is
  // enforced here — after the idempotent replay path, so an already-paid
  // order re-checked after the window still reports success, and before
  // payment_attempts/Toss are touched. Both timestamps come from the DB
  // (winner_claimed_at + server_now()), never the client. A failed clock
  // read fails closed: no Toss call without a trusted "now".
  const { data: serverNow, error: serverNowError } = await supabaseAnon.rpc("server_now");
  if (serverNowError) {
    console.error("[payment/confirm] server_now() failed — refusing to approve", { orderId, error: serverNowError });
    return NextResponse.json({ ok: false, error: "결제 확인 중 오류가 발생했습니다" }, { status: 503 });
  }
  const windowCheck = checkPaymentWindow(gameState.winner_claimed_at, serverNow as string | null);
  if (!windowCheck.ok) {
    console.warn("[payment/confirm] payment window check refused approval", {
      orderId, userId: user.id, reason: windowCheck.reason, elapsedMs: windowCheck.elapsedMs,
    });
    return NextResponse.json(
      { ok: false, code: PAYMENT_WINDOW_EXPIRED, error: `결제 가능 시간(낙찰 후 ${WINNER_PAYMENT_WINDOW_MINUTES}분)이 지나 결제를 승인할 수 없습니다.` },
      { status: 403 },
    );
  }

  // Shipping info, re-validated server-side for every new approval (the
  // payment page's own check is UX only). Read from the user object
  // getUser() just fetched from Supabase Auth — not from anything the
  // client sent. These exact values are what gets snapshotted onto the
  // order below, so what was validated is what is stored.
  const shipping = shippingFromMetadata(user.user_metadata);
  const missingShipping = missingShippingFields(shipping);
  if (missingShipping.length > 0) {
    return NextResponse.json(
      { ok: false, code: SHIPPING_INFO_REQUIRED, missing: missingShipping, error: "배송지 정보(받는 분, 휴대폰 번호, 주소)를 먼저 등록해주세요." },
      { status: 422 },
    );
  }

  // ── Reserve this win, atomically, BEFORE Toss ───────────────────────────
  // The win is (winner_id, winner_claimed_at). The partial unique index
  // payment_attempts_one_active_per_win allows at most one pending/paid/
  // reconciliation_required attempt per win, so of two concurrent requests
  // for the same win exactly one reservation succeeds; the other gets 23505
  // here and never reaches Toss. Not a SELECT-then-INSERT check — the DB
  // decides. (winner_claimed_at is non-null: the window check above refuses
  // a null one.)
  const winClaimedAt = gameState.winner_claimed_at as string;
  let reserveError: { code?: string; message?: string } | null = null;
  if (!existingAttempt) {
    const { error } = await supabaseAdmin.from("payment_attempts").insert({
      order_id: orderId,
      user_id: user.id,
      winner_id: gameState.winner_id,
      win_claimed_at: winClaimedAt,
      amount,
      payment_key: paymentKey,
      status: "pending",
    });
    reserveError = error;
  } else {
    // Our own 'failed' row back to 'pending' — conditional on it still
    // being 'failed', so a concurrent retry of the same order can't both
    // flip it; the unique index still applies to the updated row.
    const { data: flipped, error } = await supabaseAdmin.from("payment_attempts")
      .update({ status: "pending", win_claimed_at: winClaimedAt, error_detail: null, updated_at: new Date().toISOString() })
      .eq("order_id", orderId)
      .eq("status", "failed")
      .select("order_id");
    reserveError = error;
    if (!error && (!flipped || flipped.length === 0)) return RESPONSE_IN_PROGRESS();
  }

  if (reserveError) {
    if (reserveError.code === "23505") {
      // This win already has an active attempt (or a concurrent request for
      // this same order_id just inserted it) — report which, never call Toss.
      const { data: active } = await supabaseAdmin.from("payment_attempts")
        .select("status")
        .eq("winner_id", gameState.winner_id)
        .eq("win_claimed_at", winClaimedAt)
        .in("status", [...ACTIVE_ATTEMPT_STATUSES])
        .limit(1)
        .maybeSingle();
      console.warn("[payment/confirm] win already has an active payment attempt — refusing new approval", {
        orderId, userId: user.id, activeStatus: active?.status ?? null,
      });
      if (active?.status === "paid") return RESPONSE_ALREADY_PAID();
      if (active?.status === "reconciliation_required") return RESPONSE_NEEDS_REVIEW();
      return RESPONSE_IN_PROGRESS();
    }
    console.error("[payment/confirm] failed to reserve payment_attempts row", { orderId, error: reserveError });
    return NextResponse.json({ ok: false, error: "결제 확인 중 오류가 발생했습니다" }, { status: 500 });
  }

  // Confirm payment with Toss — only reached once identity/winner/amount/
  // window/shipping have passed and this request holds the win's
  // reservation. An explicit Toss rejection (non-2xx with a readable body)
  // is 'failed'; anything that leaves the outcome unknown is caught below
  // as reconciliation_required — the client must never read a crashed
  // request as success.
  let data: Record<string, unknown>;
  try {
    const encoded = Buffer.from(`${TOSS_SECRET_KEY}:`).toString("base64");
    const res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: `Basic ${encoded}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });
    data = await res.json();
    if (!res.ok) {
      console.error("[payment/confirm] Toss rejected confirm", { orderId, paymentKey: maskPaymentKey(paymentKey), status: res.status, tossError: data });
      await supabaseAdmin.from("payment_attempts")
        .update({ status: "failed", toss_response: data, updated_at: new Date().toISOString() })
        .eq("order_id", orderId);
      return NextResponse.json({ ok: false, error: safeTossErrorMessage(data) }, { status: res.status });
    }
  } catch (e) {
    // Network exception / timeout / unreadable body: Toss may or may not
    // have approved it. NOT 'failed' — that would release the win for a
    // second payment. reconciliation_required keeps the win locked until an
    // operator checks Toss.
    console.error("[payment/confirm] Toss confirm outcome unknown — reconciliation_required", { orderId, paymentKey: maskPaymentKey(paymentKey), error: e });
    await supabaseAdmin.from("payment_attempts")
      .update({ status: "reconciliation_required", error_detail: String(e), updated_at: new Date().toISOString() })
      .eq("order_id", orderId);
    return RESPONSE_NEEDS_REVIEW(502);
  }

  // Toss has now genuinely confirmed the payment (money moved, or would in
  // production). From this point on we must never tell the user "결제
  // 실패" — that would invite a retry that re-hits an already-confirmed
  // paymentKey, which Toss doesn't guarantee is harmless. The
  // payment_attempts row updated below is the durable record that makes
  // recovery possible even if the orders insert fails.
  const { error: insertError } = await supabaseAdmin.from("orders").insert({
    user_id:      user.id,
    // Immutable historical record of who this order was for — survives
    // account deletion (no FK, same pattern as payment_attempts.winner_id)
    // even after user_id goes null via ON DELETE SET NULL. This is what
    // admin/reconciliation logic keys off, not user_id.
    winner_id:    gameState.winner_id,
    product_name: data.orderName ?? "Apple iPad Air 11형 Wi-Fi 128GB",
    amount:       data.totalAmount,
    order_id:     orderId,
    payment_key:  paymentKey,
    // Shipping snapshot as of this approval — independent of later profile
    // edits and of account deletion (see the orders_shipping_snapshot
    // migration).
    shipping_recipient_name: shipping.recipientName,
    shipping_phone:          shipping.phone,
    shipping_postcode:       shipping.postcode,
    shipping_address:        shipping.address,
    shipping_address_detail: shipping.addressDetail || null,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      // Race: a concurrent request for the same order_id won the orders
      // insert between our earlier attempt lookup and this insert. The
      // order is saved either way — mark this attempt paid too.
      await supabaseAdmin.from("payment_attempts")
        .update({ status: "paid", toss_response: data, updated_at: new Date().toISOString() })
        .eq("order_id", orderId);
    } else {
      // The payment succeeded at Toss; the local order record did not.
      // This is exactly the durable "reconciliation_required" case — every
      // field needed to manually (or via a future automated job) complete
      // the missing `orders` row is preserved right here: user_id,
      // winner_id, amount, payment_key, and the full Toss response
      // (orderName/totalAmount/method) in toss_response.
      await supabaseAdmin.from("payment_attempts")
        .update({
          status: "reconciliation_required",
          toss_response: data,
          error_detail: String(insertError.message ?? insertError),
          updated_at: new Date().toISOString(),
        })
        .eq("order_id", orderId);
      console.error("[payment/confirm] orders insert failed after Toss confirm succeeded — reconciliation_required", {
        orderId, paymentKey: maskPaymentKey(paymentKey), userId: user.id, amount, error: insertError,
      });
    }
    return NextResponse.json({ ok: true, data });
  }

  await supabaseAdmin.from("payment_attempts")
    .update({ status: "paid", toss_response: data, updated_at: new Date().toISOString() })
    .eq("order_id", orderId);

  return NextResponse.json({ ok: true, data });
}
