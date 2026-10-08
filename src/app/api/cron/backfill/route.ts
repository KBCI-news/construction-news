import { NextRequest, NextResponse } from "next/server";
import { QUERY_TERMS } from "@/lib/lexicon";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hostOf } from "@/lib/format";
import { scoreArticle } from "@/lib/scoring";
import { isKeepTerm, keepMatches, naverQueryOf, retentionCutoff } from "@/lib/archive";
import type { NaverNewsItem } from "@/app/api/naver-news/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 과거 기사 소급 수집. 수집 크론은 검색어마다 최신 100건만 보지만, 네이버 뉴스 검색은
// 검색어당 최대 1,000건(start 1~901, 100건씩)까지 내준다 — 그 끝까지 긁어 보관함을
// 채운다. 흔한 검색어(가계대출 등)는 1,000건이 며칠치뿐이고, 드문 검색어(전자문서법·
// KB신용정보)는 몇 년치가 된다. 한 회차에 검색어 몇 개씩 처리하고 next 로 이어 간다.
const NAVER_ENDPOINT = "https://openapi.naver.com/v1/search/news.json";
const PER_PAGE = 100;
const MAX_PAGES = 10;
const DEFAULT_COUNT = 6;
const CONCURRENCY = 3;
const UPSERT_CHUNK = 500;

type Row = {
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
  query_terms: string[];
  keep: boolean;
};

type TermReport = {
  term: string;
  pages: number;
  fetched: number;
  kept: number;
  oldest: string | null;
  newest: string | null;
  status: "ok" | "partial" | "failed";
};

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Naver API credentials are not configured" }, { status: 500 });
  }

  const p = request.nextUrl.searchParams;
  const single = (p.get("term") ?? "").trim();
  const offset = Math.max(0, Math.floor(Number(p.get("offset") ?? 0) || 0));
  const count = Math.min(Math.max(Math.floor(Number(p.get("count") ?? DEFAULT_COUNT) || DEFAULT_COUNT), 1), 12);
  const pages = Math.min(Math.max(Math.floor(Number(p.get("pages") ?? MAX_PAGES) || MAX_PAGES), 1), MAX_PAGES);
  const sort = p.get("sort") === "sim" ? "sim" : "date";
  // quote=1 : 모든 검색어를 따옴표 정확검색으로 — 느슨한 매칭이 1,000건을 금방 채우는
  // 흔한 단어도 정확 일치만 받아 더 과거까지 닿는다(2차 소급용)
  const quoteAll = p.get("quote") === "1";

  const terms = single ? [single] : QUERY_TERMS.slice(offset, offset + count).map((t) => t.term);
  const total = QUERY_TERMS.length;
  const next = single || offset + count >= total ? null : offset + count;

  const startedAt = Date.now();
  const nowMs = startedAt;

  const fetchPage = async (term: string, page: number): Promise<NaverNewsItem[] | null> => {
    const start = (page - 1) * PER_PAGE + 1;
    const query = quoteAll && !term.startsWith('"') ? `"${term}"` : naverQueryOf(term);
    const url = `${NAVER_ENDPOINT}?query=${encodeURIComponent(query)}&display=${PER_PAGE}&start=${start}&sort=${sort}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, {
        headers: { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret },
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { items?: NaverNewsItem[] };
        return data.items ?? [];
      }
      if (res.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1200 * 2 ** attempt));
        continue;
      }
      return null;
    }
    return null;
  };

  // link → 행. 여러 검색어가 같은 기사를 돌려주면 검색어를 합치고 keep 은 OR
  const byLink = new Map<string, Row>();
  const reports: TermReport[] = [];

  const runTerm = async (term: string) => {
    const cutoff = retentionCutoff(term, nowMs).getTime();
    const keepTerm = isKeepTerm(term);
    // 태그가 안 붙는 기사는 어차피 30일 뒤 정리된다 — 그보다 오래된 건 저장하지 않는다
    const generalCutoff = nowMs - 30 * 86_400_000;
    const report: TermReport = { term, pages: 0, fetched: 0, kept: 0, oldest: null, newest: null, status: "ok" };
    for (let page = 1; page <= pages; page++) {
      // 함수 시간 상한(60초) 안에서만 — 남은 페이지는 다음 회차의 같은 offset 으로 다시 돈다
      if (Date.now() - startedAt > 45_000) {
        report.status = "partial";
        break;
      }
      const items = await fetchPage(term, page);
      if (items === null) {
        report.status = report.fetched ? "partial" : "failed";
        break;
      }
      report.pages = page;
      report.fetched += items.length;
      let olderThanCutoff = false;
      for (const item of items) {
        const pub = new Date(item.pubDate);
        if (Number.isNaN(pub.getTime())) continue;
        const iso = pub.toISOString();
        if (!report.newest || iso > report.newest) report.newest = iso;
        if (!report.oldest || iso < report.oldest) report.oldest = iso;
        if (pub.getTime() < cutoff) {
          olderThanCutoff = true;
          continue;
        }
        const keep = keepTerm && keepMatches(item.title, item.description);
        const existing = byLink.get(item.link);
        if (existing) {
          if (!existing.query_terms.includes(term)) existing.query_terms.push(term);
          existing.keep = existing.keep || keep;
          report.kept += 1;
          continue;
        }
        const res = scoreArticle({
          title: item.title,
          description: item.description,
          pubDate: item.pubDate,
          sourceHost: hostOf(item.originallink || item.link),
          now: nowMs,
        });
        if (!keep && res.desks.length === 0 && pub.getTime() < generalCutoff) continue;
        report.kept += 1;
        byLink.set(item.link, {
          link: item.link,
          original_link: item.originallink || null,
          title: item.title,
          description: item.description || null,
          pub_date: iso,
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
          query_terms: [term],
          keep,
        });
      }
      // 최신순이므로 보존 하한을 지나면 그 뒤는 전부 더 오래된 기사 — 멈춘다
      if (items.length < PER_PAGE || (sort === "date" && olderThanCutoff)) break;
    }
    reports.push(report);
  };

  // 검색어 몇 개를 동시에 — 네이버 초당 제한을 넘지 않을 만큼만
  for (let i = 0; i < terms.length; i += CONCURRENCY) {
    await Promise.all(terms.slice(i, i + CONCURRENCY).map(runTerm));
  }

  const rows = Array.from(byLink.values());
  const supabase = getSupabaseAdmin();
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase.from("articles").upsert(chunk, { onConflict: "link" });
    if (error) {
      return NextResponse.json(
        { error: "Backfill upsert failed", detail: error.message, upserted, reports },
        { status: 500 },
      );
    }
    upserted += chunk.length;
  }

  return NextResponse.json({
    ok: true,
    sort,
    quote: quoteAll,
    offset: single ? null : offset,
    count: terms.length,
    total,
    next,
    done: next === null,
    elapsedMs: Date.now() - startedAt,
    upserted,
    terms: reports.sort((a, b) => a.term.localeCompare(b.term)),
  });
}
