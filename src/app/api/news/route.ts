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
    .select("link,original_link,title,description,pub_date,categories")
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
    "link" | "original_link" | "title" | "description" | "pub_date" | "categories"
  >[];

  const items: NewsResponseItem[] = rows.map((r) => ({
    link: r.link,
    originallink: r.original_link ?? r.link,
    title: r.title,
    description: r.description ?? "",
    pubDate: r.pub_date,
    categories: r.categories ?? [],
  }));

  if (items.length === 0) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    let role = "parse-fail";
    try {
      const payload = JSON.parse(
        Buffer.from(key.split(".")[1] ?? "", "base64").toString(),
      );
      role = payload.role ?? "no-role";
    } catch {}
    return NextResponse.json({
      total: 0,
      items: [],
      debug: {
        keyRole: role,
        urlPrefix: (process.env.SUPABASE_URL ?? "").slice(0, 40),
        dataIsNull: data === null,
        rawLength: data?.length ?? null,
      },
    });
  }

  return NextResponse.json({ total: items.length, items });
}
