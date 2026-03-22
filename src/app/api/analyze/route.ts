import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  GoogleGenerativeAIResponseError,
  SchemaType,
  type Schema,
} from "@google/generative-ai";
import { NextResponse } from "next/server";

import {
  normalizeConfirmResult,
  normalizeJudgmentResult,
} from "@/lib/analysis";

const QUOTA_ERROR_KO =
  "Google AI 호출 한도(무료 할당량)에 걸렸어요. 1~2분 뒤 다시 시도하거나, AI Studio에서 요금·한도를 확인해 주세요. 확률 단계는 GEMINI_MODEL, 위치 확인은 GEMINI_MODEL_CONFIRM을 gemini-2.5-flash·gemini-2.5-flash-lite 등으로 낮춰 보세요.";

const AUTH_ERROR_KO =
  "API 키가 거절되었거나 이 모델을 쓸 권한이 없어요. GOOGLE_GENERATIVE_AI_API_KEY와 GEMINI_MODEL·GEMINI_MODEL_CONFIRM을 확인해 주세요.";

const MODEL_NOT_FOUND_KO =
  "지정한 모델을 찾을 수 없습니다. AI Studio 문서의 최신 모델명으로 GEMINI_MODEL(확률)·GEMINI_MODEL_CONFIRM(위치 확인)을 설정해 주세요. (예: gemini-2.5-pro / gemini-2.5-flash-lite)";

const BLOCKED_RESPONSE_KO =
  "안전 필터·정책으로 응답이 비어 있거나 차단되었습니다. 표현을 바꿔 다시 시도해 보세요.";

const BAD_REQUEST_KO =
  "요청 형식이 모델에서 거절되었습니다. GEMINI_MODEL 또는 GEMINI_MODEL_CONFIRM을 바꾸거나 잠시 후 다시 시도해 주세요.";

const GENERIC_GEMINI_ERROR_KO =
  "AI 분석을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";

function mapGeminiFailure(err: unknown): { message: string; httpStatus: number } {
  if (err instanceof GoogleGenerativeAIResponseError) {
    return { message: BLOCKED_RESPONSE_KO, httpStatus: 502 };
  }
  if (err instanceof GoogleGenerativeAIFetchError) {
    if (err.status === 429) {
      return { message: QUOTA_ERROR_KO, httpStatus: 429 };
    }
    if (err.status === 401 || err.status === 403) {
      return { message: AUTH_ERROR_KO, httpStatus: 502 };
    }
    if (err.status === 404) {
      return { message: MODEL_NOT_FOUND_KO, httpStatus: 502 };
    }
    if (err.status === 400) {
      return { message: BAD_REQUEST_KO, httpStatus: 502 };
    }
  }
  const text = err instanceof Error ? err.message : String(err);
  if (/429|Too Many Requests|quota exceeded|RESOURCE_EXHAUSTED/i.test(text)) {
    return { message: QUOTA_ERROR_KO, httpStatus: 429 };
  }
  if (/401|403|API key|permission denied/i.test(text)) {
    return { message: AUTH_ERROR_KO, httpStatus: 502 };
  }
  if (/\[404\b|not found|is not found|was not found/i.test(text)) {
    return { message: MODEL_NOT_FOUND_KO, httpStatus: 502 };
  }
  if (/blocked|safety|SAFETY|finishReason/i.test(text)) {
    return { message: BLOCKED_RESPONSE_KO, httpStatus: 502 };
  }
  return { message: GENERIC_GEMINI_ERROR_KO, httpStatus: 502 };
}

export const maxDuration = 60;

const confirmSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    exists: {
      type: SchemaType.BOOLEAN,
      description:
        "검색어가 실제로 있을 법한 음식점·가게로 식별되는지. 심한 오타·허구·무의미한 문자·식당이 아닌 것으로 보이면 false",
    },
    location: {
      type: SchemaType.STRING,
      description:
        "exists true: 반드시 시·구(또는 시·군)까지 포함한 행정구역. 예: 서울 마포구, 대전 유성구, 부산 해운대구. 광역만(강남만 등) 쓰지 말고 구·군명까지. false면 하이픈 하나 \"-\"",
    },
    dong: {
      type: SchemaType.STRING,
      description:
        "exists true: 읍·면·동 단위 이름(목동, 연남동, 가락동 등). 반드시 ~동·~읍·~면 접미사 포함. 특정 불가면 빈 문자열. false면 \"-\"",
    },
    venueType: {
      type: SchemaType.STRING,
      description:
        "exists true: 업종·형태(한식당, 중식당, 쌀국수 전문점, 오마카세 전문점, 베이커리 등). false면 \"-\"",
    },
    displayName: {
      type: SchemaType.STRING,
      description:
        "exists true: 간판·알려진 정식 상호 전체. 검색어가 줄임·별칭(예: 뚜쥬루)이면 전체 상호(예: 뚜쥬루과자점)로. 검색어가 이미 정식이면 동일하게. false면 \"-\"",
    },
    notice: {
      type: SchemaType.STRING,
      description:
        "exists false일 때 사용자에게 보여줄 한 줄 한국어. exists true면 빈 문자열",
    },
  },
  required: ["exists", "location", "dong", "venueType", "displayName", "notice"],
};

const responseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    exists: {
      type: SchemaType.BOOLEAN,
      description:
        "검색어가 실제로 있을 법한 음식점·가게로 식별되는지. 심한 오타·허구·무의미한 문자·식당이 아닌 것으로 보이면 false",
    },
    probability: {
      type: SchemaType.INTEGER,
      description:
        "exists가 true일 때만 맛집일 확률 0~100. exists가 false면 반드시 0",
    },
    location: {
      type: SchemaType.STRING,
      description:
        "exists true: 시·구(또는 시·군)까지 포함한 위치. 예: 서울 마포구. false면 하이픈 하나 \"-\"",
    },
    dong: {
      type: SchemaType.STRING,
      description:
        "exists true: 읍·면·동(목동, 연남동 등). 불명이면 빈 문자열. false면 \"-\"",
    },
    venueType: {
      type: SchemaType.STRING,
      description:
        "exists true: 업종(한식당 등). false면 \"-\"",
    },
    displayName: {
      type: SchemaType.STRING,
      description:
        "exists true: 정식 상호 전체(확률·결과 문장에 쓸 이름). 검색어가 줄임말이면 전체 상호로. false면 \"-\"",
    },
    notice: {
      type: SchemaType.STRING,
      description:
        "exists false일 때 사용자에게 보여줄 한 줄 한국어(예: 그런 식당은 없는 것 같아). exists true면 빈 문자열",
    },
  },
  required: [
    "exists",
    "probability",
    "location",
    "dong",
    "venueType",
    "displayName",
    "notice",
  ],
};

const SYSTEM_PROMPT_CONFIRM = `너는 한국 음식점 검색을 돕는 분석가다. 실시간 인터넷 검색은 할 수 없다. 공개적으로 알려진 일반 지식으로만 판단한다.

검색어(가게 이름 또는 지역+이름)를 보고, 실제로 있을 법한 음식점·가게인지 판별한다.
- exists true일 때 location(위치) 규칙: 사용자가 시·구(또는 시·군) 단위로 헷갈리지 않게 반드시 구체적으로 쓴다.
  · 형식: "광역시·도(또는 특별시) + 구·군·시" 수준까지. 예: 서울 마포구, 대전 유성구, 부산 해운대구, 경기 성남시 분당구, 제주 서귀포시.
  · "강남", "홍대"처럼 광역만 쓰지 말고 가능하면 서울 강남구, 서울 마포구처럼 구·군명을 넣는다. 유명 별칭만 알면 행정구역으로 환산해 적는다.
  · 세종·울산 등은 해당 시·군·구 단위로 맞춘다.
- exists true일 때 dong: 법정동·행정동 등 읍·면·동 이름(예: 목동, 신월동, 연남동). 알려진 바가 있으면 반드시 채우고, 구체적 동을 특정할 수 없을 때만 빈 문자열.
- exists true일 때 venueType: 한식당, 중식당, 쌀국수 전문점, 오마카세 전문점, 베이커리, 이자카야 등 구체적으로.
- exists true일 때 displayName: 간판에 가까운 정식 상호 전체. 검색어가 짧은 별칭·줄임(예: 뚜쥬루, 성심)이면 일반적으로 알려진 전체 상호(예: 뚜쥬루과자점, 성심당)로 적는다. 검색어가 이미 정식이면 그대로 복사해도 된다.
- exists false면: location·dong·venueType·displayName은 반드시 "-", notice에 짧은 한국어 안내를 넣는다.

맛집 확률은 이 단계에서 계산하지 않는다. 반드시 JSON 한 개만 출력한다. 필드: exists, location, dong, venueType, displayName, notice. exists true일 때 notice는 빈 문자열.`;

