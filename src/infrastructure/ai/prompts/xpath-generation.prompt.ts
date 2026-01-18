export const LISTING_XPATH_PROMPT = `당신은 웹 스크래핑 전문가입니다. 주어진 HTML에서 상품 목록을 추출하기 위한 XPath를 생성해야 합니다.

## 작업
아래 HTML을 분석하여 상품 정보를 추출할 수 있는 **실제 XPath**를 생성하세요.
HTML의 실제 클래스명과 구조를 분석하여 정확한 XPath를 작성해야 합니다.

## 추출할 필드
- productCard: 개별 상품을 감싸는 컨테이너 요소 (반복되는 상품 카드)
- thumbnail: 상품 이미지 URL (src 또는 data-src 속성)
- name: 상품명 텍스트
- price: 가격 텍스트
- url: 상품 상세 페이지 링크 (href 속성)

## XPath 작성 규칙
1. HTML에서 실제로 존재하는 클래스명과 태그를 사용하세요
2. 동적 클래스(해시 포함)는 contains() 함수 사용: [contains(@class, 'product')]
3. productCard는 절대 경로로, 나머지는 상대 경로(.//로 시작)로 작성
4. 속성 추출시: /@src, /@href, /@data-src 등 사용

## 응답 형식
반드시 아래 JSON 형식으로만 응답하세요. 다른 설명 없이 JSON만 출력:

\`\`\`json
{
  "productCard": "실제_xpath_여기에",
  "thumbnail": "실제_xpath_여기에",
  "name": "실제_xpath_여기에",
  "price": "실제_xpath_여기에",
  "url": "실제_xpath_여기에"
}
\`\`\`

{feedback}

## 분석할 HTML
{html}`;

export const PDP_XPATH_PROMPT = `당신은 웹 스크래핑 전문가입니다. 주어진 상품 상세 페이지(PDP) HTML에서 상품 정보를 추출하기 위한 XPath를 생성해야 합니다.

## 작업
아래 HTML을 분석하여 상품 상세 정보를 추출할 수 있는 **실제 XPath**를 생성하세요.
HTML의 실제 클래스명, ID, 구조를 분석하여 정확한 XPath를 작성해야 합니다.

## 추출할 필드
- productName: 상품명 (필수) - 페이지에서 가장 눈에 띄는 상품 제목
- price: 가격 (필수) - 할인가 또는 판매가
- brandName: 브랜드명 (선택) - 없으면 빈 문자열 ""
- description: 상품 설명 (선택) - 없으면 빈 문자열 ""
- options: 옵션 선택 요소들 (선택) - 색상, 사이즈 등
- detailImages: 상세 이미지들의 src 속성 (선택)

## XPath 작성 규칙
1. HTML에서 **실제로 존재하는** 클래스명, ID, 태그를 사용하세요
2. 동적 클래스(해시 포함)는 contains() 사용: [contains(@class, 'price')]
3. 텍스트 추출: 태그 자체를 선택하면 텍스트 추출됨 (text() 불필요)
4. 속성 추출: /@src, /@href 등
5. 찾을 수 없는 필드는 빈 문자열 "" 반환

## 중요
- 예제 XPath를 복사하지 말고 HTML을 실제로 분석하세요
- 클래스명이 해시를 포함하면 (예: price_abc123) contains() 사용
- JSON 형식 외에 다른 텍스트를 출력하지 마세요

## 응답 형식
반드시 아래 JSON 형식으로만 응답하세요:

\`\`\`json
{
  "productName": "실제_xpath_여기에",
  "price": "실제_xpath_여기에",
  "brandName": "실제_xpath_또는_빈문자열",
  "description": "실제_xpath_또는_빈문자열",
  "options": "실제_xpath_또는_빈문자열",
  "detailImages": "실제_xpath_또는_빈문자열"
}
\`\`\`

{feedback}

## 분석할 HTML
{html}`;

export function buildListingXPathPrompt(html: string, feedback?: string): string {
  return LISTING_XPATH_PROMPT
    .replace('{html}', html)
    .replace('{feedback}', feedback ? `\n## 이전 시도 실패 원인\n${feedback}\n위 문제를 수정하여 새로운 XPath를 생성하세요.\n` : '');
}

export function buildPDPXPathPrompt(html: string, feedback?: string): string {
  return PDP_XPATH_PROMPT
    .replace('{html}', html)
    .replace('{feedback}', feedback ? `\n## 이전 시도 실패 원인\n${feedback}\n위 문제를 수정하여 새로운 XPath를 생성하세요.\n` : '');
}
