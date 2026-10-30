// Toss key environment, fail-closed (M4-A). There is no built-in key: with
// a key missing, malformed or in the wrong mode, no payment can start (the
// payment page) and no approval is ever sent (the confirm route).
//
// Expected mode comes from VERCEL_ENV: "production" -> live keys only;
// anything else (preview, development, or unset = local) -> test keys only.
// Vercel builds Preview deployments with NODE_ENV=production too, so
// NODE_ENV can't tell them apart. Which keys each Vercel environment holds
// is still an env-scope setting the code can't see — this check makes a
// live key in Preview (or a test key in Production) refuse instead of
// charging.
//
// Only the "API 개별 연동" key pair fits the payment window SDK
// (tossPayments.payment()): client test_ck_ / live_ck_, secret test_sk_ /
// live_sk_. Widget keys (gck / gsk) are refused as malformed.
//
// Never logs or returns a key's body — only which check failed.

export type TossMode = "live" | "test";
export type TossKeyRole = "client" | "secret";

const KEY_RE = /^(live|test)_(ck|sk)_[A-Za-z0-9_-]{8,}$/;

// The key's mode, or null when it isn't a well-formed key of that role.
export function tossKeyMode(key: string | undefined | null, role: TossKeyRole): TossMode | null {
  if (typeof key !== "string") return null;
  const m = KEY_RE.exec(key);
  if (!m || m[2] !== (role === "client" ? "ck" : "sk")) return null;
  return m[1] as TossMode;
}

export function expectedTossMode(vercelEnv: string | undefined): TossMode {
  return vercelEnv === "production" ? "live" : "test";
}

export type TossConfigError =
  | "missing_client_key" | "missing_secret_key"
  | "malformed_client_key" | "malformed_secret_key"
  | "key_mode_mismatch"            // client and secret not the same mode
  | "wrong_mode_for_environment";  // e.g. test keys in production, live keys in preview

export type TossServerConfig =
  | { ok: true; secretKey: string; mode: TossMode }
  | { ok: false; reason: TossConfigError; vercelEnv: string | null };

type Env = Record<string, string | undefined>;

// Server side (the confirm route): both keys are checked, read at call time.
export function resolveTossServerConfig(env: Env = process.env): TossServerConfig {
  const vercelEnv = env.VERCEL_ENV || null;
  const fail = (reason: TossConfigError): TossServerConfig => ({ ok: false, reason, vercelEnv });
  const client = env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
  const secret = env.TOSS_SECRET_KEY;
  if (!client) return fail("missing_client_key");
  if (!secret) return fail("missing_secret_key");
  const clientMode = tossKeyMode(client, "client");
  const secretMode = tossKeyMode(secret, "secret");
  if (!clientMode) return fail("malformed_client_key");
  if (!secretMode) return fail("malformed_secret_key");
  if (clientMode !== secretMode) return fail("key_mode_mismatch");
  if (secretMode !== expectedTossMode(env.VERCEL_ENV)) return fail("wrong_mode_for_environment");
  return { ok: true, secretKey: secret, mode: secretMode };
}

export type TossClientKeyCheck =
  | { ok: true; clientKey: string; mode: TossMode }
  | { ok: false; reason: "missing_client_key" | "malformed_client_key" | "wrong_mode_for_environment" };

// Browser side (the payment page): the client key only. The environment is
// checked only when the build exposes it (NEXT_PUBLIC_VERCEL_ENV) — without
// it the page can't know, and the confirm route's check above is the one
// that stops a wrong-mode approval.
export function checkTossClientKey(key: string | undefined, publicVercelEnv: string | undefined): TossClientKeyCheck {
  if (!key) return { ok: false, reason: "missing_client_key" };
  const mode = tossKeyMode(key, "client");
  if (!mode) return { ok: false, reason: "malformed_client_key" };
  if (publicVercelEnv && mode !== expectedTossMode(publicVercelEnv)) return { ok: false, reason: "wrong_mode_for_environment" };
  return { ok: true, clientKey: key, mode };
}
