"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  {
    href: "/guide",
    label: "게임방법",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
  },
  {
    href: "/practice",
    label: "모의훈련",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="6"/>
        <circle cx="12" cy="12" r="2"/>
      </svg>
    ),
  },
  {
    href: "/results",
    label: "지난결과",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 3 18 9"/>
        <path d="M6 9h12v6a6 6 0 0 1-12 0V9z"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="15" x2="12" y2="21"/>
      </svg>
    ),
  },
  {
    href: "/mini-game",
    label: "미니게임",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="6"/>
        <line x1="8" y1="12" x2="12" y2="12"/>
        <line x1="10" y1="10" x2="10" y2="14"/>
        <circle cx="16" cy="11" r="1" fill="currentColor" stroke="none"/>
        <circle cx="18" cy="13" r="1" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    href: "/mypage",
    label: "My Page",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  },
];

// Safari parses `backdrop-filter: url(#x)` as syntactically valid but then
// fails to render it at all — silently dropping blur along with it, not
// just the SVG part. CSS `@supports` can't tell the difference (it only
// checks parse validity), so this has to be a real engine check: WebKit
// browsers (Safari on any Apple device, including Chrome-for-iOS — every
// iOS browser is WebKit under the hood) never get the distortion class.
function supportsSvgBackdropFilter() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isWebkit = /AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS|Edg/.test(ua);
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  return !isWebkit && !isIOS;
}

export default function BottomNav() {
  const pathname = usePathname();
  const [distort, setDistort] = useState(false);
  useEffect(() => setDistort(supportsSvgBackdropFilter()), []);

  return (
    <div className="fixed bottom-4 inset-x-0 z-40 flex justify-center pointer-events-none px-4">
      {/* Hidden SVG filter — feTurbulence + feDisplacementMap bends whatever
          sits behind the nav through the frosted glass, like the reference.
          Only referenced (via the liquid-glass-nav--distort class above)
          on engines that actually render it; see supportsSvgBackdropFilter. */}
      <svg aria-hidden style={{ position: "absolute", width: 0, height: 0 }}>
        <filter id="glass-distortion" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="2" seed="8" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="3" result="blurredNoise" />
          <feDisplacementMap in="SourceGraphic" in2="blurredNoise" scale="45" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <nav
        className={`liquid-glass-nav w-full max-w-md pointer-events-auto rounded-full overflow-hidden ${distort ? "liquid-glass-nav--distort" : ""}`}
        style={{ height: 60 }}
      >
        <ul className="flex h-full">
          {NAV_ITEMS.map(({ href, label, icon }) => {
            const active = pathname === href;
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  className={`flex flex-col items-center justify-center h-full gap-0.5 transition-opacity active:opacity-50 ${
                    active ? "text-[#4ade80]" : "text-white/55"
                  }`}
                >
                  {icon}
                  <span className="text-xs font-semibold leading-none">
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
