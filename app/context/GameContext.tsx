"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

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

export interface GameConfig {
  productName: string;
  startPrice: number;
  dropAmount: number;
  floorPrice: number;       // maps to DB minimum_price
  strategyDuration: number;
  gameStartTime: string | null;
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
  winner: { id: string; nickname: string; price: number } | null;
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
};


interface GameContextValue {
  state: GameState;
  joinGame: (nickname: string, role: Role) => Promise<void>;
  leaveGame: () => Promise<void>;
  sendMessage: (nickname: string, message: string, kind?: MessageKind) => Promise<void>;
  addLocalMessage: (msg: ChatMessage) => void;
  raiseHand: (nickname: string, price: number) => Promise<boolean>;
  startGame: () => Promise<void>;
  resetGame: () => Promise<void>;
  updateConfig: (config: Partial<GameConfig>) => Promise<void>;
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
};

function rowToConfig(row: DbRow): GameConfig {
  return {
    productName:      row.product_name      ?? DEFAULT_CONFIG.productName,
    startPrice:       row.start_price       ?? DEFAULT_CONFIG.startPrice,
    dropAmount:       row.drop_amount       ?? DEFAULT_CONFIG.dropAmount,
    floorPrice:       row.minimum_price     ?? DEFAULT_CONFIG.floorPrice,
    strategyDuration: row.strategy_duration ?? DEFAULT_CONFIG.strategyDuration,
    gameStartTime: row.scheduled_start_at ?? null,
  };
}

