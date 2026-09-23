"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

// Explainer slides — user-authored images, filename order is the intended
// reading order (설명1 → 설명7). Each is already a finished slide (title +
// screenshot baked in), so no overlay/caption is added on top of them.
const SLIDE_COUNT = 7;
const SLIDES = Array.from({ length: SLIDE_COUNT }, (_, i) => `/설명${i + 1}.png`);

// Matches every 설명N.png's actual pixel size — keeps aspect-ratio correct
// without needing to probe each image at runtime.
const IMAGE_ASPECT = "842 / 1806";

export default function GuidePage() {
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartScrollLeft = useRef(0);
  const didDrag = useRef(false);

  /* scroll-reveal */
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("card-visible"); observer.unobserve(e.target); }
      }),
      { threshold: 0.06, rootMargin: "0px 0px -32px 0px" }
    );
    cardRefs.current.forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);
  const setRef = (i: number) => (el: HTMLElement | null) => { cardRefs.current[i] = el; };

  // Tracks which slide is centered as the user swipes/drags/scrolls, for
  // the dot indicator — native scroll (touch swipe, wheel) already moves
  // scrollLeft on its own, this just observes it.
  const updateActiveFromScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    setActiveIndex(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  const scrollToSlide = useCallback((index: number, smooth = true) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Desktop mouse-drag-to-scroll. Touch already scrolls the track natively
  // (it's a plain overflow-x-auto element) — this only adds the mouse case.
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = trackRef.current;
    if (!el) return;
    isDragging.current = true;
    didDrag.current = false;
    dragStartX.current = e.clientX;
    dragStartScrollLeft.current = el.scrollLeft;
    el.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const el = trackRef.current;
    if (!el) return;
    const dx = e.clientX - dragStartX.current;
    if (Math.abs(dx) > 3) didDrag.current = true;
    el.scrollTo({ left: dragStartScrollLeft.current - dx, behavior: "auto" });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const el = trackRef.current;
    if (el && el.clientWidth > 0) {
      scrollToSlide(Math.round(el.scrollLeft / el.clientWidth));
    }
    el?.releasePointerCapture(e.pointerId);
  }, [scrollToSlide]);

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center pb-20">
      <div className="w-full max-w-md px-4 pt-10">

        <div ref={setRef(0)} className="card-rise flex mb-5">
          <HomeButton />
        </div>

        <div ref={setRef(1)} className="card-rise mb-6" style={{ transitionDelay: "60ms" }}>
          <h1 className="text-[22px] font-extrabold text-white leading-tight">게임방법</h1>
          <p className="text-base text-white/65 mt-2">가격이 내려가는 순간, 먼저 누른 사람이 임자!</p>
        </div>

        {/* Explainer carousel */}
        <div ref={setRef(2)} className="card-rise mb-3 relative" style={{ transitionDelay: "120ms" }}>
          <div
            ref={trackRef}
            onScroll={updateActiveFromScroll}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className="flex overflow-x-auto snap-x snap-mandatory rounded-2xl select-none no-scrollbar"
            style={{ cursor: "grab" }}
          >
            {SLIDES.map((src, i) => (
              <div key={src} className="w-full flex-shrink-0 snap-center flex justify-center">
                <div className="relative w-[80%]" style={{ aspectRatio: IMAGE_ASPECT }}>
                  <Image
                    src={src}
                    alt={`게임방법 설명 ${i + 1}`}
                    fill
                    draggable={false}
                    sizes="(max-width: 448px) 80vw, 358px"
                    style={{ objectFit: "contain" }}
                    priority={i === 0}
                    loading={i === 0 ? undefined : "eager"}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Desktop-only nudge arrows — small, low-key, never shown on mobile */}
          {activeIndex > 0 && (
            <button
              onClick={() => scrollToSlide(activeIndex - 1)}
              aria-label="이전 설명"
              className="hidden md:flex items-center justify-center absolute left-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-black/60 transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>chevron_left</span>
            </button>
          )}
          {activeIndex < SLIDE_COUNT - 1 && (
            <button
              onClick={() => scrollToSlide(activeIndex + 1)}
              aria-label="다음 설명"
              className="hidden md:flex items-center justify-center absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-black/60 transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>chevron_right</span>
            </button>
          )}
        </div>

        {/* Dot indicator */}
        <div className="flex items-center justify-center gap-1.5 mb-8">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => scrollToSlide(i)}
              aria-label={`${i + 1}번째 설명으로 이동`}
              className="p-1"
            >
              <span
                className="block rounded-full transition-all"
                style={{
                  width: i === activeIndex ? "16px" : "6px",
                  height: "6px",
                  background: i === activeIndex ? "#a855f7" : "rgba(255,255,255,0.25)",
                }}
              />
            </button>
          ))}
        </div>

        {/* CTAs */}
        <div ref={setRef(3)} className="card-rise flex flex-col gap-2" style={{ transitionDelay: "180ms" }}>
          <Link href="/practice" className="w-full py-4 text-white font-semibold text-base text-center bid-btn-purple rounded-xl">
            모의훈련 해보기
          </Link>
          <Link href="/" className="w-full py-4 font-semibold text-base text-center border border-white/12 text-white/55 rounded-xl transition-colors hover:border-white/25 hover:text-white/80">
            오늘의 DTB 보기 →
          </Link>
        </div>

      </div>
      <BottomNav />
    </main>
  );
}
