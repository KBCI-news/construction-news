import { NextRequest, NextResponse } from "next/server";
import { SEARCH_TOPICS } from "@/lib/categories";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hostOf } from "@/lib/format";
import { fetchOgImage } from "@/lib/og";
import type { NaverNewsItem } from "@/app/api/naver-news/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NAVER_ENDPOINT = "https://openapi.naver.com/v1/search/news.json";
const PER_KEYWORD = 100;

// 이미지 크롤링은 비용이 크므로 한 번의 실행에서 이미지가 없는 기사만,
// 최대 MAX_IMAGE_CRAWL개까지 동시 IMAGE_CONCURRENCY개씩 처리한다.
// (30분마다 실행되며 여러 회차에 걸쳐 점진적으로 채워진다)
const MAX_IMAGE_CRAWL = 80;
const IMAGE_CONCURRENCY = 10;

type ArticleUpsert = {
  link: string;
  original_link: string | null;
  title: string;
  description: string | null;
  pub_date: string;
  source_host: string | null;
  categories: string[];
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) return unauthorized();

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Naver API credentials are not configured" },
      { status: 500 },
    );
  }

  const tasks = SEARCH_TOPICS.map((t) => ({
    categoryId: t.category,
    keyword: t.term,
  }));

  let fetchedCount = 0;
  const failures: { keyword: string; status: number }[] = [];

  const fetchWithRetry = async (
    keyword: string,
  ): Promise<NaverNewsItem[]> => {
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
      if (response.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
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
  const results: { categoryId: string; items: NaverNewsItem[] }[] = [];
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async ({ categoryId, keyword }) => ({
        categoryId,
        items: await fetchWithRetry(keyword),
      })),
    );
    results.push(...batchResults);
    if (i + BATCH_SIZE < tasks.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const byKey = new Map<string, ArticleUpsert>();
  for (const { categoryId, items } of results) {
    for (const item of items) {
      const key = item.link;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.categories.includes(categoryId)) {
          existing.categories.push(categoryId);
        }
      } else {
        byKey.set(key, {
          link: item.link,
          original_link: item.originallink || null,
          title: item.title,
          description: item.description || null,
          pub_date: new Date(item.pubDate).toISOString(),
          source_host: hostOf(item.originallink || item.link),
          categories: [categoryId],
        });
      }
    }
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

  // 이미지가 아직 없는 기사 일부에 대해 og:image 백필
  const imagesFilled = await backfillImages(supabase);

  const { error: purgeError } = await supabase.rpc("purge_old_articles");
  await supabase.rpc("purge_old_search_logs");
  if (purgeError) {
    return NextResponse.json(
      {
        ok: true,
        warning: "Purge failed",
        detail: purgeError.message,
        fetched: fetchedCount,
        unique: rows.length,
        upserted: upsertedCount,
        imagesFilled,
        failures,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    fetched: fetchedCount,
    unique: rows.length,
    upserted: upsertedCount,
    imagesFilled,
    failures,
  });
}

// 이미지가 없는 최신 기사들의 원문에서 og:image를 추출해 채운다.
async function backfillImages(
  supabase: ReturnType<typeof getSupabaseAdmin>,
): Promise<number> {
  const { data, error } = await supabase
    .from("articles")
    .select("link, original_link")
    .is("image_url", null)
    .order("pub_date", { ascending: false })
    .limit(MAX_IMAGE_CRAWL);

  if (error || !data || data.length === 0) return 0;

  const targets = data as { link: string; original_link: string | null }[];
  let filled = 0;

  for (let i = 0; i < targets.length; i += IMAGE_CONCURRENCY) {
    const batch = targets.slice(i, i + IMAGE_CONCURRENCY);
    const resolved = await Promise.all(
      batch.map(async (row) => {
        const pageUrl = row.original_link || row.link;
        const image = await fetchOgImage(pageUrl);
        return { link: row.link, image };
      }),
    );
    await Promise.all(
      resolved
        .filter((r) => r.image)
        .map(async (r) => {
          const { error: updateError } = await supabase
            .from("articles")
            .update({ image_url: r.image })
            .eq("link", r.link);
          if (!updateError) filled += 1;
        }),
    );
  }

  return filled;
}
