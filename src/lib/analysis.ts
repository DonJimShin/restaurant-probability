export type JudgmentResultPayload = {
  /** 실제 음식점으로 식별되는지 */
  exists: boolean;
  probability: number;
  location: string;
  /** 읍·면·동(목동, 연남동 등). 불명이면 빈 문자열 */
  dong: string;
  venueType: string;
  /** 간판·알려진 정식 상호. 검색어가 줄임말이면 전체 상호 */
  displayName: string;
  /** exists가 false일 때 사용자 안내 한 줄 (true면 빈 문자열) */
  notice: string;
};

/** 확률 산출 전 위치·업종 확인 단계 응답 (probability 없음) */
export type ConfirmResultPayload = {
  exists: boolean;
  location: string;
  dong: string;
  venueType: string;
  displayName: string;
  notice: string;
};

export const DEFAULT_NOT_FOUND_MESSAGE =
  "그런 가게는 알려진 바가 없어. 이름이나 지역을 한 번 더 확인해 봐.";

/** 모델 JSON에서 판독 결과 정규화 */
export function normalizeJudgmentResult(raw: unknown): JudgmentResultPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const exists = o.exists === false ? false : true;

  const p = o.probability;
  const prob =
    typeof p === "number" && Number.isFinite(p)
      ? Math.round(p)
      : typeof p === "string" && p.trim() !== "" && Number.isFinite(Number(p))
        ? Math.round(Number(p))
        : NaN;
  if (!Number.isFinite(prob)) return null;

  let notice =
    typeof o.notice === "string" ? o.notice.trim() : "";
  if (!exists) {
    if (!notice) notice = DEFAULT_NOT_FOUND_MESSAGE;
  } else {
    notice = "";
  }

  const locRaw =
    typeof o.location === "string" ? o.location.trim() : "";
  const dongRaw =
    typeof o.dong === "string" ? o.dong.trim() : "";
  const vtRaw =
    typeof o.venueType === "string" ? o.venueType.trim() : "";
  const displayRaw =
    typeof o.displayName === "string" ? o.displayName.trim() : "";

  if (!exists) {
    return {
      exists: false,
      probability: 0,
      location: "-",
      dong: "-",
      venueType: "-",
      displayName: "-",
      notice,
    };
  }

  return {
    exists: true,
    probability: Math.min(100, Math.max(0, prob)),
    location: locRaw || "지역 미상",
    dong: dongRaw,
    venueType: vtRaw || "음식점",
    displayName: displayRaw,
    notice: "",
  };
}

/** 확인 단계 JSON 정규화 (맛집 확률 없음) */
export function normalizeConfirmResult(raw: unknown): ConfirmResultPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const exists = o.exists === false ? false : true;

  let notice =
    typeof o.notice === "string" ? o.notice.trim() : "";
  if (!exists) {
    if (!notice) notice = DEFAULT_NOT_FOUND_MESSAGE;
  } else {
    notice = "";
  }

  const locRaw =
    typeof o.location === "string" ? o.location.trim() : "";
  const dongRaw =
    typeof o.dong === "string" ? o.dong.trim() : "";
  const vtRaw =
    typeof o.venueType === "string" ? o.venueType.trim() : "";
  const displayRaw =
    typeof o.displayName === "string" ? o.displayName.trim() : "";

  if (!exists) {
    return {
      exists: false,
      location: "-",
      dong: "-",
      venueType: "-",
      displayName: "-",
      notice,
    };
  }

  return {
    exists: true,
    location: locRaw || "지역 미상",
    dong: dongRaw,
    venueType: vtRaw || "음식점",
    displayName: displayRaw,
    notice: "",
  };
}
