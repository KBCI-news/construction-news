"use client";

import { useEffect, useState } from "react";

// 카카오톡 등 메신저 안의 브라우저(인앱 브라우저)는 공유·인쇄·뒤로가기가 제각각이고
// 글자 크기 설정도 남지 않는다. 카카오톡은 외부 브라우저로 바로 넘기고,
// 그 밖의 인앱 브라우저는 안내 띠만 띄운다(강제로 넘길 공식 경로가 없다).

const KAKAO = /KAKAOTALK/i;
const OTHER_INAPP = /NAVER\(inapp|Line\/|Instagram|FBAN|FBAV|DaumApps|SamsungBrowser\/[0-9.]+ .*wv/i;
const IOS = /iPhone|iPad|iPod/i;

// 탈출은 세션에 한 번만. 안드로이드 인텐트가 실패하면(크롬 없음·사용 중지) 폴백 URL = 이 페이지가
// 인앱에 다시 뜨는데, 그때 또 넘기면 새로고침이 끝없이 돈다 — 두 번째 로드부터는 안내 띠로 대신한다
const TRIED_KEY = "kakao-escape-tried";
// dev StrictMode 는 effect 를 두 번 돌린다 — 모듈 변수로 같은 페이지 안의 재시도를 막는다
let attemptedInThisPage = false;

function alreadyTriedThisSession(): boolean {
  try {
    const tried = sessionStorage.getItem(TRIED_KEY) === "1";
    sessionStorage.setItem(TRIED_KEY, "1");
    return tried;
  } catch {
    // 저장 차단(사생활 모드 등) — 모듈 변수만으로 막는다. 폴백 새로고침 뒤에는 한 번 더 시도될 수 있다
    return false;
  }
}

// 외부 브라우저로 실제로 넘어갔는지는 이 페이지가 뒤로 밀렸는지(visibility·pagehide)로만 알 수 있다.
// 못 넘어갔으면(스킴 차단·구버전) 창을 닫거나 하지 않고 onStay 로 안내 띠만 띄운다
function escapeKakao(onStay: () => void): void {
  const url = window.location.href;
  let left = false;
  const onHide = () => {
    if (document.visibilityState === "hidden") left = true;
  };
  const onPageHide = () => {
    left = true;
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);
  const stillHere = () => !left && document.visibilityState !== "hidden";
  const done = () => {
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
  };

  if (IOS.test(navigator.userAgent)) {
    // 사파리로 열고, 실제로 넘어간 뒤에만 카카오톡 안의 창을 닫는다 —
    // 안 넘어갔는데 닫으면 사용자 손에 아무것도 남지 않는다
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
    window.setTimeout(() => {
      done();
      if (stillHere()) onStay();
      else window.location.href = "kakaoweb://closeBrowser";
    }, 800);
  } else {
    // 안드로이드 — 크롬 인텐트. package 를 박으면 크롬이 없을 때 기본 브라우저로 넘어가지 않고
    // S.browser_fallback_url(이 페이지)이 인앱에 다시 뜬다 → 위 세션 가드가 안내 띠로 받는다.
    // 스킴은 현재 주소를 따른다(dev 의 http 가 https 로 바뀌면 열리지 않는다)
    const scheme = window.location.protocol.replace(/:$/, "") || "https";
    const bare = url.replace(/^https?:\/\//i, "");
    window.location.href = `intent://${bare}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
    // 인텐트를 아예 무시한 웹뷰(화면 그대로)도 안내 띠를 받는다
    window.setTimeout(() => {
      done();
      if (stillHere()) onStay();
    }, 1500);
  }
}

export function ExternalBrowserEscape() {
  const [otherInApp, setOtherInApp] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (KAKAO.test(ua)) {
      if (attemptedInThisPage) return;
      attemptedInThisPage = true;
      if (alreadyTriedThisSession()) {
        setOtherInApp(true);
        return;
      }
      escapeKakao(() => setOtherInApp(true));
      return;
    }
    if (OTHER_INAPP.test(ua)) setOtherInApp(true);
  }, []);

  if (!otherInApp) return null;

  return (
    <div
      role="status"
      className="no-print border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[13.5px] leading-snug text-amber-900"
    >
      앱 안의 브라우저에서 열렸습니다. 오른쪽 위 메뉴에서{" "}
      <b>다른 브라우저로 열기</b>를 누르면 더 편하게 보실 수 있습니다.
    </div>
  );
}
