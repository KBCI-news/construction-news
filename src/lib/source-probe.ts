import { NextRequest, NextResponse } from "next/server";

// 외부 출처 도달성 진단 — 국회 의안 API, 금융위·금감원 보도자료를 이 서버(Vercel 함수)가 실제로
// 열 수 있는지, 지역(기본 / 서울 icn1)별로 응답 코드·시간·앞부분을 본다. 운영 화면과 무관하다.
// 국회 API는 공개 시험 키(KEY=sample, 최대 10행)만 쓴다 — 실제 키는 여기서 쓰지 않는다.
const TARGETS: { name: string; url: string }[] = [
  { name: "fsc_rss_press", url: "https://www.fsc.go.kr/about/fsc_bbs_rss/?fid=0111" },
  { name: "fsc_list_press", url: "https://www.fsc.go.kr/no010101" },
  { name: "fss_list_press", url: "https://www.fss.or.kr/fss/bbs/B0000188/list.do?menuNo=200218" },
  {
    name: "assembly_member_bills_sample",
    url: "https://open.assembly.go.kr/portal/openapi/nzmimeepazxkubdpn?KEY=sample&Type=json&pIndex=1&pSize=3&AGE=22",
  },
  { name: "likms_main", url: "https://likms.assembly.go.kr/bill/main.do" },
  {
    name: "datagokr_billinfo_nokey",
    url: "https://apis.data.go.kr/9710000/BillInfoService2/getRecentRceptList?numOfRows=1&pageNo=1",
  },
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function probeOne(name: string, url: string) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "*/*", "accept-language": "ko-KR,ko;q=0.9" },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    const text = await res.text();
    const items = (text.match(/<item[\s>]/g) ?? []).length;
    const rows = (text.match(/<tr[\s>]/g) ?? []).length;
    return {
      name,
      status: res.status,
      ms: Date.now() - started,
      bytes: text.length,
      items,
      rows,
      head: text.replace(/\s+/g, " ").slice(0, 220),
    };
  } catch (e) {
    const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
    return {
      name,
      status: 0,
      ms: Date.now() - started,
      error: [err.name, err.message, err.cause?.code, err.cause?.message].filter(Boolean).join(" | "),
    };
  }
}

export async function probeSources(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await Promise.all(TARGETS.map((t) => probeOne(t.name, t.url)));
  return NextResponse.json(
    { region: process.env.VERCEL_REGION ?? null, at: new Date().toISOString(), results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
