// Suspense 폴백 — 정적 라우트는 useSearchParams 때문에 첫 HTML이 이 폴백만 담는다. 빈 회색 화면 대신 목록 모양을 먼저 보인다
export function ListSkeleton({ toolbarHeight }: { toolbarHeight: number }) {
  return (
    <div className="space-y-3 sm:space-y-4" aria-busy="true">
      <p className="sr-only">불러오는 중…</p>
      <div className="card" style={{ height: toolbarHeight }} />
      <section className="card p-4 sm:p-6">
        <div className="mb-3 h-6 w-28 animate-pulse rounded bg-gray-200" />
        <div className="divide-y divide-[var(--line)]">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="py-3.5 sm:py-5">
              <div className="h-[22px] w-16 animate-pulse rounded-full bg-gray-200" />
              <div className="mt-2 h-5 w-full animate-pulse rounded bg-gray-200" />
              <div className="mt-1.5 h-5 w-2/3 animate-pulse rounded bg-gray-200" />
              <div className="mt-2.5 h-4 w-32 animate-pulse rounded bg-gray-100" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
