"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { getServerNow, startClockSync } from "../lib/serverClock";

export type Role = "participant" | "spectator";
export type Phase = "home" | "strategy" | "game" | "ended";
export type MessageKind = "chat" | "system" | "narrator";

export interface ChatMessage {
  id: string;
  nickname: string;
  message: string;
  kind?: MessageKind;
  timestamp: number;
}

export type DropStage = "normal" | "fast" | "final";

// Admin-configured chat message that fires once, under operatorNickname,
// the first time the displayed price drops to/below `threshold`% of
// startPrice. A free-form list (not fixed to 10%-steps) so the admin can
// add/remove/re-space thresholds without a code change.
export interface OperatorMessage {
  threshold: number; // 0–100, % of startPrice
  message: string;
}

export interface GameConfig {
  productName: string;
  startPrice: number;
  dropAmount: number;       // NORMAL zone, ₩/sec
  floorPrice: number;       // maps to DB minimum_price — absolute floor for every zone
  strategyDuration: number;
  gameStartTime: string | null;
  // Drop zones are optional: both fast fields null = legacy single-rate
  // behavior. final fields are only meaningful once fast is set.
  fastDropPrice: number | null;   // FAST DROP ZONE threshold — price at which FAST rate kicks in
  fastDropAmount: number | null;  // FAST DROP ZONE, ₩/sec
  finalDropPrice: number | null;  // FINAL DROP ZONE threshold — price at which FINAL rate kicks in
  finalDropAmount: number | null; // FINAL DROP ZONE, ₩/sec
  // How many seconds between price steps, one per zone. The per-zone ₩/sec
  // amounts above are unchanged by this — a larger interval just makes each
  // step bigger and less frequent instead of the price sliding down
  // continuously. 1 = today's behavior. Each zone steps from its own start,
  // so changing one zone's interval never shifts another zone's boundary.
  dropIntervalSeconds: number;      // NORMAL
  fastDropIntervalSeconds: number;  // FAST DROP ZONE
  finalDropIntervalSeconds: number; // FINAL DROP ZONE
  operatorNickname: string;           // chat nickname operatorMessages fire under
  operatorMessages: OperatorMessage[];
}

export interface CurrentUser {
  guestId: string;
  nickname: string;
  role: Role;
}

export interface GameState {
  config: GameConfig;
  phase: Phase;
  currentUser: CurrentUser | null;
  currentPrice: number;
  dropStage: DropStage;
  winner: { id: string; nickname: string; price: number; claimedAt: number | null } | null;
  chatMessages: ChatMessage[];
  strategyStartedAt: number | null;
  gameStartedAt: number | null;
  participantCount: number;
  spectatorCount: number;
  isLoaded: boolean;
}

export const DEFAULT_CONFIG: GameConfig = {
  productName: "Apple iPad Air 11형 Wi-Fi 128GB",
  startPrice: 899_000,
  dropAmount: 1_000,
  floorPrice: 550_000,
  strategyDuration: 60,
  gameStartTime: null,
  fastDropPrice: null,
  fastDropAmount: null,
  finalDropPrice: null,
  finalDropAmount: null,
  dropIntervalSeconds: 1,
  fastDropIntervalSeconds: 1,
  finalDropIntervalSeconds: 1,
  operatorNickname: "운영자",
  operatorMessages: [],
};

// Moved to app/lib/dropZones.ts (no React dependency) so the server-side
// /api/admin/update-config route can reuse the exact same validation —
// re-exported here so existing `from "../context/GameContext"` imports
// keep working unchanged.
export { validateDropZones } from "../lib/dropZones";


interface GameContextValue {
  state: GameState;
  joinGame: (nickname: string, role: Role) => Promise<void>;
  leaveGame: () => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  addLocalMessage: (msg: ChatMessage) => void;
  raiseHand: () => Promise<boolean>;
}

const GameContext = createContext<GameContextValue | null>(null);

// ── DB row type (matches new schema) ──────────────────────────────────────────
type DbRow = {
  phase: string;
  strategy_started_at: string | null;
  game_started_at: string | null;
  scheduled_start_at: string | null;
  product_name: string;
  start_price: number;
  drop_amount: number;
  minimum_price: number;
  strategy_duration: number;
  winner_id: string | null;
  winner_nickname: string | null;
  winner_price: number | null;
  winner_claimed_at: string | null;
  fast_drop_price: number | null;
  fast_drop_amount: number | null;
  final_drop_price: number | null;
  final_drop_amount: number | null;
  drop_interval_seconds: number;
  fast_drop_interval_seconds: number;
  final_drop_interval_seconds: number;
  operator_nickname: string | null;
  operator_messages: OperatorMessage[] | null;
};

