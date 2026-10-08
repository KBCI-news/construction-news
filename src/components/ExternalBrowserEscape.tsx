"use client";

import { useEffect, useState } from "react";

// 카카오톡 등 메신저 안의 브라우저(인앱 브라우저)는 공유·인쇄·뒤로가기가 제각각이고
// 글자 크기 설정도 남지 않는다. 카카오톡은 외부 브라우저로 바로 넘기고,
// 그 밖의 인앱 브라우저는 안내 띠만 띄운다(강제로 넘길 공식 경로가 없다).

const KAKAO = /KAKAOTALK/i;
const OTHER_INAPP = /NAVER\(inapp|Line\/|Instagram|FBAN|FBAV|DaumApps|SamsungBrowser\/[0-9.]+ .*wv/i;
const IOS = /iPhone|iPad|iPod/i;

function escapeKakao(): void {
  const url = window.location.href;
  if (IOS.test(navigator.userAgent)) {
    // 사파리로 열고, 카카오톡 안의 창은 닫는다
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
    window.setTimeout(() => {
      window.location.href = "kakaoweb://closeBrowser";
    }, 800);
  } else {
    // 안드로이드 — 크롬 인텐트. 크롬이 없으면 기본 브라우저가 받는다
    const bare = url.replace(/^https?:\/\//i, "");
    window.location.href = `intent://${bare}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
  }
}

export function ExternalBrowserEscape() {
  const [otherInApp, setOtherInApp] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (KAKAO.test(ua)) {
      escapeKakao();
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
