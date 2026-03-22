export type JudgmentResultPayload = {
  probability: number;
  location: string;
  venueType: string;
};

/** 모델 JSON에서 확률·위치·업종 추출·정규화 */
export function normalizeJudgmentResult(raw: unknown): JudgmentResultPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const p = o.probability;
  const prob =
    typeof p === "number" && Number.isFinite(p)
      ? Math.round(p)
      : typeof p === "string" && p.trim() !== "" && Number.isFinite(Number(p))
        ? Math.round(Number(p))
        : NaN;
  if (!Number.isFinite(prob)) return null;

  const locRaw =
    typeof o.location === "string" ? o.location.trim() : "";
  const vtRaw =
    typeof o.venueType === "string" ? o.venueType.trim() : "";

  return {
    probability: Math.min(100, Math.max(0, prob)),
    location: locRaw || "지역 미상",
    venueType: vtRaw || "음식점",
  };
}
