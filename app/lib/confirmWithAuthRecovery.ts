// Calls /api/payment/confirm with one bounded recovery path for a stale or
// expired Supabase session — e.g. returning from Toss / a card app with a
// token the browser still thinks is valid but Supabase Auth rejects.
//
// The ONLY automatic retry: the server answered 401 AUTH_SESSION_INVALID.
// That check is the confirm route's first step, so such a response means
// nothing happened server-side (no payment_attempts row, no reservation, no
// Toss call) and re-sending is equivalent to the first send. Then: refresh
// the session and re-send the SAME body object, at most once.
//
// Never retried automatically: a network exception (the request may or may
// not have reached the server), any other status (400/403/409/422/5xx), and
// every coded refusal (PAYMENT_IN_PROGRESS, PAYMENT_NEEDS_REVIEW,
// ALREADY_PAID, PAYMENT_WINDOW_EXPIRED, SHIPPING_INFO_REQUIRED, …) — those
// are returned to the caller as-is.

export const AUTH_REQUIRED = "AUTH_REQUIRED";
export const AUTH_SESSION_INVALID = "AUTH_SESSION_INVALID";

// winId (auction_wins.id) is sent by every confirmation started since M1;
// optional only for a legacy replay of a pre-M1 order. The server never
// trusts it — it re-reads the win's winner_id and price from auction_wins.
export type ConfirmBody = Readonly<{ paymentKey: string; orderId: string; amount: number; winId?: string }>;

// "ok" = Supabase Auth confirmed a signed-in (non-anonymous) user;
// "invalid" = it rejected the session or it's anonymous / absent;
// "unknown" = couldn't reach Auth (don't conclude anything — let the
// confirm request itself be the check).
export type SessionCheck = "ok" | "invalid" | "unknown";

export type AuthRecoveryDeps = {
  // Access token of the current non-anonymous session, or null.
  getAccessToken: () => Promise<string | null>;
  verifySession: () => Promise<SessionCheck>;
  // Refreshes; resolves to the new non-anonymous access token, or null on failure.
  refreshSession: () => Promise<string | null>;
  // POSTs the body; resolves with the HTTP status and parsed JSON. Throws on
  // a network failure or an unreadable body.
  postConfirm: (body: ConfirmBody, accessToken: string | null) => Promise<{ status: number; json: unknown }>;
};

export type ConfirmOutcome =
  | { kind: "response"; status: number; json: unknown; requests: number }
  | { kind: "relogin"; requests: number }
  | { kind: "network_error"; requests: number };

function codeOf(json: unknown): string | null {
  if (json && typeof json === "object" && typeof (json as { code?: unknown }).code === "string") {
    return (json as { code: string }).code;
  }
  return null;
}

export async function confirmWithAuthRecovery(body: ConfirmBody, deps: AuthRecoveryDeps): Promise<ConfirmOutcome> {
  let requests = 0;

  // Pre-flight: make sure the token is one Supabase Auth still accepts.
  let token = await deps.getAccessToken();
  const check = token ? await deps.verifySession() : "invalid";
  if (check === "invalid") {
    token = await deps.refreshSession();
    if (!token) return { kind: "relogin", requests };
  }

  const send = async (): Promise<ConfirmOutcome | { status: number; json: unknown }> => {
    requests++;
    try {
      return await deps.postConfirm(body, token);
    } catch {
      return { kind: "network_error", requests };
    }
  };

  let res = await send();
  if ("kind" in res) return res;

  if (res.status === 401 && codeOf(res.json) === AUTH_SESSION_INVALID) {
    token = await deps.refreshSession();
    if (!token) return { kind: "relogin", requests };
    res = await send(); // the single retry — same body object
    if ("kind" in res) return res;
  }

  if (res.status === 401 && (codeOf(res.json) === AUTH_SESSION_INVALID || codeOf(res.json) === AUTH_REQUIRED)) {
    return { kind: "relogin", requests };
  }
  return { kind: "response", status: res.status, json: res.json, requests };
}
