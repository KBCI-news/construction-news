import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false },
    global: {
      // Next.js 14는 라우트 핸들러 안의 fetch를 기본으로 Data Cache에 저장하고,
      // 이 캐시는 배포를 넘어 유지된다. supabase-js가 내부적으로 fetch를 쓰는데
      // /api/indicators처럼 쿼리 URL이 매번 같은 조회는 응답이 통째로 박제됐다
      // (지표 3개짜리 옛 응답이 새 배포에서도 계속 서빙된 실제 사고).
      // DB 조회는 항상 실시간이어야 하므로 캐시를 전면 차단한다.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return cached;
}

export type ArticleRow = {
  id: string;
  link: string;
  original_link: string | null;
  title: string;
  description: string | null;
  pub_date: string;
  source_host: string | null;
  categories: string[];
  image_url: string | null;
  collected_at: string;
  // 큐레이션 엔진(0004_curation.sql)에서 추가된 컬럼
  importance: number | null;
  importance_tier: string | null;
  urgent: boolean;
  desks: string[];
  kinds: string[];
  matched_terms: string[];
  cluster_id: string | null;
  cluster_hosts: number;
  is_rep: boolean;
  scored_at: string | null;
};
