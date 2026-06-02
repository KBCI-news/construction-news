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

// srcset 후보 중 가장 큰 해상도의 URL을 고른다.
function pickFromSrcset(srcset: string): string | null {
  const cands = srcset
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const parts = s.split(/\s+/);
      const w = parts[1]?.endsWith("w") ? parseInt(parts[1], 10) : 0;
      return { url: parts[0], w: Number.isNaN(w) ? 0 : w };
    })
    .filter((c) => c.url);
  if (!cands.length) return null;
  cands.sort((a, b) => b.w - a.w);
  return cands[0].url;
}

const PLACEHOLDER_SRC = /data:image|blank|spacer|1x1|loading|transparent|;base64,/i;

// 스크립트/스타일/광고/위젯 등 비본문 요소를 추출 전에 제거한다.
function stripNonContent(doc: Doc) {
  Array.from(
    doc.querySelectorAll("script, style, noscript, iframe, form, ins, svg, button"),
  ).forEach((el) => el.remove());
}

function resolveLazyImages(doc: Doc, baseUrl: string) {
  // <picture><source srcset> → 가장 큰 후보를 형제 img에 반영
  Array.from(
    doc.querySelectorAll("picture source[srcset], picture source[data-srcset]"),
  ).forEach((s) => {
    const ss = s.getAttribute("srcset") || s.getAttribute("data-srcset");
    const img = s.closest("picture")?.querySelector("img");
    if (ss && img) {
      const u = pickFromSrcset(ss);
      if (u) img.setAttribute("src", u);
    }
  });

  Array.from(doc.querySelectorAll("img")).forEach((img) => {
    const cur = img.getAttribute("src");
    const lazy =
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      img.getAttribute("data-lazy-src") ||
      img.getAttribute("data-echo") ||
      img.getAttribute("data-lazyload") ||
      img.getAttribute("data-url");
    if (lazy && (!cur || PLACEHOLDER_SRC.test(cur))) img.setAttribute("src", lazy);

    const ss = img.getAttribute("srcset") || img.getAttribute("data-srcset");
    const now = img.getAttribute("src");
    if (ss && (!now || PLACEHOLDER_SRC.test(now))) {
      const u = pickFromSrcset(ss);
      if (u) img.setAttribute("src", u);
    }

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

// 본문 끝에 붙는 기자 바이라인·저작권·홍보(구독/공유) 문구를 제거한다.
const COPY_RE =
  /(무단\s*전재|재배포\s*금지|저작권자|ⓒ|©|copyright|all rights reserved)/i;
const PROMO_RE =
  /(구독하기|네이버에서.*구독|카카오톡|페이스북|트위터|기사\s*제보|제보하기|앱\s*다운|뉴스레터|좋아요|공유하기|기사 추천)/;
const EMAIL_RE = /[\w.+-]+@[\w.-]+\.\w{2,}/;
const BYLINE_RE = /^[[(<【]?\s*[가-힣]{2,4}\s*(기자|특파원|논설위원|편집위원|인턴기자)\b/;
const SENTENCE_END_RE = /[다요음함됨임죠죵]\.?$/; // 본문 문장은 보통 이렇게 끝남
// 언론사 페이지의 UI 위젯(글자크기 조절, 스크랩, 공유 등)이 본문에 섞이는 것 제거
const UI_RE =
  /(글자\s*크기|글씨\s*크기|폰트\s*크기|기사\s*스크랩|스크랩하기|인쇄하기|프린트하기|url\s*복사|메일로\s*보내기)/i;
// 관련기사/추천/많이 본 등 본문이 아닌 묶음의 머리말
const RELATED_RE =
  /^(관련\s*기사|관련뉴스|추천\s*기사|많이\s*본|인기\s*기사|이전\s*기사|다음\s*기사|핫클릭|주요\s*뉴스|함께\s*볼만한|포토뉴스)/;
// 비본문 위젯 컨테이너 (클래스/아이디 관용 패턴)
const JUNK_SELECTOR = [
  "[class*='reporter']",
  "[class*='journalist']",
  "[class*='copyright']",
  "[class*='related']",
  "[id*='related']",
  "[class*='recommend']",
  "[class*='promotion']",
  "[class*='share']",
  "[class*='sns']",
  "[class*='newsletter']",
  "[class*='subscribe']",
  "[role='complementary']",
].join(", ");

function isJunk(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  // 글자크기 버튼("가") 등 의미 없는 초단문 UI
  if (t === "가" || t === "가가" || t === "가나다") return true;
  if (COPY_RE.test(t) && t.length < 200) return true;
  if (t.length <= 60 && PROMO_RE.test(t)) return true;
  if (t.length <= 60 && UI_RE.test(t)) return true;
  if (t.length <= 40 && RELATED_RE.test(t)) return true;
  // 광고/홍보성 머리기호로 시작하는 짧은 줄
  if (t.length <= 80 && /^[▶☞※■▷]/.test(t)) return true;
  // 바이라인: "이종용 기자", "홍길동 기자 hong@x.com" 등 (문장형은 제외)
  if (t.length <= 35 && BYLINE_RE.test(t) && !SENTENCE_END_RE.test(t)) return true;
  // 이메일만 있는 짧은 줄
  if (t.length <= 40 && EMAIL_RE.test(t) && !SENTENCE_END_RE.test(t)) return true;
  return false;
}

function cleanContent(html: string): string {
  const { document } = parseHTML(`<div id="__root">${html}</div>`);
  const root = document.getElementById("__root");
  if (!root) return html;
  // 비본문 위젯(광고/관련기사/SNS/기자영역 등) 컨테이너 제거
  Array.from(root.querySelectorAll(JUNK_SELECTOR)).forEach((el) => el.remove());
  // 다른 블록/미디어를 품지 않은 '잎' 요소만 검사해 컨테이너 통째 삭제를 방지
  const candidates = Array.from(
    root.querySelectorAll("p, span, div, figcaption, em, small, a, h4, h5, h6"),
  );
  for (const el of candidates) {
    if (el.querySelector("p, div, ul, ol, table, img, figure, blockquote")) {
      continue;
    }
    if (isJunk(el.textContent ?? "")) el.remove();
  }
  // 빈 문단 정리
  Array.from(root.querySelectorAll("p")).forEach((p) => {
    if (!(p.textContent ?? "").trim() && !p.querySelector("img")) p.remove();
  });
  return root.innerHTML;
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
    stripNonContent(document);
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
    const clean = sanitizeHtml(cleanContent(contentHtml), ALLOWED).trim();
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
