"use client";

import BottomNav from "../components/BottomNav";

export default function MiniGamePage() {
  return (
    <main className="min-h-screen bg-[#fffbf5] flex flex-col max-w-md mx-auto pb-24">
      <div className="px-4 pt-12">
        <h1 className="text-2xl font-black text-gray-900 mb-2">미니게임</h1>
        <p className="text-gray-400 text-sm">곧 제공됩니다.</p>
      </div>
      <BottomNav />
    </main>
  );
}
