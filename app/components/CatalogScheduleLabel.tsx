"use client";

import { useGame } from "../context/GameContext";
import { catalogItemByName, type CatalogItem } from "../lib/dropCatalog";

// A catalog item's schedule text, except while that item is the live drop
// (game_state.product_name matches it and the round is in phase 'game'):
// then it says so instead of the static "드랍 예정 · 일정 미정".
export default function CatalogScheduleLabel({ item, short = false }: { item: CatalogItem; short?: boolean }) {
  const { state } = useGame();
  const live = state.phase === "game" && catalogItemByName(state.config.productName)?.id === item.id;
  if (live) return <>드랍 진행 중</>;
  return <>{short ? item.scheduleLabel.replace("드랍 예정 · ", "") : item.scheduleLabel}</>;
}
