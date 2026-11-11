import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

// Only real, completed drops may ever be listed here. The page used to show
// hardcoded sample results (products, prices, buyer names, participant
// counts that never happened), which reads as a sales record — so until
// real results are wired up it shows an empty state.
export default function ResultsPage() {
  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center pb-28">
      <div className="w-full max-w-md px-4 pt-10">

        <div className="flex mb-5">
          <HomeButton />
        </div>

        <div className="mb-8">
          <h1 className="text-[22px] font-extrabold text-white leading-tight">지난 결과</h1>
          <p className="text-white/65 text-base mt-2">실제로 진행된 드랍의 판매 결과만 기록합니다.</p>
        </div>

        <div className="bg-[#141414] border border-white/10 rounded-2xl px-5 py-10 text-center">
          <p className="text-white/80 text-base font-semibold">아직 진행된 드랍이 없습니다</p>
          <p className="text-white/50 text-sm mt-2">첫 드랍이 끝나면 결과가 이곳에 표시됩니다.</p>
          <Link
            href="/"
            className="inline-block mt-6 px-4 py-2.5 text-white text-base font-semibold rounded-xl transition-opacity active:opacity-80"
            style={{ background: "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)" }}
          >
            예정된 드랍 보기 →
          </Link>
        </div>

      </div>
      <BottomNav />
    </main>
  );
}
