import Image from "next/image";
import type { CatalogItem } from "../lib/dropCatalog";

// Product photo, or the category icon until a real photo exists.
export default function CatalogThumb({ item, size }: { item: CatalogItem; size: number }) {
  return (
    <div
      className="relative flex-shrink-0 flex items-center justify-center rounded-lg overflow-hidden bg-white/[0.06] border border-white/10"
      style={{ width: size, height: size }}
    >
      {item.image ? (
        <Image src={item.image} alt={item.name} fill sizes={`${size}px`} className="object-contain p-1.5" />
      ) : (
        <span className="material-symbols-outlined text-white/60" style={{ fontSize: Math.round(size * 0.45) }} aria-hidden>
          {item.icon}
        </span>
      )}
    </div>
  );
}
