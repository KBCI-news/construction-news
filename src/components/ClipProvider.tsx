"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

// 게시판 부착용 브리핑을 만들기 위해 기사를 "담아두는" 장바구니.
// 카테고리/검색 화면을 오가도 유지되어야 하므로 localStorage에 둔다.
const KEY = "kbci-clip-v1";
const MAX = 20;

export type ClippedArticle = {
  link: string;
  title: string;
  sourceHost: string | null;
  pubDate: string;
};

type ClipContextValue = {
  items: ClippedArticle[];
  has: (link: string) => boolean;
  toggle: (a: ClippedArticle) => void;
  remove: (link: string) => void;
  clear: () => void;
  move: (link: string, dir: -1 | 1) => void;
  full: boolean;
  ready: boolean;
};

const ClipContext = createContext<ClipContextValue | null>(null);

export function useClip(): ClipContextValue {
  const ctx = useContext(ClipContext);
  if (!ctx) throw new Error("useClip must be used inside ClipProvider");
  return ctx;
}

export function ClipProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ClippedArticle[]>([]);
  const [ready, setReady] = useState(false);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw) as ClippedArticle[]);
    } catch {
      /* 손상된 값은 무시 */
    }
    setReady(true);
  }, []);

  const persist = useCallback((next: ClippedArticle[]) => {
    setItems(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* 용량 초과는 무시 */
    }
  }, []);

  const has = useCallback(
    (link: string) => items.some((i) => i.link === link),
    [items],
  );

  const toggle = useCallback(
    (a: ClippedArticle) => {
      const exists = items.some((i) => i.link === a.link);
      if (exists) {
        persist(items.filter((i) => i.link !== a.link));
        setAnnounce(`담기 해제. 현재 ${items.length - 1}건`);
        return;
      }
      if (items.length >= MAX) {
        setAnnounce(`최대 ${MAX}건까지 담을 수 있습니다`);
        return;
      }
      persist([...items, a]);
      setAnnounce(`담았습니다. 현재 ${items.length + 1}건`);
    },
    [items, persist],
  );

  const remove = useCallback(
    (link: string) => persist(items.filter((i) => i.link !== link)),
    [items, persist],
  );

  const clear = useCallback(() => {
    persist([]);
    setAnnounce("담은 기사를 모두 비웠습니다");
  }, [persist]);

  const move = useCallback(
    (link: string, dir: -1 | 1) => {
      const idx = items.findIndex((i) => i.link === link);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= items.length) return;
      const copy = items.slice();
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      persist(copy);
    },
    [items, persist],
  );

  const value = useMemo<ClipContextValue>(
    () => ({ items, has, toggle, remove, clear, move, full: items.length >= MAX, ready }),
    [items, has, toggle, remove, clear, move, ready],
  );

  return (
    <ClipContext.Provider value={value}>
      {children}
      {/* 스크린리더 알림 — 담기 결과가 소리로도 전달되게 한다 */}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <ClipTray />
    </ClipContext.Provider>
  );
}

function ClipTray() {
  const { items, clear } = useClip();
  if (items.length === 0) return null;
  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <p className="text-[14px] font-bold text-gray-900">
          담은 기사{" "}
          <span className="tabular-nums text-[#7A5E08]">{items.length}</span>건
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={clear}
            className="min-h-[44px] rounded-lg px-3 text-[13px] font-bold text-gray-600 hover:text-gray-900"
          >
            비우기
          </button>
          <Link
            href="/brief"
            className="inline-flex min-h-[44px] items-center rounded-lg bg-gray-900 px-5 text-[14px] font-bold text-white hover:bg-black"
          >
            브리핑 만들기 →
          </Link>
        </div>
      </div>
    </div>
  );
}
