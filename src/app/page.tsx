"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { DEFAULT_NOT_FOUND_MESSAGE } from "@/lib/analysis";
import {
  appendJudgment,
  findCachedJudgment,
  loadJudgmentHistory,
  newJudgmentId,
  recordIsFound,
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
  exists?: boolean;
  probability: number;
  location?: string | null;
  venueType?: string | null;
  notice?: string | null;
}): string {
  const { restaurantName: place, probability: prob } = payload;
  if (payload.exists === false) {
    const msg =
      payload.notice?.trim() || DEFAULT_NOT_FOUND_MESSAGE;
    return `「${place}」 ${msg}`;
  }
  const loc = payload.location?.trim();
  const vt = payload.venueType?.trim();
  if (loc && vt && loc !== "-" && vt !== "-") {
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
  const rich = !!(loc && vt && loc !== "-" && vt !== "-");
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

function NotFoundResultBlock({
  name,
  notice,
  titleId,
  TitleTag = "h2",
}: {
  name: string;
  notice: string;
  titleId?: string;
  TitleTag?: "h2" | "h3";
}) {
  const Tag = TitleTag;
  const idProps = titleId ? { id: titleId } : {};
  return (
    <Tag
      {...idProps}
      className="text-xl font-semibold leading-relaxed text-slate-900 md:text-2xl"
    >
      <span className="block text-base font-normal text-slate-500 md:text-lg">
        「{name}」
      </span>
      <p className="mt-3 text-lg font-medium text-slate-800 md:text-xl">
        {notice}
      </p>
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
  const [resultFound, setResultFound] = useState(true);
  const [resultNotice, setResultNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [history, setHistory] = useState<JudgmentRecord[]>([]);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(
    null,
  );
  /** 확인 단계: 위치·업종 맞는지 / 보정 입력 */
  const [pending, setPending] = useState<null | {
    originalQuery: string;
    suggestedLocation: string;
    suggestedVenueType: string;
    step: "confirm" | "refine";
  }>(null);
  const [refineDraft, setRefineDraft] = useState("");
  const [historySort, setHistorySort] = useState<"recent" | "probability">(
    "recent",
  );

  const displayHistory = useMemo(() => {
    const copy = [...history];
    if (historySort === "recent") {
      copy.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return copy;
    }
    copy.sort((a, b) => {
      const score = (r: JudgmentRecord) =>
        recordIsFound(r) ? r.probability : -1;
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
    return copy;
  }, [history, historySort]);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  useEffect(() => {
    setHistory(loadJudgmentHistory());
  }, []);

  async function runScorePhase(
    originalQuery: string,
    scoreContext: {
      confirmedLocation: string;
      confirmedVenueType: string;
      userAddedLocationNote?: string;
    },
  ) {
    setError(null);
    setAnalyzing(true);
    setPending(null);
    setRefineDraft("");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "score",
          restaurantName: originalQuery,
          scoreContext,
        }),
      });
      const data = (await res.json()) as {
        exists?: boolean;
        probability?: number;
        location?: string;
        venueType?: string;
        notice?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "분석에 실패했습니다.",
        );
      }
      if (
        typeof data.exists !== "boolean" ||
        typeof data.probability !== "number" ||
        !Number.isFinite(data.probability) ||
        typeof data.location !== "string" ||
        typeof data.venueType !== "string" ||
        typeof data.notice !== "string"
      ) {
        throw new Error("서버 응답 형식이 올바르지 않습니다.");
      }
      const exists = data.exists;
      const prob = Math.min(100, Math.max(0, Math.round(data.probability)));
      const loc = data.location.trim();
      const vt = data.venueType.trim();
      const notice = data.notice.trim();

      setSubmittedName(originalQuery);
      setResultFound(exists);
      setResultNotice(exists ? "" : (notice || DEFAULT_NOT_FOUND_MESSAGE));
      setProbability(prob);
      setResultLocation(exists ? (loc || null) : null);
      setResultVenueType(exists ? (vt || null) : null);

      const record: JudgmentRecord = {
        id: newJudgmentId(),
        restaurantName: originalQuery,
        probability: prob,
        createdAt: new Date().toISOString(),
        exists,
        notice: exists ? undefined : (notice || DEFAULT_NOT_FOUND_MESSAGE),
        location: exists ? (loc || undefined) : undefined,
        venueType: exists ? (vt || undefined) : undefined,
      };
      setHistory(appendJudgment(record));
      setExpandedHistoryId(record.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = query.trim();
    if (!name || analyzing) return;

    setError(null);
    setPending(null);
    setRefineDraft("");

    const cached = findCachedJudgment(name);
    if (cached) {
      setSubmittedName(name);
      setProbability(cached.probability);
      setResultLocation(cached.location ?? null);
      setResultVenueType(cached.venueType ?? null);
      const found = recordIsFound(cached);
      setResultFound(found);
      setResultNotice(
        found
          ? ""
          : (cached.notice?.trim() || DEFAULT_NOT_FOUND_MESSAGE),
      );
      setExpandedHistoryId(cached.id);
      setHistory(loadJudgmentHistory());
      return;
    }

    setSubmittedName(name);
    setAnalyzing(true);
    setProbability(null);
    setResultLocation(null);
    setResultVenueType(null);
    setResultFound(true);
    setResultNotice("");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "confirm", restaurantName: name }),
      });
      const data = (await res.json()) as {
        phase?: string;
        exists?: boolean;
        location?: string;
        venueType?: string;
        notice?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "분석에 실패했습니다.",
        );
      }
      if (
        typeof data.exists !== "boolean" ||
        typeof data.location !== "string" ||
        typeof data.venueType !== "string" ||
        typeof data.notice !== "string"
      ) {
        throw new Error("서버 응답 형식이 올바르지 않습니다.");
      }

      if (!data.exists) {
        const notice = data.notice.trim() || DEFAULT_NOT_FOUND_MESSAGE;
        setResultFound(false);
        setResultNotice(notice);
        setProbability(0);
        setResultLocation(null);
        setResultVenueType(null);
        const record: JudgmentRecord = {
          id: newJudgmentId(),
          restaurantName: name,
          probability: 0,
          createdAt: new Date().toISOString(),
          exists: false,
          notice,
        };
        setHistory(appendJudgment(record));
        setExpandedHistoryId(record.id);
        return;
      }

      setPending({
        originalQuery: name,
        suggestedLocation: data.location.trim() || "지역 미상",
        suggestedVenueType: data.venueType.trim() || "음식점",
        step: "confirm",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleShare(payload: {
    restaurantName: string;
    exists?: boolean;
    probability: number;
    location?: string | null;
    venueType?: string | null;
    notice?: string | null;
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
      await navigator.share({ title: "맛집 확률 계산기", text, url });
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
        <h1 className="mb-10 text-center text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
          맛집 확률 계산기
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
            placeholder="예: 고기리막국수 or 대전 성심당"
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

        {pending && !analyzing && pending.step === "confirm" && (
          <section
            className="mt-10 w-full max-w-xl rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-center shadow-sm"
            aria-labelledby="confirm-venue-heading"
          >
            <h2
              id="confirm-venue-heading"
              className="text-sm font-semibold uppercase tracking-wide text-slate-500"
            >
              위치·업종 확인
            </h2>
            <p className="mt-2 text-xs text-slate-500 sm:text-sm">
              위치는 <span className="font-medium text-slate-600">시·구(또는 시·군)</span>
              까지 추정했어요. 다르면 「아니에요」로 알려 주세요.
            </p>
            <p className="mt-3 text-base text-slate-600">
              <span className="font-medium text-slate-800">
                「{pending.originalQuery}」
              </span>
            </p>
            <p className="mt-4 text-lg font-medium leading-relaxed text-slate-900">
              <span className="text-blue-900">{pending.suggestedLocation}</span>에 위치한{" "}
              <span className="text-blue-900">{pending.suggestedVenueType}</span>
              이 맞습니까?
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                className="rounded-xl bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700"
                onClick={() =>
                  void runScorePhase(pending.originalQuery, {
                    confirmedLocation: pending.suggestedLocation,
                    confirmedVenueType: pending.suggestedVenueType,
                  })
                }
              >
                맞아요
              </button>
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
                onClick={() => {
                  setError(null);
                  setPending({ ...pending, step: "refine" });
                }}
              >
                아니에요
              </button>
            </div>
          </section>
        )}

        {pending && !analyzing && pending.step === "refine" && (
          <section
            className="mt-10 w-full max-w-xl rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-center shadow-sm"
            aria-labelledby="refine-location-heading"
          >
            <h2
              id="refine-location-heading"
              className="text-sm font-semibold uppercase tracking-wide text-slate-500"
            >
              위치 보정
            </h2>
            <p className="mt-3 text-lg font-medium text-slate-900">
              음식점이 있는 곳을 시·구까지 알려주세요
            </p>
            <p className="mt-2 text-sm text-slate-600">
              예: 대전 유성구, 서울 마포구 연남동 — 시·구(또는 시·군)와 동·도로명을 함께 적으면 더 정확해요.
            </p>
            <label htmlFor="refine-location" className="sr-only">
              음식점 위치
            </label>
            <textarea
              id="refine-location"
              rows={3}
              value={refineDraft}
              onChange={(e) => {
                setRefineDraft(e.target.value);
                if (error) setError(null);
              }}
              placeholder="예: 대전 유성구 봉명동, 서울 마포구 양화로"
              className="mt-4 w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-base text-slate-900 shadow-sm outline-none ring-blue-600/20 focus:border-blue-600 focus:ring-4"
            />
            <button
              type="button"
              disabled={!refineDraft.trim()}
              className="mt-4 w-full rounded-xl bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              onClick={() => {
                const note = refineDraft.trim();
                if (!note) {
                  setError("위치를 입력해 주세요.");
                  return;
                }
                void runScorePhase(pending.originalQuery, {
                  confirmedLocation: pending.suggestedLocation,
                  confirmedVenueType: pending.suggestedVenueType,
                  userAddedLocationNote: note,
                });
              }}
            >
              맛집 확률 계산하기
            </button>
          </section>
        )}

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
              {resultFound ? (
                <JudgmentResultBlock
                  name={submittedName}
                  probability={probability}
                  location={resultLocation}
                  venueType={resultVenueType}
                  titleId="probability-section-title"
                  TitleTag="h2"
                />
              ) : (
                <NotFoundResultBlock
                  name={submittedName}
                  notice={resultNotice}
                  titleId="probability-section-title"
                  TitleTag="h2"
                />
              )}
              {canNativeShare && (
                <button
                  type="button"
                  onClick={() =>
                    void handleShare({
                      restaurantName: submittedName,
                      exists: resultFound,
                      probability,
                      location: resultLocation,
                      venueType: resultVenueType,
                      notice: resultFound ? null : resultNotice,
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
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3
                id="history-heading"
                className="text-sm font-semibold text-slate-700"
              >
                이전 판독
              </h3>
              <div
                className="flex shrink-0 gap-0.5 rounded-xl border border-slate-200 bg-slate-100/80 p-1"
                role="group"
                aria-label="이전 판독 정렬"
              >
                <button
                  type="button"
                  onClick={() => setHistorySort("recent")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
                    historySort === "recent"
                      ? "bg-white text-blue-800 shadow-sm ring-1 ring-slate-200/80"
                      : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
                  }`}
                >
                  최신순
                </button>
                <button
                  type="button"
                  onClick={() => setHistorySort("probability")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
                    historySort === "probability"
                      ? "bg-white text-blue-800 shadow-sm ring-1 ring-slate-200/80"
                      : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
                  }`}
                >
                  맛집 확률 높은순
                </button>
              </div>
            </div>
            <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {displayHistory.map((r) => {
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
                        {recordIsFound(r) ? (
                          <JudgmentResultBlock
                            name={r.restaurantName}
                            probability={r.probability}
                            location={r.location}
                            venueType={r.venueType}
                            TitleTag="h3"
                          />
                        ) : (
                          <NotFoundResultBlock
                            name={r.restaurantName}
                            notice={
                              r.notice?.trim() || DEFAULT_NOT_FOUND_MESSAGE
                            }
                            TitleTag="h3"
                          />
                        )}
                        {canNativeShare && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleShare({
                                restaurantName: r.restaurantName,
                                exists: recordIsFound(r),
                                probability: r.probability,
                                location: r.location,
                                venueType: r.venueType,
                                notice: recordIsFound(r)
                                  ? null
                                  : (r.notice ?? DEFAULT_NOT_FOUND_MESSAGE),
                              })
                            }
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
