import { NextRequest, NextResponse } from "next/server";
import { POLL_MINUTES, QUERY_TERMS } from "@/lib/lexicon";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hostOf } from "@/lib/format";
import { scoreArticle } from "@/lib/scoring";
import type { NaverNewsItem } from "@/app/api/naver-news/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NAVER_ENDPOINT = "https://openapi.naver.com/v1/search/news.json";
const PER_KEYWORD = 100;

// 한 회차에 호출할 검색어 상한 — 분산 후 한 슬롯 최대치(T0 전부 + T1의 1/4 +
// 하위 티어 몇 개)를 넉넉히 덮는다. 이 값에 걸려 잘리면 응답의 dropped에 남는다.
const MAX_QUERIES_PER_RUN = 48;

type ArticleUpsert = {
  link: string;
  original_link: string | null;
  title: string;
  description: string | null;
  pub_date: string;
  source_host: string | null;
  categories: string[];
  desks: string[];
  kinds: string[];
  matched_terms: string[];
  importance: number;
  importance_tier: string;
  urgent: boolean;
  reasons: unknown;
  importance_parts: unknown;
  scored_at: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * 이번 회차에 호출할 검색어를 티어별 주기에 따라 고른다.
 * 분 단위 시계를 30분 슬롯으로 쓰고, 주기 안의 슬롯들에 티어의 검색어를
 * 나눠 싣는다 — T1(120분)이면 68개를 네 슬롯에 17개씩. 예전에는 한 슬롯에
 * 티어 전체를 몰아 넣고 상한에서 잘라, T1 54개(KB국민카드·신용정보사·
 * 전세사기 등)가 한 번도 호출되지 않았다.
 */
function dueTerms(nowMinutes: number) {
  const slotIndex = Math.floor(nowMinutes / 30);
  const due: typeof QUERY_TERMS = [];
  for (const tier of [0, 1, 2, 3] as const) {
    const slots = Math.max(1, POLL_MINUTES[tier] / 30);
    QUERY_TERMS.filter((t) => t.tier === tier).forEach((t, i) => {
      if (i % slots === slotIndex % slots) due.push(t);
    });
  }
  return {
    tasks: due.slice(0, MAX_QUERIES_PER_RUN),
    dropped: due.slice(MAX_QUERIES_PER_RUN).map((t) => t.term),
  };
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return unauthorized();
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Naver API credentials are not configured" },
      { status: 500 },
    );
  }

  const nowMs = Date.now();
  const { tasks, dropped } = dueTerms(Math.floor(nowMs / 60_000));

  let fetchedCount = 0;
  const failures: { keyword: string; status: number }[] = [];

  const fetchWithRetry = async (keyword: string): Promise<NaverNewsItem[]> => {
    const url = `${NAVER_ENDPOINT}?query=${encodeURIComponent(keyword)}&display=${PER_KEYWORD}&sort=date`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(url, {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
        cache: "no-store",
      });
      if (response.ok) {
        const data = (await response.json()) as { items: NaverNewsItem[] };
        fetchedCount += data.items.length;
        return data.items;
      }
      // 429는 지수 백오프로 재시도 — 조용히 실패하지 않게 한다
      if (response.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
        continue;
      }
      failures.push({ keyword, status: response.status });
      return [];
    }
    return [];
  };

  // 배치당 5개씩, 배치 간 800ms — 네이버 rate limit 회피
  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 800;
  const collected: NaverNewsItem[] = [];
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((t) => fetchWithRetry(t.term)));
    batchResults.forEach((items) => collected.push(...items));
    if (i + BATCH_SIZE < tasks.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // 링크 기준 중복 제거 + 수집 시점에 사전 태깅·1차 채점
  // (클러스터 기반 보도량은 /api/cron/score 가 나중에 보정한다)
  const byKey = new Map<string, ArticleUpsert>();
  for (const item of collected) {
    if (byKey.has(item.link)) continue;
    const res = scoreArticle({
      title: item.title,
      description: item.description,
      pubDate: item.pubDate,
      sourceHost: hostOf(item.originallink || item.link),
      now: nowMs,
    });
    byKey.set(item.link, {
      link: item.link,
      original_link: item.originallink || null,
      title: item.title,
      description: item.description || null,
      pub_date: new Date(item.pubDate).toISOString(),
      source_host: hostOf(item.originallink || item.link),
      categories: [],
      desks: res.desks,
      kinds: res.kinds,
      matched_terms: res.matchedTerms.slice(0, 40),
      importance: res.score,
      importance_tier: res.tier,
      urgent: res.urgent,
      reasons: res.reasons,
      importance_parts: res.parts,
      scored_at: new Date(nowMs).toISOString(),
    });
  }

  const rows = Array.from(byKey.values());
  const supabase = getSupabaseAdmin();

  let upsertedCount = 0;
  if (rows.length > 0) {
    const { error, count } = await supabase
      .from("articles")
      .upsert(rows, { onConflict: "link", count: "exact" });
    if (error) {
      return NextResponse.json(
        { error: "Supabase upsert failed", detail: error.message },
        { status: 500 },
      );
    }
    upsertedCount = count ?? rows.length;
  }

  // 썸네일 채우기는 /api/cron/images가 따로 돈다

  const { error: purgeError } = await supabase.rpc("purge_old_articles");
  await supabase.rpc("purge_old_search_logs");

  return NextResponse.json({
    ok: true,
    queriesRun: tasks.length,
    ...(dropped.length ? { dropped } : {}),
    fetched: fetchedCount,
    unique: rows.length,
    upserted: upsertedCount,
    failures,
    ...(purgeError ? { warning: "Purge failed", detail: purgeError.message } : {}),
  });
}
