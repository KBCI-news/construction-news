// 기사 원문 페이지의 <head>에서 대표 이미지(og:image)를 추출한다.
// 네이버 뉴스 검색 API는 이미지를 제공하지 않아, 수집 시점에 원문을 가볍게 긁어
// 메타 태그만 파싱한다. 실패하면 null을 반환하고 프론트에서 placeholder로 대체한다.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function matchMeta(html: string, key: string): string | null {
  // property/name 속성이 content 앞/뒤 어느 쪽에 와도 잡히도록 두 패턴을 시도.
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function absolutize(src: string, base: string): string | null {
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

export async function fetchOgImage(
  pageUrl: string,
  timeoutMs = 2500,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    // 메타 태그는 head에 있으므로 앞부분만 읽어도 충분하다.
    const html = (await res.text()).slice(0, 120_000);
    const raw =
      matchMeta(html, "og:image") ??
      matchMeta(html, "og:image:url") ??
      matchMeta(html, "twitter:image") ??
      matchMeta(html, "twitter:image:src");
    if (!raw) return null;

    const decoded = raw
      .replace(/&amp;/g, "&")
      .replace(/&#x2F;/g, "/")
      .replace(/&#38;/g, "&");
    return absolutize(decoded, pageUrl);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
