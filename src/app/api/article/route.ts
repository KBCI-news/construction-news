import { NextRequest, NextResponse } from "next/server";
import { parseHTML } from "linkedom";
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

const ALLOWED: sanitizeHtml.IOptions = {
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

type Doc = ReturnType<typeof parseHTML>["document"];

function metaContent(doc: Doc, key: string): string | null {
  const el =
    doc.querySelector(`meta[property="${key}"]`) ??
    doc.querySelector(`meta[name="${key}"]`);
  return el?.getAttribute("content") ?? null;
}

function resolveLazyImages(doc: Doc, baseUrl: string) {
  Array.from(doc.querySelectorAll("img")).forEach((img) => {
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

function extractNaver(doc: Doc): { title: string | null; html: string | null } {
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

function absolutize(src: string, base: string): string | null {
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

// 단일 URL에서 본문을 가져와 추출한다. 실패 시 null.
async function extract(target: string): Promise<ArticleContent | null> {
  let host: string | null = null;
  try {
    host = new URL(target).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let html: string;
  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    html = await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  try {
    const { document } = parseHTML(html);
    const leadImageRaw = metaContent(document, "og:image");
    const leadImage = leadImageRaw ? absolutize(leadImageRaw, target) : null;
    resolveLazyImages(document, target);

    let title: string | null = null;
    let byline: string | null = null;
    let contentHtml: string | null = null;
    let excerpt: string | null = null;

    if (host?.includes("naver.com")) {
      const naver = extractNaver(document);
      title = naver.title;
      contentHtml = naver.html;
    }

    if (!contentHtml) {
      const article = new Readability(
        document as unknown as Document,
      ).parse();
      if (article) {
        title = title || article.title || null;
        byline = article.byline ?? null;
        contentHtml = article.content ?? null;
        excerpt = article.excerpt ?? null;
      }
    }

    title = title || metaContent(document, "og:title") || document.title || null;

    if (!contentHtml) return null;
    const clean = sanitizeHtml(contentHtml, ALLOWED).trim();
    if (!clean) return null;

    return {
      ok: true,
      title,
      byline,
      contentHtml: clean,
      excerpt,
      leadImage,
      host,
      url: target,
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  const fallback = request.nextUrl.searchParams.get("fallback");
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  let host: string | null = null;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  // 기본 URL 시도 → 실패하면 원문(언론사) 링크로 재시도
  let result = await extract(url);
  if (!result && fallback && fallback !== url) {
    result = await extract(fallback);
  }

  if (result) {
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=3600" },
    });
  }

  return NextResponse.json(
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
}