const SYSTEM_PROMPT = `너는 깐깐한 맛집 판독가야. 광고성 리뷰, 억텐 리뷰를 잡아내고, 업력과 위치를 고려해서 수학적으로 이 식당이 진짜 맛집일 확률을 0~100 사이 정수로만 계산해.

실시간 인터넷 검색은 할 수 없다. 식당 이름·지역·업종 등 공개적으로 알려진 일반 지식과 위 신호들을 바탕으로 합리적으로 추정한다.

[긍정 신호 — 있으면 확률을 올릴 근거]
- 여러 번 방문한 사람의 리뷰가 많다
- 웨이팅이 극악이다
- 현지인에게 유명하다
- 서비스 불만 리뷰가 있어도 맛을 욕하진 않는다
- 가게 이름이 이상하다(입소문 위주의 숨은 맛집 톤으로 해석 가능)

[부정 신호 — 있으면 확률을 내릴 근거]
- 업력·저명성에 비해 지나치게 많은 리뷰(리뷰 이벤트, 체험단, 리뷰 작업 의심)
- 특정 메뉴 추천이나 가족 회식 등 특수 목적에 맞는 가게임을 과하게 어필
- 지나치게 성의 있는 리뷰가 많음(찐 리뷰는 본인 기록용으로 남기는 경우가 많다)
- 리뷰 멘트가 억텐이다
- 임대료가 지나치게 높을 것 같은 접근성·상권(비용 상승으로 식재료에 투자하기 힘들 수 있다는 수학적 의심)

exists가 false면 probability는 0, location·dong·venueType·displayName은 \"-\", notice에 짧은 안내 문장을 넣어라.

exists true일 때 location은 시·구(또는 시·군)까지, dong은 읍·면·동(목동 등)까지 가능하면 채운다. 동을 특정하기 어렵면 dong은 빈 문자열. displayName은 정식 상호 전체(검색어가 줄임말이면 전체 상호로).

반드시 JSON 한 개만 출력한다. 필드: exists, probability, location, dong, venueType, displayName, notice. exists true일 때 notice는 빈 문자열.`;

async function generateStructuredJson(
  apiKey: string,
  modelName: string,
  schema: Schema,
  systemInstruction: string,
  userText: string,
  temperature = 0.45,
): Promise<unknown> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
      responseSchema: schema,
    },
    systemInstruction,
  });
  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [{ text: userText }],
      },
    ],
  });
  const text = result.response.text();
  return JSON.parse(text) as unknown;
}

