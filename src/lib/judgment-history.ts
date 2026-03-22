const STORAGE_KEY = "malzip-judgment-history-v2";
/** 정규화 검색어 → 누적 검색(판독 완료) 횟수 */
const SEARCH_COUNT_KEY = "malzip-search-counts-v1";
/** 이전 버전 키 — 마이그레이션 시 한 번 제거해 로컬 JSON을 비운다 */
const LEGACY_STORAGE_KEYS = ["malzip-judgment-history-v1"] as const;
const MAX_ENTRIES = 80;

let legacyKeysPurged = false;

function purgeLegacyStorageKeys(): void {
  if (typeof window === "undefined" || legacyKeysPurged) return;
  legacyKeysPurged = true;
  for (const key of LEGACY_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}

export type JudgmentRecord = {
  id: string;
  /** 사용자가 검색에 입력한 문자열(캐시 키) */
  restaurantName: string;
  /** 결과·공유에 쓸 정식 상호. 없으면 restaurantName 표시 */
  displayName?: string;
  probability: number;
  createdAt: string;
  /** 예: 서울 강남 — 구버전 이력에는 없을 수 있음 */
  location?: string;
  /** 읍·면·동(목동 등). 구 이력에는 없을 수 있음 */
  dong?: string;
  /** 예: 한식당, 오마카세 전문점 */
  venueType?: string;
  /** false면 식당 미식별(구 이력은 없으면 true로 간주) */
  exists?: boolean;
  /** exists false일 때 안내 문구 */
  notice?: string;
};

function isRecord(x: unknown): x is JudgmentRecord {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.restaurantName !== "string" ||
    typeof o.probability !== "number" ||
    typeof o.createdAt !== "string"
  ) {
    return false;
  }
  if (o.displayName !== undefined && typeof o.displayName !== "string") {
    return false;
  }
  if (o.location !== undefined && typeof o.location !== "string") return false;
  if (o.dong !== undefined && typeof o.dong !== "string") return false;
  if (o.venueType !== undefined && typeof o.venueType !== "string") {
    return false;
  }
  if (o.exists !== undefined && typeof o.exists !== "boolean") return false;
  if (o.notice !== undefined && typeof o.notice !== "string") return false;
  return true;
}

/** 구 이력 호환: exists 필드 없으면 식당 있는 것으로 본다 */
export function recordIsFound(r: JudgmentRecord): boolean {
  return r.exists !== false;
}

/** 비교용: 앞뒤 공백·연속 공백 정리, 라틴 문자는 소문자 통일 */
export function normalizeSearchKey(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

function loadSearchCountMap(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SEARCH_COUNT_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        out[k] = Math.min(1_000_000, Math.floor(v));
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveSearchCountMap(map: Record<string, number>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SEARCH_COUNT_KEY, JSON.stringify(map));
}

/** 정규화 검색어 기준 누적 검색 횟수 (판독이 끝날 때마다 +1) */
export function getSearchCount(searchName: string): number {
  const key = normalizeSearchKey(searchName);
  if (!key) return 0;
  return loadSearchCountMap()[key] ?? 0;
}

/**
 * 판독이 완료될 때 호출(캐시 히트·미식별·확률 산출 완료).
 * 반환: 갱신 후 해당 검색어 횟수
 */
export function incrementSearchCount(searchName: string): number {
  if (typeof window === "undefined") return 0;
  const key = normalizeSearchKey(searchName);
  if (!key) return 0;
  const map = loadSearchCountMap();
  const next = (map[key] ?? 0) + 1;
  map[key] = next;
  saveSearchCountMap(map);
  return next;
}

/**
 * 저장된 이력(최신순)에서 동일 검색어의 가장 최근 판독을 찾는다.
 * 없으면 null.
 */
export function findCachedJudgment(searchName: string): JudgmentRecord | null {
  const key = normalizeSearchKey(searchName);
  if (!key) return null;
  const list = loadJudgmentHistory();
  const hit = list.find(
    (r) => normalizeSearchKey(r.restaurantName) === key,
  );
  return hit ?? null;
}

export function loadJudgmentHistory(): JudgmentRecord[] {
  if (typeof window === "undefined") return [];
  purgeLegacyStorageKeys();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const list = data.filter(isRecord);
    return list.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  } catch {
    return [];
  }
}

export function appendJudgment(record: JudgmentRecord): JudgmentRecord[] {
  const prev = loadJudgmentHistory();
  const next = [record, ...prev.filter((r) => r.id !== record.id)].slice(
    0,
    MAX_ENTRIES,
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

/** id에 해당하는 판독 한 건을 이력에서 제거한다. 반환: 남은 이력(최신순) */
export function removeJudgmentById(id: string): JudgmentRecord[] {
  if (typeof window === "undefined") return [];
  purgeLegacyStorageKeys();
  const prev = loadJudgmentHistory();
  const next = prev.filter((r) => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function newJudgmentId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
