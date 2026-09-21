"use client";

import { useEffect, useRef, useState } from "react";

// Recording-only touch indicator for capturing demo footage. Mounted once
// in app/layout.tsx so it covers every page, not just /strategy. Fully
// self-contained and inert unless ?demo=1 is in the URL (or was on an
// earlier page this same tab session — see sessionStorage below) — reads
// that itself (rather than useSearchParams(), which would force whichever
// page it's on into a Suspense boundary) so the host layout needs nothing
// beyond mounting this component unconditionally. Delete this file and
// its one <TouchIndicator /> call site in app/layout.tsx to remove the
// feature entirely once recording is done.
interface Ripple {
  id: number;
  x: number;
  y: number;
}

const SESSION_KEY = "dtb_demo_indicator";

export default function TouchIndicator() {
  const [enabled, setEnabled] = useState(false);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextId = useRef(0);

  // ?demo=1 only survives the page it's typed on — a real recording run
  // navigates through several pages (join → strategy → payment, ...),
  // some of which are full navigations that remount this component fresh.
  // sessionStorage carries "demo mode is on" across all of them for the
  // rest of this tab's session; closing the tab clears it on its own, no
  // explicit off-switch needed for a recording-only feature like this.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("demo") === "1";
    if (fromUrl) {
      try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* private mode etc. — fall through */ }
      setEnabled(true);
      return;
    }
    let fromSession = false;
    try { fromSession = sessionStorage.getItem(SESSION_KEY) === "1"; } catch { /* ignore */ }
    setEnabled(fromSession);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // Bubble-phase, no preventDefault/stopPropagation — purely observes
    // pointerdown, never alters how it's handled anywhere else on the page.
    const handlePointerDown = (e: PointerEvent) => {
      const id = nextId.current++;
      setRipples((prev) => [...prev, { id, x: e.clientX, y: e.clientY }]);
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, 400);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="fixed inset-0 z-[999] pointer-events-none" aria-hidden="true">
      {ripples.map((r) => (
        <span key={r.id} style={{ left: r.x, top: r.y }} className="dtb-touch-ripple-wrap">
          {/* Crisp dot right on the touch point — makes the exact spot
              unmistakable even on a small phone-screen recording. */}
          <span className="dtb-touch-ripple-dot" />
          {/* Expanding ring for the ripple motion. */}
          <span className="dtb-touch-ripple-ring" />
        </span>
      ))}
      <style jsx>{`
        .dtb-touch-ripple-wrap {
          position: fixed;
          left: 0;
          top: 0;
          width: 0;
          height: 0;
        }
        .dtb-touch-ripple-dot,
        .dtb-touch-ripple-ring {
          position: absolute;
          left: 0;
          top: 0;
          border-radius: 9999px;
          transform: translate(-50%, -50%);
        }
        .dtb-touch-ripple-dot {
          width: 14px;
          height: 14px;
          background: #ffffff;
          animation: dtb-touch-dot-anim 400ms ease-out forwards;
        }
        .dtb-touch-ripple-ring {
          width: 16px;
          height: 16px;
          background: rgba(168, 85, 247, 0.55);
          border: 2.5px solid rgba(255, 255, 255, 0.95);
          animation: dtb-touch-ring-anim 400ms ease-out forwards;
        }
        @keyframes dtb-touch-dot-anim {
          0% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          60% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(0.6);
            opacity: 0;
          }
        }
        @keyframes dtb-touch-ring-anim {
          from {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          to {
            transform: translate(-50%, -50%) scale(4.5);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
