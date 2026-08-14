import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY ?? "test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R";

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnon  = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const supabaseAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { paymentKey, orderId, amount } = await req.json();

  if (!paymentKey || !orderId || !amount) {
    return NextResponse.json({ ok: false, error: "Missing parameters" }, { status: 400 });
  }

  // Verify amount against DB winner_price to prevent tampering
  const { data: gameState } = await supabaseAnon
    .from("game_state")
    .select("winner_price")
    .eq("id", 1)
    .single();

  if (!gameState?.winner_price) {
    return NextResponse.json({ ok: false, error: "낙찰 정보를 찾을 수 없습니다" }, { status: 400 });
  }
  if (gameState.winner_price !== amount) {
    return NextResponse.json({ ok: false, error: "결제 금액이 낙찰가와 일치하지 않습니다" }, { status: 400 });
  }

  // Confirm payment with Toss
  const encoded = Buffer.from(`${TOSS_SECRET_KEY}:`).toString("base64");
  const res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: data }, { status: res.status });
  }

  // Get user from Authorization header and save order record (server-side)
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (token) {
    const { data: { user } } = await supabaseAnon.auth.getUser(token);
    if (user) {
      await supabaseAdmin.from("orders").insert({
        user_id:      user.id,
        product_name: data.orderName ?? "Apple iPad Air 11형 Wi-Fi 128GB",
        amount:       data.totalAmount,
        order_id:     orderId,
        payment_key:  paymentKey,
      });
    }
  }

  return NextResponse.json({ ok: true, data });
}
