"use client";

import Image from "next/image";
import { useState } from "react";

function Fallback({ className = "" }: { className?: string }) {
  return (
    <div className={`w-full h-full flex items-center justify-center bg-orange-50 ${className}`}>
      <span className="text-4xl select-none">📱</span>
    </div>
  );
}

/**
 * Hero / fill variant — place inside a `relative` container with an explicit height.
 * Uses fill layout so the image stretches to fill the container.
 */
export function ProductImageFill({
  alt,
  className = "object-contain p-4",
  priority = false,
}: {
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  const [err, setErr] = useState(false);
  if (err) return <Fallback />;

  return (
    <Image
      src="/product.png"
      alt={alt}
      fill
      // Max container width is 448 px (max-w-md); serve 2× for retina
      sizes="(max-width: 480px) 100vw, 480px"
      className={className}
      priority={priority}
      onError={() => setErr(true)}
    />
  );
}

/**
 * Thumbnail variant — fixed pixel dimensions, no fill.
 * Use `size` for square thumbnails; pass `width`+`height` for non-square.
 */
export function ProductThumb({
  alt,
  size = 56,
  width,
  height,
  className = "object-contain",
  rounded = "rounded-xl",
}: {
  alt: string;
  size?: number;
  width?: number;
  height?: number;
  className?: string;
  rounded?: string;
}) {
  const [err, setErr] = useState(false);
  const w = width ?? size;
  const h = height ?? size;

  if (err) {
    return (
      <div
        style={{ width: w, height: h, minWidth: w }}
        className={`flex items-center justify-center bg-orange-50 flex-shrink-0 ${rounded}`}
      >
        <span style={{ fontSize: Math.round(w * 0.45) }}>📱</span>
      </div>
    );
  }

  return (
    <Image
      src="/product.png"
      alt={alt}
      width={w * 2}   // 2× for retina, displayed via CSS at w×h
      height={h * 2}
      sizes={`${w}px`}
      className={`${className} ${rounded} flex-shrink-0`}
      style={{ width: w, height: h, minWidth: w }}
      onError={() => setErr(true)}
    />
  );
}
