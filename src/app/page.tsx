"use client";

import { FormEvent, useEffect, useState } from "react";

import {
  appendJudgment,
  findCachedJudgment,
  loadJudgmentHistory,
  newJudgmentId,
  type JudgmentRecord,
} from "@/lib/judgment-history";

const FUN_MESSAGES = [
  "맛집일까...",
  "아닐까...",
  "쿵짝짝... 쿵짝짝...",
  "리뷰 패턴을 훑는 중...",
  "맛집일까... 아닐까...",
  "쿵짝짝... 쿵짝짝... 거의 다 됐어요",
];

/** 한글 마지막 글자 받침 여부로 은/는 선택 (비한글은 는) */
function topicParticle(name: string): "은" | "는" {
  const s = name.trim();
  if (!s) return "은";
  const last = s.at(-1)!;
  const cp = last.codePointAt(0)!;
  if (cp >= 0xac00 && cp <= 0xd7a3) {
    return (cp - 0xac00) % 28 !== 0 ? "은" : "는";
  }
  return "는";
}

function buildJudgmentShareText(payload: {
  restaurantName: string;
  probability: number;
  location?: string | null;
  venueType?: string | null;
}): string {
  const { restaurantName: place, probability: prob } = payload;
  const loc = payload.location?.trim();
  const vt = payload.venueType?.trim();
  if (loc && vt) {
    return `${loc}에 위치한 ${vt}인 ${place}${topicParticle(place)} 맛집일 확률 ${prob}%입니다`;
  }
  return `${place}${topicParticle(place)} 맛집일 확률 ${prob}%입니다`;
}

function JudgmentResultBlock({
  name,
  probability,
  location,
  venueType,
  titleId,
  TitleTag = "h2",
}: {
  name: string;
  probability: number;
  location?: string | null;
  venueType?: string | null;
  titleId?: string;
  TitleTag?: "h2" | "h3";
}) {
  const Tag = TitleTag;
  const loc = location?.trim();
  const vt = venueType?.trim();
  const rich = !!(loc && vt);
  const idProps = titleId ? { id: titleId } : {};

  if (rich) {
    return (
      <Tag
        {...idProps}
        className="text-xl font-semibold leading-relaxed text-slate-900 md:text-2xl"
      >
        <span className="block text-base font-normal text-slate-600 md:text-lg">
          {loc}에 위치한 {vt}인
        </span>
        <span className="mt-3 block">
          <span className="text-blue-900">{name}</span>
          {topicParticle(name)} 맛집일 확률{" "}
          <span className="font-bold tabular-nums text-blue-700">
            {probability}
          </span>
          %입니다
        </span>
      </Tag>
    );
  }

  return (
    <Tag
      {...idProps}
      className="text-xl font-semibold leading-relaxed text-slate-900 md:text-2xl"
    >
      <span className="text-blue-900">{name}</span>
      {topicParticle(name)} 맛집일 확률{" "}
      <span className="font-bold tabular-nums text-blue-700">{probability}</span>
      %입니다
    </Tag>
  );
}

