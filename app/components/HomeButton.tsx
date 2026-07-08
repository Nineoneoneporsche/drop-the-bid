"use client";

import Link from "next/link";

export default function HomeButton() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-xs text-gray-400 border border-gray-200 rounded-xl px-3 py-1.5 bg-white hover:border-orange-300 hover:text-orange-500 transition-colors shadow-sm"
    >
      ← 메인화면
    </Link>
  );
}