function rowToConfig(row: DbRow): GameConfig {
  return {
    productName:      row.product_name      ?? DEFAULT_CONFIG.productName,
    startPrice:       row.start_price       ?? DEFAULT_CONFIG.startPrice,
    dropAmount:       row.drop_amount       ?? DEFAULT_CONFIG.dropAmount,
    floorPrice:       row.minimum_price     ?? DEFAULT_CONFIG.floorPrice,
    strategyDuration: row.strategy_duration ?? DEFAULT_CONFIG.strategyDuration,
    gameStartTime: row.scheduled_start_at ?? null,
    fastDropPrice:  row.fast_drop_price  ?? null,
    fastDropAmount: row.fast_drop_amount ?? null,
    finalDropPrice:  row.final_drop_price  ?? null,
    finalDropAmount: row.final_drop_amount ?? null,
    dropIntervalSeconds:      row.drop_interval_seconds       ?? DEFAULT_CONFIG.dropIntervalSeconds,
    fastDropIntervalSeconds:  row.fast_drop_interval_seconds  ?? DEFAULT_CONFIG.fastDropIntervalSeconds,
    finalDropIntervalSeconds: row.final_drop_interval_seconds ?? DEFAULT_CONFIG.finalDropIntervalSeconds,
    operatorNickname: row.operator_nickname ?? DEFAULT_CONFIG.operatorNickname,
    operatorMessages: Array.isArray(row.operator_messages) ? row.operator_messages : DEFAULT_CONFIG.operatorMessages,
  };
}

