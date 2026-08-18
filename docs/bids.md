# 입찰공고 모니터링

문서 전자화(스캔)·전자문서 보관·임대차조사·권리조사 — 우리가 실제로 응찰하는
4개 사업의 공고를 나라장터에서 **1시간마다** 자동으로 확인한다.

| 구성 | 위치 |
| --- | --- |
| 판정 사전·매칭 | `src/lib/bids.ts` |
| 나라장터 API 클라이언트 | `src/lib/g2b.ts` |
| 수집 크론 | `src/app/api/cron/bids/route.ts` |
| 조회 API | `src/app/api/bids/route.ts` |
| 화면 | `/bids` (`src/components/BidsClient.tsx`) |
| 스케줄 | `.github/workflows/bids.yml` (`5 * * * *`) |
| 스키마 | `supabase/migrations/0009_bids.sql`, `0010_bids_current.sql` |

## 1. 서비스키 발급

1. 공공데이터포털에서 **조달청_나라장터 입찰공고정보서비스** 활용신청
   <https://www.data.go.kr/data/15129394/openapi.do> — 무료, 자동승인
2. 발급된 키를 Vercel 환경변수 `G2B_SERVICE_KEY`에 등록 (Production/Preview)
   - 인코딩 키·디코딩 키 중 **아무거나** 넣으면 된다. `%`가 들어 있으면
     인코딩 키로 보고 그대로 쓰고, 없으면 코드가 인코딩한다.
3. Supabase에 `0009_bids.sql` 적용
4. GitHub 저장소 시크릿은 뉴스 크론과 동일한 `CRON_SECRET`, `CRON_URL`을 쓴다

키가 없으면 `/api/cron/bids`는 즉시 `skipped`를 반환한다. 즉 **키 등록 전에도
사이트는 정상**이고, `/bids` 화면은 "아직 수집 기록이 없습니다"로 뜬다.

## 2. 수집 방식

- 오퍼레이션: `getBidPblancListInfoServc`(용역), `getBidPblancListInfoThng`(물품).
  문서 전자화·조사 용역은 대부분 용역이고, 스캐너·저장장치는 물품으로 올라온다.
- 조회 기준: `inqryDiv=1` (공고게시일시), 창은 기본 **최근 3시간**.
  1시간 주기인데 3시간을 읽는 이유는 GitHub Actions 스케줄이 수십 분씩 밀리고
  공고 등록과 API 색인 시각이 어긋나기 때문이다. `bid_key`(공고번호-차수)
  기준 upsert라 겹쳐 읽어도 중복이 생기지 않는다.
- 엔드포인트 경로는 후보를 순서대로 시도한다. 이 서비스는 버전 경로가
  (`BidPublicInfoService01~04` → `/ad/BidPublicInfoService`) 몇 차례 바뀌어,
  하나만 박아두면 어느 날 조용히 0건이 된다. `G2B_BASE_URL`로 고정할 수도 있다.

## 3. 판정 규칙

공고명만 본다. 수요기관명은 근거로 쓰지 않는다 — 기관 이름으로 사업 성격을
단정하면 오탐이 걷잡을 수 없이 늘어난다.

| 경로 | 조건 | 점수 |
| --- | --- | --- |
| strong | 확정 키워드 1개 (`문서전자화`, `권리조사` …) | 80 |
| weak + context | 모호 키워드 + 동반어 (`스캔` + `기록물`) | 50 |
| deny | 배제어가 있으면 weak 경로를 버린다 (`스캔` + `취약점`) | 탈락 |

근거 term이 여러 개면 최대 +20까지 가산한다. 50점 미만은 저장하지 않는다.

### 어절 경계

term은 **공백을 한 칸으로 살린 형태**로 먼저 찾고, 4자 이상인 term만 공백을
지운 형태로도 찾는다(`DB 구축` ↔ `DB구축`). 공백을 전부 지우고 비교하면
`엘라스토머 모폴로지 분석기`가 `지분`에 걸려 권리조사로 분류되는 사고가
난다 — 실제로 첫 수집에서 났다. 짧은 term일수록 어절을 넘는 유령 매칭
확률이 높아 이렇게 나눴다.

### 표현 수집

실제 공고는 `전자화`보다 `전산화`를, `스캔`보다 `DB구축`을 더 많이 쓴다.
표현을 하나 빠뜨리면 그 공고는 영영 안 보이므로, 추측하지 말고 실물로
확인한다.

```
# 창 안에서 걸리지 않은 공고명을 그대로 본다 — 사전에 뭘 더 넣을지 정할 때
curl -H "Authorization: Bearer $CRON_SECRET" \
  "$SITE/api/cron/bids?hours=24&misses=200"
```
화면에는 항상 **매칭 근거 term을 함께 표시**한다. 담당자가 오판을 즉시
간파할 수 있어야 하기 때문이다.

키워드를 고칠 때는 배포 전에 판정만 따로 확인할 수 있다.

```
curl -H "Authorization: Bearer $CRON_SECRET" \
  "$SITE/api/cron/bids?test=2025년 기록물 전자화 및 DB구축 용역"
```

## 4. 진단

```
# 살아 있는 API 경로와 응답 원형 확인 (필드명이 바뀌었는지 볼 때)
curl -H "Authorization: Bearer $CRON_SECRET" "$SITE/api/cron/bids?probe=1"

# 과거 소급 수집
curl -H "Authorization: Bearer $CRON_SECRET" "$SITE/api/cron/bids?hours=48"

# 창을 직접 지정(KST). 한 회차가 읽는 양에 상한이 있어, 긴 구간은
# 이렇게 며칠씩 잘라서 돌린다.
curl -H "Authorization: Bearer $CRON_SECRET" \
  "$SITE/api/cron/bids?from=202608010000&to=202608030000"

# 업무구분 지정
curl -H "Authorization: Bearer $CRON_SECRET" "$SITE/api/cron/bids?divs=용역"
```

컨테이너 개발 환경에서는 외부 egress가 막혀 있어 실호출 확인은 배포본이나
`API Probe` 워크플로(`.github/workflows/probe.yml`)의 로그로 한다.

`/bids` 화면 상단에는 **마지막 확인 시각**이 상주한다. 0건 회차도
`bid_runs`에 남기므로 "공고가 없는 것"과 "수집이 멈춘 것"을 구분할 수 있다.

## 5. 차수와 취소

같은 공고번호에 차수가 쌓인다. 정정·재공고·취소가 모두 새 차수로 올라오기
때문이다. 이력은 `bids`에 전부 남기고, 화면은 `bids_current` 뷰(공고번호별
최신 차수)를 본다. 최신 차수가 `취소공고`인 건은 '진행중' 목록에서 빼되
'전체'에는 취소 배지와 함께 남긴다 — 지켜보던 공고가 소리 없이 사라지면
안 되기 때문이다.

## 6. 알려진 한계

- 나라장터에 통합 게시되지 않는 일부 기관 자체 공고(일부 공공기관 자체
  조달시스템, 민간 발주)는 잡히지 않는다.
- 공고 상세 링크는 API가 주는 `bidNtceDtlUrl`을 그대로 쓴다. 값이 없으면
  링크 없이 공고번호만 표시한다 — URL을 추측해 만들면 깨진 링크가 된다.
- 사전 매칭이라 신조어·축약 공고명은 놓칠 수 있다. 놓친 공고를 발견하면
  `src/lib/bids.ts`의 `RULES`에 term을 추가한다.
