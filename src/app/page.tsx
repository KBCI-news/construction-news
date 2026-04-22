import NewsList from "@/components/NewsList";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <h1 className="text-2xl font-bold text-gray-900">KBCI 뉴스</h1>
          <p className="mt-1 text-sm text-gray-500">
            KB신용정보 사내 공유용 뉴스 모니터링
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-8">
        <NewsList />
      </div>
    </main>
  );
}
