"use client";

import Link from "next/link";

export default function HomeButton() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-xs font-medium text-white/30 hover:text-white/70 transition-colors"
    >
      ← 메인화면
    </Link>
  );
}
