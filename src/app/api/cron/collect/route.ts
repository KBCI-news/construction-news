import { NextRequest, NextResponse } from "next/server";
import { CATEGORIES } from "@/lib/categories";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hostOf } from "@/lib/format";
import type { NaverNewsItem } from "@/app/api/naver-news/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NAVER_ENDPOINT = "https://openapi.naver.com/v1/search/news.json";
const PER_KEYWORD = 100;

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

  const tasks = CATEGORIES.flatMap((category) =>
    category.keywords.map((keyword) => ({
      categoryId: category.id,
      keyword,
    })),
  );

  let fetchedCount = 0;
  const failures: { keyword: string; status: number }[] = [];

  const results = await Promise.all(
    tasks.map(async ({ categoryId, keyword }) => {
      const url = `${NAVER_ENDPOINT}?query=${encodeURIComponent(keyword)}&display=${PER_KEYWORD}&sort=date`;
      const response = await fetch(url, {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
        cache: "no-store",
      });
      if (!response.ok) {
        failures.push({ keyword, status: response.status });
        return { categoryId, items: [] as NaverNewsItem[] };
      }
      const data = (await response.json()) as { items: NaverNewsItem[] };
      fetchedCount += data.items.length;
      return { categoryId, items: data.items };
    }),
  );

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

  const { error: purgeError } = await supabase.rpc("purge_old_articles");
  if (purgeError) {
    return NextResponse.json(
      {
        ok: true,
        warning: "Purge failed",
        detail: purgeError.message,
        fetched: fetchedCount,
        unique: rows.length,
        upserted: upsertedCount,
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
    failures,
  });
}
