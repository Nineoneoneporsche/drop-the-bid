import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin } from "../../../lib/adminAuth";
import { sessionIdFromVerifiedToken } from "../../../lib/jwtSession";

const DEVICE_COOKIE = "dtb_device";
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// Friendly Korean text for the specific new failure modes join_game_participant()
// can raise. Anything else falls back to a generic message — the existing
// /join page already has one for that.
const ERROR_MESSAGES: Record<string, string> = {
  "this device already joined as a participant this round": "이미 이 기기에서 다른 계정으로 참여했습니다.",
  "verification required": "사람인지 확인이 필요합니다. 다시 시도해주세요.",
  "participant role requires a signed-in account": "참여자로 입장하려면 로그인이 필요합니다.",
  "nickname reserved": "사용할 수 없는 닉네임입니다.",
  "invalid nickname": "닉네임은 2~20자로 입력해주세요.",
};

// Join refusals that aren't retryable as-is: 409 with a stable code.
const CONFLICT_CODES: Record<string, { code: string; error: string }> = {
  "account active on another session": {
    code: "ACCOUNT_ACTIVE_ELSEWHERE",
    error: "이 계정은 다른 기기에서 현재 경매에 참여 중입니다.",
  },
  "participant join closed": {
    code: "PARTICIPANT_JOIN_CLOSED",
    error: "지금은 참여자로 입장할 수 없습니다. 관전자로 입장해주세요.",
  },
  // Before T - N (or no T scheduled): the window hasn't opened yet.
  participant_join_not_open: {
    code: "PARTICIPANT_JOIN_NOT_OPEN",
    error: "아직 참가 가능 시간이 아닙니다. 참가 오픈 시각 이후에 다시 시도해주세요.",
  },
};

async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  // Not configured yet — don't brick every participant join over a
  // Cloudflare setup step that hasn't happened. The device-cookie guard
  // below still applies either way; this option is layered on once set up.
  if (!secret) return true;
  if (!token) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await res.json();
    return data?.success === true;
  } catch {
    // Cloudflare unreachable — fail closed on the CAPTCHA step itself
    // (don't let a Turnstile outage silently disable the gate).
    return false;
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: { nickname?: string; turnstileToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다." }, { status: 400 });
  }
  const nickname = (body.nickname ?? "").trim();

  const admin = getSupabaseAdmin();

  // Identity comes from independently validating the caller's own Supabase
  // access token here — never trusted from the request body.
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }
  const uid = userData.user.id;
  // The sign-in session this participant slot is bound to — taken from the
  // token Supabase Auth just accepted, never from the request body.
  const sessionId = sessionIdFromVerifiedToken(token, uid);
  if (!sessionId) {
    return NextResponse.json(
      { ok: false, code: "AUTH_SESSION_INVALID", error: "로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요." },
      { status: 401 },
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const turnstileOk = await verifyTurnstile(body.turnstileToken, ip);
  if (!turnstileOk) {
    return NextResponse.json({ ok: false, error: ERROR_MESSAGES["verification required"] }, { status: 400 });
  }

  // dtb_device: HttpOnly so client JS (and a raw API caller with no real
  // browser session) can't read or fabricate it freely. Only its HMAC ever
  // reaches the database — never the raw cookie value.
  let deviceId = req.cookies.get(DEVICE_COOKIE)?.value ?? null;
  const isNewDeviceCookie = !deviceId;
  if (!deviceId) deviceId = crypto.randomUUID();
  const deviceHash = crypto
    .createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!)
    .update(deviceId)
    .digest("hex");

  // Marks "cleared the gated route" — see join_game_participant()'s
  // comment in supabase/migrations/20260921100000_anti_multi_account.sql
  // for why this is written unconditionally (not only when Turnstile is
  // actually configured).
  await admin.from("participant_verifications").upsert({
    guest_id: uid,
    verified_at: new Date().toISOString(),
  });

  const { error: joinError } = await admin.rpc("join_game_participant", {
    p_uid: uid,
    p_nickname: nickname,
    p_device_hash: deviceHash,
    p_session_id: sessionId,
  });

  if (joinError) {
    const conflict = CONFLICT_CODES[joinError.message];
    if (conflict) {
      return NextResponse.json({ ok: false, ...conflict }, { status: 409 });
    }
    const friendly = ERROR_MESSAGES[joinError.message] ?? "입장 중 오류가 발생했습니다. 다시 시도해주세요.";
    return NextResponse.json({ ok: false, error: friendly }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });
  if (isNewDeviceCookie) {
    res.cookies.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: DEVICE_COOKIE_MAX_AGE,
      path: "/",
    });
  }
  return res;
}
