// Pure validation, no React/client dependency — reused by both the admin
// UI (via app/context/GameContext.tsx's re-export) and the server-side
// /api/admin/update-config route, so a raw REST write can no longer bypass
// the client-side check that used to be the only place this ran.

export interface DropZoneConfig {
  startPrice: number;
  floorPrice: number;
  fastDropPrice: number | null;
  fastDropAmount: number | null;
  finalDropPrice: number | null;
  finalDropAmount: number | null;
}

// FAST requires: a positive rate and a threshold below startPrice.
// FINAL requires FAST to be set too, plus a positive rate and a threshold
// below fastDropPrice. Mirrors the DB CHECK constraints in
// supabase/migrations/20260902120000_drop_zones.sql — keep both in sync.
// Returns an error message, or null if the config is valid (including the
// "zones disabled" case where fastDropPrice/fastDropAmount are both null).
export function validateDropZones(config: DropZoneConfig): string | null {
  const { startPrice, floorPrice, fastDropPrice, fastDropAmount, finalDropPrice, finalDropAmount } = config;

  if (floorPrice >= startPrice) return "목표 하한가는 시작가보다 낮아야 합니다";

  const fastSet = fastDropPrice != null || fastDropAmount != null;
  const finalSet = finalDropPrice != null || finalDropAmount != null;

  // Each zone's price/amount must both be set or both be blank — never one
  // without the other. Mirrors the DB CHECK constraints in
  // supabase/migrations/20260902120000_drop_zones.sql exactly; keep both in
  // sync if either changes.
  if (fastSet && (fastDropPrice == null || fastDropAmount == null)) {
    return "FAST DROP ZONE은 시작가와 속도를 둘 다 입력하거나 둘 다 비워야 합니다";
  }
  if (finalSet && (finalDropPrice == null || finalDropAmount == null)) {
    return "FINAL DROP ZONE은 시작가와 속도를 둘 다 입력하거나 둘 다 비워야 합니다";
  }
  if (finalSet && !fastSet) {
    return "FINAL DROP ZONE을 쓰려면 FAST DROP ZONE도 설정해야 합니다";
  }
  if (!fastSet) return null; // zones disabled

  if (fastDropAmount! <= 0) return "FAST DROP 속도는 0보다 커야 합니다";
  if (fastDropPrice! <= floorPrice) return "FAST DROP ZONE 시작가는 목표 하한가보다 높아야 합니다";
  if (fastDropPrice! >= startPrice) return "FAST DROP ZONE 시작가는 시작가보다 낮아야 합니다";

  if (finalSet) {
    if (finalDropAmount! <= 0) return "FINAL DROP 속도는 0보다 커야 합니다";
    if (finalDropPrice! <= floorPrice) return "FINAL DROP ZONE 시작가는 목표 하한가보다 높아야 합니다";
    if (finalDropPrice! >= fastDropPrice!) return "FINAL DROP ZONE 시작가는 FAST DROP ZONE 시작가보다 낮아야 합니다";
  }

  return null;
}
