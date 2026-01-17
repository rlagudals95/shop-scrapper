export const PAGE_TYPE_DETECTION_PROMPT = `[System]
당신은 전자상거래 웹사이트 HTML 구조 분석 전문가입니다.

[Task]
주어진 HTML을 분석하여 페이지 유형을 판별하세요.

[Page Types]
1. LISTING: 여러 상품이 그리드/리스트로 나열된 페이지
   - 특징: 반복되는 상품 카드 구조, 썸네일 이미지 다수, 페이지네이션

2. PDP (Product Detail Page): 단일 상품 상세 페이지
   - 특징: 큰 상품 이미지, 상세 설명, 옵션 선택, 구매 버튼

[Output Format]
JSON만 출력하세요:
{
  "pageType": "LISTING" | "PDP",
  "confidence": 0.0-1.0,
  "reasoning": "판단 근거 한 줄"
}

[HTML]
{html}`;

export function buildPageTypePrompt(html: string): string {
  return PAGE_TYPE_DETECTION_PROMPT.replace('{html}', html);
}