function calcPrice(gameStartedAt: number, config: GameConfig): number {
  const elapsed = Math.floor((Date.now() - gameStartedAt) / 1000);
  return Math.max(config.floorPrice, config.startPrice - elapsed * config.dropAmount);
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase]               = useState<Phase>("home");
  const [config, setConfig]             = useState<GameConfig>(DEFAULT_CONFIG);
  const [currentUser, setCurrentUser]   = useState<CurrentUser | null>(null);
  const [currentPrice, setCurrentPrice] = useState(DEFAULT_CONFIG.startPrice);
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
  configRef.current  = config;
  gameAtRef.current  = gameStartedAt;
  userRef.current    = currentUser;

  const applyDbRow = useCallback((row: DbRow) => {
    const mappedPhase: Phase = row.phase === "waiting" ? "home" : (row.phase as Phase);
    const cfg = rowToConfig(row);
    const stratAt = row.strategy_started_at ? new Date(row.strategy_started_at).getTime() : null;
    const gameAt  = row.game_started_at     ? new Date(row.game_started_at).getTime()     : null;
    const w = row.winner_id
      ? { id: row.winner_id, nickname: row.winner_nickname ?? "", price: row.winner_price ?? 0 }
      : null;

    setPhase(mappedPhase);
    setConfig(cfg);
    setStrategyStartedAt(stratAt);
    setGameStartedAt(gameAt);
    setWinner(w);
    if (gameAt) setCurrentPrice(calcPrice(gameAt, cfg));
    else setCurrentPrice(cfg.startPrice);
  }, []);

  // Load current game guest from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("dtb_guest");
      if (saved) setCurrentUser(JSON.parse(saved) as CurrentUser);
    } catch {}
  }, []);

  const refreshCounts = useCallback(async () => {
    // Remove stale participants (no heartbeat in 90s)
    await supabase
      .from("participants")
      .delete()
      .lt("last_seen", new Date(Date.now() - 90_000).toISOString());

    const { data } = await supabase.from("participants").select("role");
    if (!data) return;
    setParticipantCount(data.filter((r) => r.role === "participant").length);
    setSpectatorCount(data.filter((r) => r.role === "spectator").length);
  }, []);

  // Fetch initial game state + recent messages
  useEffect(() => {
    supabase
      .from("game_state")
      .select("*")
      .eq("id", 1)
      .single()
      .then(({ data }) => {
        if (data) applyDbRow(data as unknown as DbRow);
        setIsLoaded(true);
      });

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

    refreshCounts();
  }, [applyDbRow, refreshCounts]);

  // Realtime: game state changes
  useEffect(() => {
    const ch = supabase
      .channel("game_state_rt")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_state" }, (p) => {
        applyDbRow(p.new as unknown as DbRow);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [applyDbRow]);

  // Realtime: participants join/leave
  useEffect(() => {
    const ch = supabase
      .channel("participants_rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "participants" }, () => refreshCounts())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "participants" }, () => refreshCounts())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refreshCounts]);

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
    const update = () => setCurrentPrice(calcPrice(gameAtRef.current!, configRef.current));
    update();
    tickRef.current = setInterval(update, 500);
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
  }, [phase, gameStartedAt]);

  // Auto-transition: strategy → game when countdown ends
  useEffect(() => {
    if (phase !== "strategy" || !strategyStartedAt) return;
    const check = () => {
      const elapsed = Math.floor((Date.now() - strategyStartedAt) / 1000);
      if (elapsed >= configRef.current.strategyDuration) {
        supabase
          .from("game_state")
          .update({ phase: "game", game_started_at: new Date().toISOString() })
          .eq("id", 1)
          .eq("phase", "strategy")
          .then(() => {});
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
    const guestId = crypto.randomUUID();
    const user: CurrentUser = { guestId, nickname, role };
    setCurrentUser(user);
    localStorage.setItem("dtb_guest", JSON.stringify(user));
    // Signal to strategy page redirect guard: don't kick on first mount
    sessionStorage.setItem("dtb_joining", "1");

    // Register participant
    await supabase.from("participants").insert({ guest_id: guestId, nickname, role });

    // Start strategy phase if game is waiting; set local phase immediately
    // so the strategy page redirect guard sees the correct phase before Realtime arrives
    const { data } = await supabase.from("game_state").select("phase, strategy_started_at").eq("id", 1).single();
    if (data?.phase === "waiting") {
      const strategyAt = new Date().toISOString();
      await supabase
        .from("game_state")
        .update({ phase: "strategy", strategy_started_at: strategyAt })
        .eq("id", 1);
      setPhase("strategy");
      setStrategyStartedAt(new Date(strategyAt).getTime());
    } else if (data?.phase) {
      const mapped: Phase = data.phase === "waiting" ? "home" : (data.phase as Phase);
      setPhase(mapped);
      if (data.strategy_started_at) setStrategyStartedAt(new Date(data.strategy_started_at).getTime());
    }

    // Announce entry
    await supabase.from("chat_messages").insert({
      guest_id: guestId,
      nickname: "system",
      message: `${nickname}님이 ${role === "participant" ? "참여자로" : "관전자로"} 입장했습니다 👋`,
      kind: "system",
    });
  }, []);

  const leaveGame = useCallback(async () => {
    const guestId = userRef.current?.guestId;
    if (guestId) {
      await supabase.from("participants").delete().eq("guest_id", guestId);
    }
    setCurrentUser(null);
    localStorage.removeItem("dtb_guest");
  }, []);

  const sendMessage = useCallback(async (nickname: string, message: string, kind: MessageKind = "chat") => {
    const guestId = userRef.current?.guestId ?? null;
    await supabase.from("chat_messages").insert({ guest_id: guestId, nickname, message, kind });
  }, []);

  const addLocalMessage = useCallback((msg: ChatMessage) => {
    // Scripted lounge/chat/narrator ids (e.g. "lounge-0") are only unique per
    // page mount — the firing refs that guard them live on the strategy page
    // and reset on remount, while this messages array (and its ids) persist
    // across navigation. Re-fired ids land here again on rejoin; drop them
    // rather than let React see two children with the same key.
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  }, []);

  const raiseHand = useCallback(async (nickname: string, price: number): Promise<boolean> => {
    const guestId = userRef.current?.guestId ?? null;
    // RPC handles UPDATE + chat insert atomically; returns true only if this client won
    const { data, error } = await supabase.rpc("claim_winner", {
      p_guest_id: guestId,
      p_nickname: nickname,
      p_price:    price,
    });
    return !error && data === true;
  }, []);

  const startGame = useCallback(async () => {
    await supabase
      .from("game_state")
      .update({ phase: "game", game_started_at: new Date().toISOString() })
      .eq("id", 1)
      .eq("phase", "strategy");
  }, []);

  const updateConfig = useCallback(async (newConfig: Partial<GameConfig>) => {
    const updates: Record<string, unknown> = {};
    if (newConfig.productName      !== undefined) updates.product_name      = newConfig.productName;
    if (newConfig.startPrice       !== undefined) updates.start_price       = newConfig.startPrice;
    if (newConfig.dropAmount       !== undefined) updates.drop_amount       = newConfig.dropAmount;
    if (newConfig.floorPrice       !== undefined) updates.minimum_price     = newConfig.floorPrice;
    if (newConfig.strategyDuration !== undefined) updates.strategy_duration = newConfig.strategyDuration;
    if (newConfig.gameStartTime    !== undefined) updates.scheduled_start_at = newConfig.gameStartTime || null;
    await supabase.from("game_state").update(updates).eq("id", 1);
  }, []);

  const resetGame = useCallback(async () => {
    setCurrentUser(null);
    setMessages([]);
    localStorage.removeItem("dtb_guest");
    await supabase.from("chat_messages").delete().gte("created_at", "1970-01-01");
    await supabase.from("participants").delete().gte("joined_at", "1970-01-01");
    await supabase.from("game_state").update({
      phase: "waiting",
      strategy_started_at: null,
      game_started_at: null,
      winner_id: null,
      winner_nickname: null,
      winner_price: null,
    }).eq("id", 1);
  }, []);

  const state: GameState = {
    config,
    phase,
    currentUser,
    currentPrice,
    winner,
    chatMessages: messages,
    strategyStartedAt,
    gameStartedAt,
    participantCount,
    spectatorCount,
    isLoaded,
  };

  return (
    <GameContext.Provider value={{ state, joinGame, leaveGame, sendMessage, addLocalMessage, raiseHand, startGame, resetGame, updateConfig }}>
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
