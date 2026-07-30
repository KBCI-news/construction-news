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
