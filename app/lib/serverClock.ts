// Single shared client/server clock-offset source. Every place in the app
// that needs "what time is it right now, in a way that agrees with every
// other client" (the live price ticker, the strategy countdown) should call
// getServerNow() from here instead of Date.now() directly — see
// app/context/GameContext.tsx's calcPriceAndStage and app/strategy/page.tsx's
// countdown effect.
//
// The offset is measured via the server_now() RPC (added in
// supabase/migrations/20260910090000_server_clock_sync.sql) using a small
// NTP-style round-trip correction: for each sample we note t0 (just before
// the request) and t1 (just after the response), and treat the moment the
// server's clock reading corresponds to as the midpoint of that round trip,
// (t0+t1)/2. offset = serverTime - (t0+t1)/2, so that
// Date.now() + offset ≈ current server time regardless of how wrong this
// device's own clock is.
//
// A single sample can be thrown off by one slow request, so a sync takes a
// few samples and keeps the one with the smallest round-trip time (least
// opportunity for the estimate to drift). A failed sync (all samples
// erroring, e.g. offline) leaves the previous offset untouched — falling
// back to raw Date.now() would be a worse guess than the last known-good
// server offset.

import { supabase } from "./supabase";

let offset = 0;
let hasSynced = false;

const SAMPLE_COUNT = 3;
const RESYNC_INTERVAL_MS = 60_000;

async function measureOnce(): Promise<{ offset: number; rtt: number } | null> {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc("server_now");
  const t1 = Date.now();
  if (error || !data) return null;

  const serverTime = new Date(data as string).getTime();
  if (Number.isNaN(serverTime)) return null;

  const rtt = t1 - t0;
  return { offset: serverTime - (t0 + t1) / 2, rtt };
}

// Takes a few samples and keeps the lowest-RTT one. Returns whether the
// offset actually changed (i.e. sync succeeded) — callers that only care
// about "is this in place yet" can ignore the return value.
export async function syncServerClock(sampleCount = SAMPLE_COUNT): Promise<boolean> {
  const samples: { offset: number; rtt: number }[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const sample = await measureOnce();
    if (sample) samples.push(sample);
  }
  if (samples.length === 0) return false; // keep last known-good offset

  samples.sort((a, b) => a.rtt - b.rtt);
  offset = samples[0].offset;
  hasSynced = true;
  return true;
}

// Best current estimate of the server's clock. Before the first sync
// resolves this is just Date.now() (offset 0) — a brief, unavoidable
// bootstrap window, no worse than what every client did before this existed.
export function getServerNow(): number {
  return Date.now() + offset;
}

export function getClockOffset(): number {
  return offset;
}

export function hasSyncedServerClock(): boolean {
  return hasSynced;
}

// Wires up the initial sync, periodic resync, and background->foreground
// resync. Called once from GameProvider; returns a cleanup function.
export function startClockSync(): () => void {
  void syncServerClock();

  const interval = setInterval(() => { void syncServerClock(); }, RESYNC_INTERVAL_MS);

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") void syncServerClock();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
