// Reads the Supabase Auth session id (the `session_id` claim) out of an
// access token that has ALREADY been verified — call this only after
// admin.auth.getUser(token) succeeded for that same token. It doesn't check
// the signature itself; it only refuses a token whose subject isn't the
// verified user or whose session_id isn't a uuid.
//
// Used by /api/join/participant to bind a participant slot to one sign-in
// session (see supabase/migrations/20261014100000_one_session_per_account_round.sql).
// The session id never comes from the request body.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sessionIdFromVerifiedToken(token: string, verifiedUserId: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const { sub, session_id } = payload as { sub?: unknown; session_id?: unknown };
  if (sub !== verifiedUserId) return null;
  if (typeof session_id !== "string" || !UUID_RE.test(session_id)) return null;
  return session_id.toLowerCase();
}
