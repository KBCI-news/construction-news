import { NextResponse } from "next/server";
import { getSupabaseAdmin, type ArticleRow } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export type NewsResponseItem = {
  link: string;
  originallink: string;
  title: string;
  description: string;
  pubDate: string;
  categories: string[];
  imageUrl: string | null;
};

const MAX_ITEMS = 1000;

export async function GET() {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Supabase not configured" },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .from("articles")
    .select(
      "link,original_link,title,description,pub_date,categories,image_url",
    )
    .order("pub_date", { ascending: false })
    .range(0, MAX_ITEMS - 1);

  if (error) {
    return NextResponse.json(
      { error: "Failed to read articles", detail: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as Pick<
    ArticleRow,
    | "link"
    | "original_link"
    | "title"
    | "description"
    | "pub_date"
    | "categories"
    | "image_url"
  >[];

  const items: NewsResponseItem[] = rows.map((r) => ({
    link: r.link,
    originallink: r.original_link ?? r.link,
    title: r.title,
    description: r.description ?? "",
    pubDate: r.pub_date,
    categories: r.categories ?? [],
    imageUrl: r.image_url ?? null,
  }));

  return NextResponse.json({ total: items.length, items });
}
