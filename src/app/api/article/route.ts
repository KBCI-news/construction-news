import { NextRequest, NextResponse } from "next/server";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import sanitizeHtml from "sanitize-html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type ArticleContent = {
  ok: boolean;
  title: string | null;
  byline: string | null;
  contentHtml: string | null;
  excerpt: string | null;
  leadImage: string | null;
  host: string | null;
  url: string;
};

const ALLOWED = {
  allowedTags: [
    "p", "br", "h1", "h2", "h3", "h4", "ul", "ol", "li", "blockquote",
    "strong", "em", "b", "i", "span", "figure", "figcaption", "img", "a",
    "table", "thead", "tbody", "tr", "td", "th",
  ],
  allowedAttributes: {
    img: ["src", "alt"],
    a: ["href", "target", "rel"],
  },
  allowedSchemes: ["http", "https"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      target: "_blank",
      rel: "noopener noreferrer",
    }),
  },
};

function metaContent(doc: Document, key: string): string | null {
  const el =
    doc.querySelector(`meta[property="${key}"]`) ??
    doc.querySelector(`meta[name="${key}"]`);
  return el?.getAttribute("content") ?? null;
}

// 지연 로딩 이미지(data-src 등)를 실제 src로 끌어올린다.
function resolveLazyImages(doc: Document, baseUrl: string) {
  doc.querySelectorAll("img").forEach((img) => {
    const lazy =
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      img.getAttribute("data-lazy-src");
    if (lazy && !img.getAttribute("src")) img.setAttribute("src", lazy);
    const src = img.getAttribute("src");
    if (src) {
      try {
        img.setAttribute("src", new URL(src, baseUrl).toString());
      } catch {
        /* keep as-is */
      }
    }
  });
}

// 네이버 뉴스 페이지는 구조가 일정해 전용 셀렉터로 안정적으로 추출한다.
function extractNaver(doc: Document): { title: string | null; html: string | null } {
  const title =
    doc.querySelector("#title_area")?.textContent?.trim() ||
    doc.querySelector("h2.media_end_head_headline")?.textContent?.trim() ||
    null;
  const body =
    doc.querySelector("#dic_area") ||
    doc.querySelector("#newsct_article") ||
    doc.querySelector("._article_content") ||
    doc.querySelector("#comp_news_article");
  return { title, html: body?.innerHTML ?? null };
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  let host: string | null = null;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  const fail = (): NextResponse =>
    NextResponse.json(
      {
        ok: false,
        title: null,
        byline: null,
        contentHtml: null,
        excerpt: null,
        leadImage: null,
        host,
        url,
      } satisfies ArticleContent,
      { headers: { "Cache-Control": "public, s-maxage=300" } },
    );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return fail();
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return fail();
    html = await res.text();
  } catch {
    return fail();
  } finally {
    clearTimeout(timer);
  }

  let title: string | null = null;
  let byline: string | null = null;
  let contentHtml: string | null = null;
  let excerpt: string | null = null;
  let leadImage: string | null = null;

  try {
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;
    leadImage = metaContent(doc, "og:image");
    resolveLazyImages(doc, url);

    const isNaver = host?.includes("naver.com");
    if (isNaver) {
      const naver = extractNaver(doc);
      title = naver.title;
      contentHtml = naver.html;
    }

    if (!contentHtml) {
      // 범용 본문 추출
      const article = new Readability(doc).parse();
      if (article) {
        title = title || article.title || null;
        byline = article.byline ?? null;
        contentHtml = article.content ?? null;
        excerpt = article.excerpt ?? null;
      }
    }

    title = title || metaContent(doc, "og:title") || doc.title || null;
  } catch {
    return fail();
  }

  if (!contentHtml) return fail();

  const clean = sanitizeHtml(contentHtml, ALLOWED).trim();
  if (!clean) return fail();

  return NextResponse.json(
    {
      ok: true,
      title,
      byline,
      contentHtml: clean,
      excerpt,
      leadImage,
      host,
      url,
    } satisfies ArticleContent,
    { headers: { "Cache-Control": "public, s-maxage=3600" } },
  );
}