// Server-authoritative price + stage for elapsed time into the game. Mirrors
// calc_drop_price()/claim_winner() in
// supabase/migrations/20260903100000_per_zone_drop_interval.sql exactly —
// both compute off game_started_at (a server timestamp), so a fresh page
// load or a mid-game join lands on the same price/stage as everyone else
// already watching, and the RPC never trusts what this returns. Keep the
// two in sync if either changes.
//
// Elapsed time is measured against getServerNow() (app/lib/serverClock.ts),
// not raw Date.now() — this device's own clock can be off by seconds from
// everyone else's, and since game_started_at is a shared server timestamp,
// using an uncorrected local clock to measure "how long ago was that" is
// exactly what used to make the displayed price disagree across devices.
//
// Each zone steps against its OWN interval, measured from that zone's own
// start (not from game start) — so changing one zone's interval never
// shifts when the other zones' boundaries land. Zone thresholds (tFast,
// tFinal) always come from the continuous, unstepped rate math; only the
// price displayed within a zone steps.
function calcPriceAndStage(gameStartedAt: number, config: GameConfig): { price: number; stage: DropStage } {
  const rawElapsed = Math.max(0, (getServerNow() - gameStartedAt) / 1000);
  const {
    startPrice, floorPrice, dropAmount, fastDropPrice, fastDropAmount, finalDropPrice, finalDropAmount,
    dropIntervalSeconds, fastDropIntervalSeconds, finalDropIntervalSeconds,
  } = config;
  const normalInterval = dropIntervalSeconds > 0 ? dropIntervalSeconds : 1;
  const fastInterval    = fastDropIntervalSeconds > 0 ? fastDropIntervalSeconds : 1;
  const finalInterval   = finalDropIntervalSeconds > 0 ? finalDropIntervalSeconds : 1;
  const step = (t: number, interval: number) => Math.floor(t / interval) * interval;

  if (fastDropPrice == null || fastDropAmount == null) {
    const stepped = step(rawElapsed, normalInterval);
    return { price: Math.max(floorPrice, Math.round(startPrice - stepped * dropAmount)), stage: "normal" };
  }

  const tFast = (startPrice - fastDropPrice) / dropAmount;
  if (rawElapsed <= tFast) {
    const stepped = step(rawElapsed, normalInterval);
    return { price: Math.round(startPrice - stepped * dropAmount), stage: "normal" };
  }

  const fastElapsed = rawElapsed - tFast;

  if (finalDropPrice == null || finalDropAmount == null) {
    const stepped = step(fastElapsed, fastInterval);
    return {
      price: Math.max(floorPrice, Math.round(fastDropPrice - stepped * fastDropAmount)),
      stage: "fast",
    };
  }

  const tFinal = (fastDropPrice - finalDropPrice) / fastDropAmount;
  if (fastElapsed <= tFinal) {
    const stepped = step(fastElapsed, fastInterval);
    return { price: Math.round(fastDropPrice - stepped * fastDropAmount), stage: "fast" };
  }

  const finalElapsed = fastElapsed - tFinal;
  const stepped = step(finalElapsed, finalInterval);
  return {
    price: Math.max(floorPrice, Math.round(finalDropPrice - stepped * finalDropAmount)),
    stage: "final",
  };
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase]               = useState<Phase>("home");
  const [config, setConfig]             = useState<GameConfig>(DEFAULT_CONFIG);
  const [currentUser, setCurrentUser]   = useState<CurrentUser | null>(null);
  const [currentPrice, setCurrentPrice] = useState(DEFAULT_CONFIG.startPrice);
  const [dropStage, setDropStage]       = useState<DropStage>("normal");
  const [winner, setWinner]             = useState<GameState["winner"]>(null);
  const [messages, setMessages]         = useState<ChatMessage[]>([]);
  const [strategyStartedAt, setStrategyStartedAt] = useState<number | null>(null);
  const [gameStartedAt, setGameStartedAt]         = useState<number | null>(null);
  const [participantCount, setParticipantCount]   = useState(0);
  const [spectatorCount, setSpectatorCount]       = useState(0);
  const [isLoaded, setIsLoaded]                   = useState(false);

  const tickRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const configRef    = useRef(config);
  const gameAtRef    = useRef(gameStartedAt);
  const userRef      = useRef(currentUser);
  const lastCleanupRef = useRef(0);
  configRef.current  = config;
  gameAtRef.current  = gameStartedAt;
  userRef.current    = currentUser;

  const applyDbRow = useCallback((row: DbRow) => {
    const mappedPhase: Phase = row.phase === "waiting" ? "home" : (row.phase as Phase);
    const cfg = rowToConfig(row);
    const stratAt = row.strategy_started_at ? new Date(row.strategy_started_at).getTime() : null;
    const gameAt  = row.game_started_at     ? new Date(row.game_started_at).getTime()     : null;
    const w = row.winner_id
      ? {
          id: row.winner_id,
          nickname: row.winner_nickname ?? "",
          price: row.winner_price ?? 0,
          claimedAt: row.winner_claimed_at ? new Date(row.winner_claimed_at).getTime() : null,
        }
      : null;

    setPhase(mappedPhase);
    setConfig(cfg);
    setStrategyStartedAt(stratAt);
    setGameStartedAt(gameAt);
    setWinner(w);
    if (gameAt) {
      const { price, stage } = calcPriceAndStage(gameAt, cfg);
      setCurrentPrice(price);
      setDropStage(stage);
    } else {
      setCurrentPrice(cfg.startPrice);
      setDropStage("normal");
    }
  }, []);

  // Load current game guest from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("dtb_guest");
      if (saved) setCurrentUser(JSON.parse(saved) as CurrentUser);
    } catch {}
  }, []);

  // Identity bootstrap (Phase 1): every visitor needs a Supabase Auth
  // session before joinGame() can call join_game(), since that RPC uses
  // auth.uid() as the sole identity — never a client-supplied id. A signed-in
  // user already has a real session; a first-time/signed-out visitor gets an
  // Anonymous Auth session instead. Supabase persists either kind across
  // reloads on its own (localStorage refresh token), so this only actually
  // calls the network once per browser, not once per page load.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) void supabase.auth.signInAnonymously();
    });
  }, []);

  // Client/server clock offset — initial sync, periodic resync, and an
  // immediate resync on returning from background. See
  // app/lib/serverClock.ts; calcPriceAndStage above and the strategy
  // countdown both read getServerNow() from that same module.
  useEffect(() => startClockSync(), []);

  const CLEANUP_THROTTLE_MS = 45_000;

  // Phase 8: participant/spectator counts are now maintained as a local
  // diff (guest_id -> role map) instead of re-SELECTing the whole
  // participants table on every INSERT/DELETE Realtime event — see
  // recomputeParticipantCounts()/fetchParticipantsSnapshot() below. This
  // ref is the map's source of truth; it never triggers a re-render itself
  // (only the derived participantCount/spectatorCount state does).
  const participantsMapRef = useRef<Map<string, Role>>(new Map());

  const recomputeParticipantCounts = useCallback(() => {
    let p = 0, s = 0;
    for (const role of participantsMapRef.current.values()) {
      if (role === "participant") p++; else s++;
    }
    setParticipantCount(p);
    setSpectatorCount(s);
  }, []);

  // Authoritative full re-fetch — rebuilds the local map from the DB
  // directly, correcting any drift (a missed Realtime event during a
  // disconnect, a duplicate delivery, etc.) instead of trusting the map's
  // incremental state. Called on mount and from resyncAll() below.
  const fetchParticipantsSnapshot = useCallback(async () => {
    const { data } = await supabase.from("participants").select("guest_id, role");
    if (!data) return;
    participantsMapRef.current = new Map(data.map((r) => [r.guest_id as string, r.role as Role]));
    recomputeParticipantCounts();
  }, [recomputeParticipantCounts]);

  const fetchGameStateSnapshot = useCallback(async () => {
    const { data } = await supabase.from("game_state").select("*").eq("id", 1).single();
    if (data) applyDbRow(data as unknown as DbRow);
  }, [applyDbRow]);

  // Ghost-participant cleanup — unchanged from Phase 7 other than being
  // split out of the old refreshCounts() (which used to also do the full
  // count re-fetch this function no longer needs to trigger). Still
  // throttled per client so a burst of joins/leaves doesn't fire
  // cleanup_stale_participants() from every connected browser at once.
  const maybeCleanupStale = useCallback(() => {
    const now = Date.now();
    if (now - lastCleanupRef.current > CLEANUP_THROTTLE_MS) {
      lastCleanupRef.current = now;
      void supabase.rpc("cleanup_stale_participants");
    }
  }, []);

  // Drift-correction resync — re-fetches both game_state and the full
  // participants roster from the DB directly, discarding whatever the
  // local Realtime-driven state currently says. Wired up below to fire
  // when a tab becomes visible again and when a Realtime channel
  // reconnects after having dropped, so a missed UPDATE/INSERT/DELETE
  // during a disconnect never leaves the UI stuck on stale state.
  const resyncAll = useCallback(() => {
    void fetchGameStateSnapshot();
    void fetchParticipantsSnapshot();
  }, [fetchGameStateSnapshot, fetchParticipantsSnapshot]);

  // Fetch initial game state + recent messages
  useEffect(() => {
    fetchGameStateSnapshot().then(() => setIsLoaded(true));

    supabase
      .from("chat_messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (data) {
          setMessages(data.map((r) => ({
            id: r.id,
            nickname: r.nickname,
            message: r.message,
            kind: (r.kind ?? "chat") as MessageKind,
            timestamp: new Date(r.created_at).getTime(),
          })));
        }
      });

    void fetchParticipantsSnapshot();
  }, [fetchGameStateSnapshot, fetchParticipantsSnapshot]);

  // Resync on tab foreground — reuses the same visibilitychange moment
  // app/lib/serverClock.ts already resyncs the clock offset on, for the
  // same reason: a backgrounded/suspended tab can miss Realtime events
  // entirely while asleep.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") resyncAll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [resyncAll]);

  // Realtime: game state changes
  useEffect(() => {
    let hasConnectedOnce = false;
    const ch = supabase
      .channel("game_state_rt")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_state" }, (p) => {
        applyDbRow(p.new as unknown as DbRow);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // A second (or later) SUBSCRIBED on the same channel instance
          // means the socket dropped and came back — not the initial
          // connect — so re-sync from the DB in case anything was missed
          // while disconnected.
          if (hasConnectedOnce) resyncAll();
          hasConnectedOnce = true;
        }
      });
    return () => { supabase.removeChannel(ch); };
  }, [applyDbRow, resyncAll]);

  // Realtime: participants join/leave. Deliberately does NOT subscribe to
  // UPDATE — heartbeat() below updates participants.last_seen every 30s
  // per connected client, and postgres_changes has no way to filter "only
  // when a specific column changed"; subscribing to UPDATE would broadcast
  // every single heartbeat to every connected client (at 1000 concurrent
  // users, ~33 heartbeats/sec fan-out to 1000 subscribers each), which is
  // exactly the kind of Realtime fan-out load this diff-based rework
  // exists to reduce, not add back at a different layer. The cost: a
  // participant's role change via re-join (spectator <-> participant, no
  // leave in between) isn't reflected in *other* clients' local map until
  // the next resyncAll() (visibility/reconnect) — joinGame() below updates
  // the acting client's own map entry immediately, so only cross-client
  // visibility of someone else's role change is deferred, not lost.
  useEffect(() => {
    let hasConnectedOnce = false;
    const ch = supabase
      .channel("participants_rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "participants" }, (p) => {
        const row = p.new as { guest_id: string; role: Role };
        participantsMapRef.current.set(row.guest_id, row.role);
        recomputeParticipantCounts();
        maybeCleanupStale();
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "participants" }, (p) => {
        // Default REPLICA IDENTITY means the DELETE payload's old record
        // only carries the primary key (guest_id) — that's all this needs.
        const row = p.old as { guest_id: string };
        participantsMapRef.current.delete(row.guest_id);
        recomputeParticipantCounts();
        maybeCleanupStale();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (hasConnectedOnce) resyncAll();
          hasConnectedOnce = true;
        }
      });
    return () => { supabase.removeChannel(ch); };
  }, [recomputeParticipantCounts, maybeCleanupStale, resyncAll]);

  // Realtime: new chat messages
  useEffect(() => {
    const ch = supabase
      .channel("chat_rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (p) => {
        const r = p.new as { id: string; nickname: string; message: string; kind: string; created_at: string };
        setMessages((prev) => [
          ...prev,
          { id: r.id, nickname: r.nickname, message: r.message, kind: (r.kind ?? "chat") as MessageKind, timestamp: new Date(r.created_at).getTime() },
        ]);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Price tick during game phase
  useEffect(() => {
    if (phase !== "game" || !gameStartedAt) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    const update = () => {
      const { price, stage } = calcPriceAndStage(gameAtRef.current!, configRef.current);
      setCurrentPrice(price);
      setDropStage(stage);
    };
    update();
    tickRef.current = setInterval(update, 500);
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
  }, [phase, gameStartedAt]);

  // Auto-transition: strategy → game when countdown ends. Every connected
  // client runs this same check independently, so more than one can hit the
  // "time's up" condition around the same moment — start_game() (see
  // supabase/migrations/20260910090000_server_clock_sync.sql) is a single
  // atomic `update ... where phase = 'strategy'`, the same race guard the
  // old client-side `.eq("phase","strategy")` had, just now inside the RPC
  // and stamping game_started_at with the server's own now() instead of
  // whichever caller's clock happened to win.
  useEffect(() => {
    if (phase !== "strategy" || !strategyStartedAt) return;
    const check = () => {
      const elapsed = Math.floor((getServerNow() - strategyStartedAt) / 1000);
      if (elapsed >= configRef.current.strategyDuration) {
        supabase.rpc("start_game").then(() => {});
      }
    };
    check();
    const t = setInterval(check, 1000);
    return () => clearInterval(t);
  }, [phase, strategyStartedAt]);

  // Heartbeat: update last_seen every 30s
  useEffect(() => {
    if (!currentUser) return;
    const ping = () => {
      supabase
        .from("participants")
        .update({ last_seen: new Date().toISOString() })
        .eq("guest_id", currentUser.guestId)
        .then(() => {});
    };
    ping();
    const t = setInterval(ping, 30_000);
    return () => clearInterval(t);
  }, [currentUser]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const joinGame = useCallback(async (nickname: string, role: Role) => {
    // Identity comes from the Supabase Auth session (auth.uid()), never a
    // client-generated id — the bootstrap effect above should already have
    // one ready, but cover the race where joinGame() runs before it resolves.
    let { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      session = data.session;
    }
    const guestId = session!.user.id;
    const user: CurrentUser = { guestId, nickname, role };

    // Register participant — join_game() validates role/nickname and uses
    // auth.uid() itself, rejecting role='participant' for an Anonymous Auth
    // session server-side (not just the /join page's UI gate). It also
    // atomically flips game_state waiting -> strategy itself, server-side,
    // when p_role is 'participant' (Phase 6) — a spectator-only first
    // arrival never advances the phase. This replaces the old client-side
    // check-then-act UPDATE (unguarded, client-clock timestamp) that used
    // to live here.
    const { error: joinError } = await supabase.rpc("join_game", {
      p_role: role,
      p_nickname: nickname,
    });
    if (joinError) throw joinError;

    // A re-join by an already-registered participant is an UPDATE at the
    // DB level (upsert on the guest_id PK), not an INSERT — and the
    // participants_rt channel deliberately doesn't subscribe to UPDATE
    // (see that effect's comment). So a role change via re-join wouldn't
    // otherwise reach this client's own local count until the next
    // resyncAll(); reflect it in the local map immediately here instead.
    // A genuinely new join is already covered by the INSERT Realtime event
    // this same client receives back for its own insert, so this is only
    // load-bearing for the re-join/role-change case.
    participantsMapRef.current.set(guestId, role);
    recomputeParticipantCounts();

    setCurrentUser(user);
    localStorage.setItem("dtb_guest", JSON.stringify(user));
    // Signal to strategy page redirect guard: don't kick on first mount
    sessionStorage.setItem("dtb_joining", "1");

    // Read back whatever the phase now actually is (post-RPC) and reflect
    // it locally immediately, so the strategy page redirect guard sees the
    // right phase before Realtime's UPDATE event arrives.
    const { data } = await supabase.from("game_state").select("phase, strategy_started_at").eq("id", 1).single();
    if (data?.phase) {
      const mapped: Phase = data.phase === "waiting" ? "home" : (data.phase as Phase);
      setPhase(mapped);
      if (data.strategy_started_at) setStrategyStartedAt(new Date(data.strategy_started_at).getTime());
    }
    // The entry-announcement system message is now inserted inside
    // join_game() itself (Phase 4) — a client can no longer produce a
    // kind='system' chat row directly.
  }, [recomputeParticipantCounts]);

  const leaveGame = useCallback(async () => {
    const guestId = userRef.current?.guestId;
    if (guestId) {
      await supabase.from("participants").delete().eq("guest_id", guestId);
    }
    setCurrentUser(null);
    localStorage.removeItem("dtb_guest");
  }, []);

  const sendMessage = useCallback(async (message: string) => {
    // send_chat_message() (Phase 4) derives identity (auth.uid()) and
    // nickname (the caller's own participants row) itself — a client can
    // no longer supply either, or a kind other than 'chat'. Errors (not
    // joined, empty/too-long message, rate limit) are swallowed here,
    // matching this function's existing fire-and-forget behavior — it
    // never surfaced insert errors to the UI before this either.
    await supabase.rpc("send_chat_message", { p_message: message });
  }, []);

  const addLocalMessage = useCallback((msg: ChatMessage) => {
    // Scripted lounge/chat/narrator ids (e.g. "lounge-0") are only unique per
    // page mount — the firing refs that guard them live on the strategy page
    // and reset on remount, while this messages array (and its ids) persist
    // across navigation. Re-fired ids land here again on rejoin; drop them
    // rather than let React see two children with the same key.
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  }, []);

  const raiseHand = useCallback(async (): Promise<boolean> => {
    // claim_winner() takes no params (Identity Phase 2) — it uses auth.uid()
    // to find the caller's own participants row and recomputes the price
    // itself from server now(), never trusting a client-supplied identity
    // or price. RPC handles UPDATE + chat insert atomically; returns true
    // only if this client won.
    const { data, error } = await supabase.rpc("claim_winner");
    return !error && data === true;
  }, []);

  // startGame()/"바로시작" (client-triggered force-start) removed — Phase 6
  // makes start_game() itself time-gated (only succeeds once the strategy
  // period has actually elapsed per the DB's own now()), so an
  // unconditional client-triggered force-start no longer belongs on a page
  // every user can reach. The auto-transition effect above still calls
  // supabase.rpc("start_game") directly and just ignores a false result —
  // that's expected/normal until the timer genuinely elapses, not an
  // error. Admin-only force-start is now a separate, session-gated path:
  // see app/admin/(protected)/page.tsx + /api/admin/force-start-game.

  // updateConfig()/resetGame() (anon-client writes to game_state /
  // chat_messages / participants) removed — Phase 5 moves both to
  // service-role-backed server routes (/api/admin/update-config,
  // /api/admin/reset-game), gated by a verified admin session. The
  // non-admin "경매 실패" failure-popup flow no longer performs a global
  // DB reset at all (see app/strategy/page.tsx) — it only clears local
  // state and leaves the game via leaveGame() below (own row only).

  const state: GameState = {
    config,
    phase,
    currentUser,
    currentPrice,
    dropStage,
    winner,
    chatMessages: messages,
    strategyStartedAt,
    gameStartedAt,
    participantCount,
    spectatorCount,
    isLoaded,
  };

  return (
    <GameContext.Provider value={{ state, joinGame, leaveGame, sendMessage, addLocalMessage, raiseHand }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}

export function formatKRW(amount: number): string {
  return "₩" + new Intl.NumberFormat("ko-KR").format(amount);
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return (
    d.getHours().toString().padStart(2, "0") +
    ":" +
    d.getMinutes().toString().padStart(2, "0")
  );
}
