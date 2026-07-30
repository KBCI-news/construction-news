import { NextRequest, NextResponse } from "next/server";

export type NaverNewsItem = {
  title: string;
  originallink: string;
  link: string;
  description: string;
  pubDate: string;
};

type NaverApiResponse = {
  lastBuildDate: string;
  total: number;
  start: number;
  display: number;
  items: NaverNewsItem[];
};

const NAVER_ENDPOINT = "https://openapi.naver.com/v1/search/news.json";

async function fetchNaver(
  query: string,
  display: number,
  sort: string,
  clientId: string,
  clientSecret: string,
): Promise<NaverApiResponse> {
  const url = `${NAVER_ENDPOINT}?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`;
  const response = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new NaverApiError(response.status, detail);
  }

  return response.json();
}

class NaverApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(`Naver API error ${status}`);
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = params.get("q");
  const display = Math.min(Number(params.get("display") ?? 30), 100);
  const sort = params.get("sort") === "sim" ? "sim" : "date";

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Naver API credentials are not configured" },
      { status: 500 },
    );
  }

  // 자체 아카이브(/api/feed)에 결과가 없을 때만 쓰는 실시간 보조 검색 경로
  if (!q) {
    return NextResponse.json(
      { error: "Provide 'q' query parameter" },
      { status: 400 },
    );
  }
  const queries: string[] = [q];

  try {
    const results = await Promise.all(
      queries.map((query) =>
        fetchNaver(query, display, sort, clientId, clientSecret),
      ),
    );

    const seen = new Set<string>();
    const items: NaverNewsItem[] = [];
    for (const result of results) {
      for (const item of result.items) {
        const key = item.originallink || item.link;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    }

    items.sort(
      (a, b) =>
        new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime(),
    );

    return NextResponse.json({
      total: items.length,
      items: items.slice(0, display),
    });
  } catch (error) {
    if (error instanceof NaverApiError) {
      return NextResponse.json(
        { error: "Naver API request failed", detail: error.detail },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error: "Failed to fetch from Naver API",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
