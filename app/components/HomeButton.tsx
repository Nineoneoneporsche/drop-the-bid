"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const HomeIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
    <polyline points="9 21 9 12 15 12 15 21"/>
  </svg>
);

export default function HomeButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const button = (
    <Link
      href="/"
      aria-label="메인화면"
      className="fixed top-3 left-4 z-40 inline-flex items-center justify-center w-8 h-8 text-white active:scale-95 transition-transform"
    >
      <HomeIcon size={20} />
    </Link>
  );

  // Portal to document.body so `fixed` positions relative to the viewport,
  // not a card-rise-animated (transformed) ancestor some pages wrap this in
  // — a transformed ancestor becomes the containing block for `fixed`
  // descendants, which would make the button scroll away with that card
  // instead of staying put.
  return mounted ? createPortal(button, document.body) : null;
}