export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "서버에 GOOGLE_GENERATIVE_AI_API_KEY가 설정되지 않았습니다. .env.local을 확인하세요.",
      },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 JSON 본문입니다." }, { status: 400 });
  }

  const name =
    body &&
    typeof body === "object" &&
    "restaurantName" in body &&
    typeof (body as { restaurantName: unknown }).restaurantName === "string"
      ? (body as { restaurantName: string }).restaurantName.trim()
      : "";

  if (!name || name.length > 200) {
    return NextResponse.json(
      { error: "식당 이름을 1~200자로 보내 주세요." },
      { status: 400 },
    );
  }

  const phase =
    body &&
    typeof body === "object" &&
    (body as { phase?: unknown }).phase === "score"
      ? "score"
      : "confirm";

  /* confirm: 위치·상호만 구조화 → 가볍고 빠른 모델. score: 맛집 확률 → 품질 우선 모델 */
  const confirmModelName =
    process.env.GEMINI_MODEL_CONFIRM?.trim() || "gemini-2.5-flash-lite";
  const scoreModelName =
    process.env.GEMINI_MODEL?.trim() || "gemini-2.5-pro";

  try {
    if (phase === "confirm") {
      const userText = `검색어(식당 이름만 또는 지역+식당 이름): "${name}"\n위 검색어가 가리키는 음식점이 실제로 있을 법하면 exists true로 두고, location·dong·venueType을 채우고, displayName에는 간판에 가까운 정식 상호 전체를 넣는다(검색어가 줄임·별칭이면 전체 상호로). 그렇지 않으면 exists false와 notice를 채워 JSON만 출력하라.`;
      let parsed: unknown;
      try {
        parsed = await generateStructuredJson(
          apiKey,
          confirmModelName,
          confirmSchema,
          SYSTEM_PROMPT_CONFIRM,
          userText,
          0.4,
        );
      } catch (parseErr) {
        if (parseErr instanceof SyntaxError) {
          return NextResponse.json(
            { error: "모델 응답 JSON 파싱에 실패했습니다." },
            { status: 502 },
          );
        }
        throw parseErr;
      }
      const normalized = normalizeConfirmResult(parsed);
      if (!normalized) {
        return NextResponse.json(
          { error: "모델 응답 형식이 올바르지 않습니다." },
          { status: 502 },
        );
      }
      return NextResponse.json({ phase: "confirm", ...normalized });
    }

    const ctxRaw =
      body &&
      typeof body === "object" &&
      "scoreContext" in body
        ? (body as { scoreContext: unknown }).scoreContext
        : null;
    if (!ctxRaw || typeof ctxRaw !== "object") {
      return NextResponse.json(
        { error: "score 단계에는 scoreContext 객체가 필요합니다." },
        { status: 400 },
      );
    }
    const ctx = ctxRaw as Record<string, unknown>;
    const confirmedLocation =
      typeof ctx.confirmedLocation === "string"
        ? ctx.confirmedLocation.trim()
        : "";
    const confirmedVenueType =
      typeof ctx.confirmedVenueType === "string"
        ? ctx.confirmedVenueType.trim()
        : "";
    const userAddedLocationNote =
      typeof ctx.userAddedLocationNote === "string"
        ? ctx.userAddedLocationNote.trim()
        : "";
    const confirmedDong =
      typeof ctx.confirmedDong === "string" ? ctx.confirmedDong.trim() : "";
    const confirmedDisplayName =
      typeof ctx.confirmedDisplayName === "string"
        ? ctx.confirmedDisplayName.trim()
        : "";

    if (confirmedLocation.length > 200 || confirmedVenueType.length > 120) {
      return NextResponse.json(
        { error: "위치·업종 정보가 너무 깁니다." },
        { status: 400 },
      );
    }
    if (userAddedLocationNote.length > 400) {
      return NextResponse.json(
        { error: "위치 보정 내용은 400자 이내로 보내 주세요." },
        { status: 400 },
      );
    }
    if (confirmedDong.length > 40) {
      return NextResponse.json(
        { error: "동(읍·면) 정보가 너무 깁니다." },
        { status: 400 },
      );
    }
    if (confirmedDisplayName.length > 120) {
      return NextResponse.json(
        { error: "상호 정보가 너무 깁니다." },
        { status: 400 },
      );
    }
    const scoreUserText =
      userAddedLocationNote.length > 0
        ? `원 검색어: "${name}"
확인 단계 정식 상호 추정: "${confirmedDisplayName || name}"
처음 추정 위치: "${confirmedLocation || "불명"}"
처음 추정 동(읍·면·동): "${confirmedDong || "(없음)"}"
처음 추정 업종: "${confirmedVenueType || "불명"}"
사용자가 실제 위치·정정 정보를 다음과 같이 알려줬다: "${userAddedLocationNote}"
이 정보를 모두 반영해 어떤 음식점을 가리키는지 특정한 뒤, 맛집일 확률(0~100)·최종 location·dong·venueType·displayName(정식 상호 전체)을 JSON으로 출력하라. 실제 음식점으로 특정할 수 없으면 exists false.`
        : `원 검색어: "${name}"
사용자가 아래 위치·동·업종이 맞다고 확인했다. 이 전제를 우선하되, 검색어·상식과 명백히 모순이면 exists false로 처리할 수 있다.
정식 상호(확인 단계 추정): "${confirmedDisplayName || name}"
위치(시·구): "${confirmedLocation || "지역 미상"}"
동(읍·면·동): "${confirmedDong || "(사용자 확인 없음, 추정 가능하면 채울 것)"}"
업종: "${confirmedVenueType || "음식점"}"
exists true면 맛집일 확률(0~100)과 location·dong·venueType·displayName을 채운다. displayName은 결과 화면에 쓸 정식 상호 전체로, 검색어가 줄임말이면 전체 상호로 다듬는다. 문장 표기가 "서울 양천구 목동에 위치한" 형태가 되도록 location에는 시·구만, dong에는 목동 같은 동 이름만 넣는다.`;

    let parsed: unknown;
    try {
      parsed = await generateStructuredJson(
        apiKey,
        scoreModelName,
        responseSchema,
        SYSTEM_PROMPT,
        scoreUserText,
        0.55,
      );
    } catch (parseErr) {
      if (parseErr instanceof SyntaxError) {
        return NextResponse.json(
          { error: "모델 응답 JSON 파싱에 실패했습니다." },
          { status: 502 },
        );
      }
      throw parseErr;
    }

    const normalized = normalizeJudgmentResult(parsed);
    if (!normalized) {
      return NextResponse.json(
        { error: "모델 응답 형식이 올바르지 않습니다." },
        { status: 502 },
      );
    }

    return NextResponse.json({ phase: "score", ...normalized });
  } catch (err) {
    const { message, httpStatus } = mapGeminiFailure(err);
    return NextResponse.json({ error: message }, { status: httpStatus });
  }
}