function AnalyzingBlock() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % FUN_MESSAGES.length);
    }, 900);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className="mt-10 flex flex-col items-center gap-4 text-slate-600"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium tracking-tight text-slate-700">
          분석 중
        </span>
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2 animate-bounce rounded-full bg-blue-600 [animation-duration:1s]" />
          <span className="size-2 animate-bounce rounded-full bg-blue-600 [animation-delay:150ms] [animation-duration:1s]" />
          <span className="size-2 animate-bounce rounded-full bg-blue-600 [animation-delay:300ms] [animation-duration:1s]" />
        </span>
      </div>
      <p className="max-w-sm text-center text-base font-medium text-blue-900/90">
        {FUN_MESSAGES[idx]}
      </p>
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [submittedName, setSubmittedName] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [probability, setProbability] = useState<number | null>(null);
  const [resultLocation, setResultLocation] = useState<string | null>(null);
  const [resultVenueType, setResultVenueType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [history, setHistory] = useState<JudgmentRecord[]>([]);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  useEffect(() => {
    setHistory(loadJudgmentHistory());
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = query.trim();
    if (!name || analyzing) return;

    setError(null);

    const cached = findCachedJudgment(name);
    if (cached) {
      setSubmittedName(name);
      setProbability(cached.probability);
      setResultLocation(cached.location ?? null);
      setResultVenueType(cached.venueType ?? null);
      setExpandedHistoryId(cached.id);
      setHistory(loadJudgmentHistory());
      return;
    }

    setSubmittedName(name);
    setAnalyzing(true);
    setProbability(null);
    setResultLocation(null);
    setResultVenueType(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantName: name }),
      });
      const data = (await res.json()) as {
        probability?: number;
        location?: string;
        venueType?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "분석에 실패했습니다.",
        );
      }
      if (
        typeof data.probability !== "number" ||
        !Number.isFinite(data.probability) ||
        typeof data.location !== "string" ||
        typeof data.venueType !== "string"
      ) {
        throw new Error("서버 응답 형식이 올바르지 않습니다.");
      }
      const prob = Math.min(100, Math.max(0, Math.round(data.probability)));
      const loc = data.location.trim();
      const vt = data.venueType.trim();
      setProbability(prob);
      setResultLocation(loc || null);
      setResultVenueType(vt || null);
      const record: JudgmentRecord = {
        id: newJudgmentId(),
        restaurantName: name,
        probability: prob,
        createdAt: new Date().toISOString(),
        location: loc || undefined,
        venueType: vt || undefined,
      };
      setHistory(appendJudgment(record));
      setExpandedHistoryId(record.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleShare(payload: {
    restaurantName: string;
    probability: number;
    location?: string | null;
    venueType?: string | null;
  }) {
    if (!navigator.share) return;
    const url = window.location.href;
    const text = buildJudgmentShareText(payload);

    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* 클립보드 거절 시에도 공유 시트는 띄움 */
    }

    try {
      await navigator.share({ title: "맛집 확률", text, url });
    } catch (e) {
      if (
        e &&
        typeof e === "object" &&
        "name" in e &&
        (e as { name: string }).name === "AbortError"
      ) {
        return;
      }
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-white px-4 py-16 text-slate-800">
      <main className="flex w-full max-w-3xl flex-col items-center">
        <p className="mb-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          맛집 확률 판독기
        </p>
        <h1 className="mb-10 text-center text-2xl font-semibold leading-snug tracking-tight text-slate-900 md:text-3xl">
          [식당 이름] 또는 [지역+식당 이름]을 넣어봐
          <br />
          그러면 <span className="text-blue-700">맛집일 확률</span> 알랴줌
        </h1>

        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-xl flex-col gap-3 sm:flex-row sm:items-stretch"
        >
          <label htmlFor="restaurant-search" className="sr-only">
            식당 이름 또는 지역과 식당 이름
          </label>
          <input
            id="restaurant-search"
            type="search"
            autoComplete="off"
            placeholder="예: 모수 / 강남 파스타집"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={analyzing}
            className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-6 py-4 text-lg text-slate-900 shadow-sm outline-none ring-blue-600/20 transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 disabled:cursor-wait disabled:opacity-70"
          />
          <button
            type="submit"
            disabled={analyzing || !query.trim()}
            className="shrink-0 rounded-2xl bg-blue-600 px-8 py-4 text-lg font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            검색
          </button>
        </form>

        {analyzing && <AnalyzingBlock />}

        {error && !analyzing && (
          <p
            className="mt-8 max-w-xl text-center text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}

        {probability !== null && submittedName && !analyzing && (
          <section
            className="mt-12 w-full transition-opacity duration-500"
            aria-labelledby="probability-section-title"
          >
            <article className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200/80 bg-gradient-to-br from-blue-50/90 to-white p-8 text-center shadow-sm">
              <JudgmentResultBlock
                name={submittedName}
                probability={probability}
                location={resultLocation}
                venueType={resultVenueType}
                titleId="probability-section-title"
                TitleTag="h2"
              />
              {canNativeShare && (
                <button
                  type="button"
                  onClick={() =>
                    void handleShare({
                      restaurantName: submittedName,
                      probability,
                      location: resultLocation,
                      venueType: resultVenueType,
                    })
                  }
                  className="mx-auto mt-5 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50/60 hover:text-blue-800 active:bg-slate-50"
                >
                  <svg
                    className="size-[1.125rem] shrink-0 text-slate-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" x2="12" y1="2" y2="15" />
                  </svg>
                  결과 공유하기
                </button>
              )}
            </article>

            <p className="mt-6 text-center text-xs text-slate-600">
              주의: 맛집 확인용으로만 사용하세요
            </p>
          </section>
        )}

        {history.length > 0 && (
          <section
            className="mt-16 w-full max-w-xl"
            aria-labelledby="history-heading"
          >
            <h3
              id="history-heading"
              className="mb-3 text-sm font-semibold text-slate-700"
            >
              이전 판독 <span className="font-normal text-slate-500">(최신순)</span>
            </h3>
            <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {history.map((r) => {
                const open = expandedHistoryId === r.id;
                return (
                  <li
                    key={r.id}
                    className="border-b border-slate-100 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedHistoryId(open ? null : r.id)
                      }
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                      aria-expanded={open}
                    >
                      <span className="min-w-0 flex-1 font-medium text-slate-900">
                        {r.restaurantName}
                      </span>
                      <time
                        className="shrink-0 text-xs text-slate-400 tabular-nums"
                        dateTime={r.createdAt}
                      >
                        {new Date(r.createdAt).toLocaleString("ko-KR", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      <svg
                        className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    {open && (
                      <div className="border-t border-slate-100 bg-slate-50/90 px-4 py-4 text-center">
                        <JudgmentResultBlock
                          name={r.restaurantName}
                          probability={r.probability}
                          location={r.location}
                          venueType={r.venueType}
                          TitleTag="h3"
                        />
                        {canNativeShare && (
                          <button
                            type="button"
                            onClick={() => void handleShare(r)}
                            className="mx-auto mt-4 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50/60 hover:text-blue-800 active:bg-slate-50"
                          >
                            <svg
                              className="size-[1.125rem] shrink-0 text-slate-500"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden
                            >
                              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                              <polyline points="16 6 12 2 8 6" />
                              <line x1="12" x2="12" y1="2" y2="15" />
                            </svg>
                            결과 공유하기
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
