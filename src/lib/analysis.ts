export type ProbabilityPayload = {
  probability: number;
};

/** 모델 JSON에서 확률만 추출·정규화 (0~100 정수) */
export function normalizeProbability(raw: unknown): ProbabilityPayload | null {
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
  return { probability: Math.min(100, Math.max(0, prob)) };
}
