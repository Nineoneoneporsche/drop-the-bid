import Image from "next/image";
import type { CSSProperties } from "react";

// 게임/모의훈련 화면의 배경 — 예전 배경 영상 대신 홈과
// 같은 무대 이미지를 천천히 움직이게(stage-drift, globals.css) 보여준다.
// still이면 움직임·확대 없이 고정으로 깐다 (본게임 /strategy).
// 부모가 position(absolute/relative)과 크기를 정한다.
export default function StageBackdrop({ opacity, objectPosition = "center top", still = false }: { opacity?: number; objectPosition?: CSSProperties["objectPosition"]; still?: boolean }) {
  return (
    <Image
      src="/finalmainimage.png"
      alt=""
      aria-hidden
      fill
      sizes="(max-width: 448px) 100vw, 448px"
      className={still ? "object-cover" : "stage-drift object-cover"}
      style={{ opacity, objectPosition }}
    />
  );
}
