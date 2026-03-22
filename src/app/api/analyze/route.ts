import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  GoogleGenerativeAIResponseError,
  SchemaType,
  type Schema,
} from "@google/generative-ai";
import { NextResponse } from "next/server";

import { normalizeJudgmentResult } from "@/lib/analysis";

const QUOTA_ERROR_KO =
  "Google AI 호출 한도(무료 할당량)에 걸렸어요. 1~2분 뒤 다시 시도하거나, AI Studio에서 요금·한도를 확인해 주세요. .env.local의 GEMINI_MODEL을 gemini-2.5-flash·gemini-2.0-flash 등으로 바꿔 보세요.";

const AUTH_ERROR_KO =
  "API 키가 거절되었거나 이 모델을 쓸 권한이 없어요. GOOGLE_GENERATIVE_AI_API_KEY와 GEMINI_MODEL을 확인해 주세요.";

const MODEL_NOT_FOUND_KO =
  "지정한 모델을 찾을 수 없습니다. AI Studio 문서의 최신 모델명으로 GEMINI_MODEL을 설정해 주세요. (예: gemini-2.5-flash)";

const BLOCKED_RESPONSE_KO =
  "안전 필터·정책으로 응답이 비어 있거나 차단되었습니다. 표현을 바꿔 다시 시도해 보세요.";

const BAD_REQUEST_KO =
  "요청 형식이 모델에서 거절되었습니다. GEMINI_MODEL을 바꾸거나 잠시 후 다시 시도해 주세요.";

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

const responseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    probability: {
      type: SchemaType.INTEGER,
      description: "진짜 맛집일 것으로 추정하는 확률, 0~100 정수",
    },
    location: {
      type: SchemaType.STRING,
      description:
        "대략적 위치·권역 한 줄(예: 서울 강남, 부산 해운대). 불명확하면 지역 미상",
    },
    venueType: {
      type: SchemaType.STRING,
      description:
        "짧은 업종·형태(예: 한식당, 중식당, 쌀국수 전문점, 오마카세 전문점, 파스타 전문점, 카페, 이자카야)",
    },
  },
  required: ["probability", "location", "venueType"],
};

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

반드시 JSON 한 개만 출력한다. 필드는 probability(0~100 정수), location(위치·권역 짧게), venueType(업종·형태 짧게) 셋뿐이다. 설명 문장·근거 나열은 출력하지 마라.`;

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

  /* 기본: Lite(가볍고 한도 여유인 경우가 많음). 바꾸려면 .env.local → GEMINI_MODEL=gemini-2.5-flash */
  const modelName =
    process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: 0.55,
        responseMimeType: "application/json",
        responseSchema,
      },
      systemInstruction: SYSTEM_PROMPT,
    });

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `검색어(식당 이름만 또는 지역+식당 이름): "${name}"\n위 가게를 가리키는 것으로 해석하고, probability·location·venueType을 담은 JSON만 출력하라.`,
            },
          ],
        },
      ],
    });

    const text = result.response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json(
        { error: "모델 응답 JSON 파싱에 실패했습니다." },
        { status: 502 },
      );
    }

    const normalized = normalizeJudgmentResult(parsed);
    if (!normalized) {
      return NextResponse.json(
        { error: "모델 응답 형식이 올바르지 않습니다." },
        { status: 502 },
      );
    }

    return NextResponse.json(normalized);
  } catch (err) {
    const { message, httpStatus } = mapGeminiFailure(err);
    return NextResponse.json({ error: message }, { status: httpStatus });
  }
}
