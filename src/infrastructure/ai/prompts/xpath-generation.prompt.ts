export const LISTING_XPATH_PROMPT = `[System]
당신은 XPath 전문가입니다. 전자상거래 목록 페이지에서 상품 정보를 추출하는 XPath를 생성합니다.

[Task]
HTML에서 각 상품의 정보를 추출할 수 있는 XPath를 생성하세요.

[Required Fields]
1. productCard: 개별 상품 카드를 감싸는 컨테이너 (반복 단위)
2. thumbnail: 상품 썸네일 이미지 URL (src 또는 data-src)
3. name: 상품명 텍스트
4. price: 가격 텍스트
5. url: 상품 상세 페이지 링크 (href)

[XPath Guidelines]
- 가능한 구체적인 XPath 사용 (id, class 활용)
- 동적 클래스명(hash 포함)은 contains() 사용
- 상대 경로 사용 (.//로 시작)
- productCard 기준 상대 XPath로 나머지 필드 작성

[Output Format]
JSON만 출력:
{
  "productCard": "//div[contains(@class, 'product-item')]",
  "thumbnail": ".//img/@src",
  "name": ".//a[contains(@class, 'name')]/text()",
  "price": ".//span[contains(@class, 'price')]/text()",
  "url": ".//a/@href"
}

{feedback}

[HTML]
{html}`;

export const PDP_XPATH_PROMPT = `[System]
당신은 XPath 전문가입니다. 전자상거래 상품 상세 페이지에서 정보를 추출하는 XPath를 생성합니다.

[Task]
HTML에서 상품 상세 정보를 추출할 수 있는 XPath를 생성하세요.

[Required Fields]
1. brandName: 브랜드명 (없으면 null 허용)
2. productName: 상품명 (필수)
3. price: 가격 (필수)
4. description: 상품 설명
5. options: 옵션 목록 (색상, 사이즈 등)
6. detailImages: 상세 이미지 URL 목록

[XPath Guidelines]
- 절대 경로 또는 id 기반 XPath 선호
- 텍스트 추출: /text() 또는 string()
- 다중 요소: 복수형 XPath
- 속성 추출: /@src, /@href 등

[Output Format]
JSON만 출력:
{
  "brandName": "//span[@class='brand']/text()" | null,
  "productName": "//h1[@class='product-title']/text()",
  "price": "//span[@class='price']/text()",
  "description": "//div[@class='description']",
  "options": "//select[@class='option']/option/text()",
  "detailImages": "//div[@class='detail-images']//img/@src"
}

{feedback}

[HTML]
{html}`;

export function buildListingXPathPrompt(html: string, feedback?: string): string {
  return LISTING_XPATH_PROMPT
    .replace('{html}', html)
    .replace('{feedback}', feedback ? `\n[Previous Error Feedback]\n${feedback}\n` : '');
}

export function buildPDPXPathPrompt(html: string, feedback?: string): string {
  return PDP_XPATH_PROMPT
    .replace('{html}', html)
    .replace('{feedback}', feedback ? `\n[Previous Error Feedback]\n${feedback}\n` : '');
}
