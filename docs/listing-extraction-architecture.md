# Listing 페이지 XPath 추출 아키텍처

## 개요

LLM 기반으로 다양한 이커머스 사이트의 상품 목록을 추출하는 시스템입니다.
사이트별 하드코딩 없이 범용적으로 동작하며, 품질 검증과 캐시를 통해 안정성을 확보합니다.

> **Note**: 코드에서 `XPath`, `xpaths` 등의 명명이 남아있지만, 실제로는 **CSS 셀렉터**를 사용합니다.
> 초기 설계가 XPath 기반이었으나, Cheerio 라이브러리 호환성과 LLM 출력 안정성을 위해 CSS 셀렉터로 전환했습니다.

## XPath → CSS 셀렉터 전환 배경

### 전환 이유

| 항목 | XPath | CSS 셀렉터 |
|------|-------|-----------|
| Cheerio 지원 | 네이티브 미지원 (별도 패키지 필요) | 네이티브 지원 |
| LLM 출력 안정성 | 복잡한 문법, 오류 발생 빈번 | 간단한 문법, 일관된 출력 |
| 디버깅 | 읽기 어려움 | 직관적 |

### 문법 비교

```
XPath:  //div[contains(@class, 'product')]/a/div[contains(@class, 'name')]
CSS:    div[class*='product'] a div[class*='name']
```

### 하위 호환성

ExtractorService가 두 형식 모두 자동 감지하여 처리:

```typescript
// XPath 패턴 감지: //, ./, contains(@class), text()
const hasXPathPattern = /^\/\/|^\.\/|contains\(@|text\(\)/.test(selector);

if (isXPath) {
  // XPath → CSS 변환 (레거시 지원)
} else {
  // CSS 셀렉터 그대로 사용
}
```

## 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Listing 추출 Flow                               │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
  │ Raw HTML │────▶│ HtmlFilter   │────▶│ Analyzer     │────▶│ Extractor   │
  │          │     │ Service      │     │ Service      │     │ Service     │
  └──────────┘     └──────────────┘     └──────────────┘     └─────────────┘
                          │                    │                    │
                          ▼                    ▼                    ▼
                   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
                   │ 노이즈 제거  │     │ LLM 분석    │     │ CSS 셀렉터  │
                   │ - 스크립트   │     │ - Gemini    │     │ 기반 추출   │
                   │ - 스타일     │     │ - 프롬프트   │     │             │
                   │ - 광고 영역  │     │   최적화     │     │             │
                   └─────────────┘     └─────────────┘     └─────────────┘
                                              │
                                              ▼
                                       ┌─────────────┐
                                       │ XPath 캐시  │
                                       │ Repository  │
                                       └─────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           품질 검증 + 캐시 플로우                            │
└─────────────────────────────────────────────────────────────────────────────┘

          ┌─────────────────────────────────────────────────────────┐
          │                      1. 캐시 확인                        │
          │           xpathRepository.findByDomain(domain)           │
          └───────────────────────────┬─────────────────────────────┘
                                      │
                        ┌─────────────┴─────────────┐
                        ▼                           ▼
                  [캐시 있음]                  [캐시 없음]
                        │                           │
                        ▼                           │
          ┌─────────────────────────────┐           │
          │ 2. 캐시된 XPath로 추출       │           │
          │    + 결과 품질 검증          │           │
          └─────────────┬───────────────┘           │
                        │                           │
              ┌─────────┴─────────┐                 │
              ▼                   ▼                 │
         [검증 성공]         [검증 실패]             │
         (≥80% 유효)        (<80% 유효)             │
              │                   │                 │
              │                   ▼                 │
              │         ┌─────────────────┐         │
              │         │ 3. 캐시 무효화   │         │
              │         │    + feedback    │         │
              │         └────────┬────────┘         │
              │                  │                  │
              │                  └──────────┬───────┘
              │                             ▼
              │               ┌───────────────────────────┐
              │               │ 4. LLM으로 XPath 생성      │
              │               │    - feedback 포함        │
              │               │    - 최대 2회 재시도       │
              │               └─────────────┬─────────────┘
              │                             │
              │                    ┌────────┴────────┐
              │                    ▼                 ▼
              │               [검증 성공]        [검증 실패]
              │                    │                 │
              │                    ▼                 │
              │         ┌─────────────────┐          │
              │         │ 5. 캐시 저장     │          │
              │         └────────┬────────┘          │
              │                  │                   │
              └──────────────────┴───────────────────┘
                                 │
                                 ▼
                          최종 결과 반환
```

## 핵심 컴포넌트

### 1. HtmlFilterService

HTML에서 노이즈를 제거하고 상품 목록 영역만 추출합니다.

```typescript
// src/domain/services/html-filter.service.ts

filterForListing(html: string): FilterResult {
  // 1. 스크립트, 스타일, 주석 제거
  // 2. 상품 목록 영역 추출 (범용 패턴)
  // 3. 속성 정리 (불필요한 data-* 제거)
}
```

**범용 상품 영역 감지 패턴:**
```typescript
const productItemPatterns = [
  '[class*="product_item"]',
  '[class*="productItem"]',
  '[class*="product-item"]',
  '[class*="goods_item"]',
  'li[class*="product"]',
  'div[class*="ProductUnit"]',
];
```

### 2. AnalyzerService

LLM(Gemini)을 사용하여 HTML 구조를 분석하고 CSS 셀렉터를 생성합니다.

```typescript
// src/domain/services/analyzer.service.ts

analyzeWithKnownType(html: string, pageType: PageType, feedback?: string): Promise<AnalysisResult> {
  // 1. 프롬프트 생성 (피드백 포함)
  // 2. LLM 호출 (Gemini)
  // 3. 응답 파싱 및 정규화
}
```

**여러 셀렉터 지원:**
```typescript
// LLM이 반환하는 형식
{
  "price": {
    "selectors": ["[class*='priceValue']", "[class*='salePrice']"],
    "attribute": null
  }
}

// CSS OR 연산자로 병합
const combinedSelector = field.selectors.join(', ');
// 결과: "[class*='priceValue'], [class*='salePrice']"
```

### 3. ExtractorService

CSS 셀렉터를 사용하여 실제 데이터를 추출합니다.

```typescript
// src/domain/services/extractor.service.ts

extract(html: string, xpaths: XPathMap, pageType: PageType): ExtractedData {
  // 1. productCard 셀렉터로 상품 카드 선택
  // 2. 각 카드에서 name, price, url, thumbnail 추출
  // 3. URL 정규화 (상대 경로 → 절대 경로)
}

evaluateExtractionQuality(data: ListingData): ExtractionQuality {
  // 품질 평가
  // - validProducts: name + (price 또는 url) 있는 상품
  // - priceValidProducts: "10,630원" 형태의 실제 가격
  // - qualityScore: validProducts / totalProducts * 100
}
```

### 4. ValidatorService

추출 결과를 검증하고 LLM 재시도를 위한 피드백을 생성합니다.

```typescript
// src/domain/services/validator.service.ts

generateQualityFeedback(quality: ExtractionQuality, xpaths: XPathMap): string {
  // 문제점 분석 및 구체적 피드백 생성
  // - 가격 추출 실패 시: "할인율(%)이 아닌 최종 가격 요소를 선택하세요"
  // - 상품 수 부족 시: "더 많은 상품을 포함하는 컨테이너를 선택하세요"
}
```

## 품질 검증 기준

```typescript
interface ExtractionQuality {
  totalProducts: number;      // 총 추출 상품 수
  validProducts: number;      // 유효 상품 수 (name + price/url)
  priceValidProducts: number; // 가격 유효 상품 수
  qualityScore: number;       // 품질 점수 (%)
}

// 품질 통과 기준
const isAcceptable =
  totalProducts >= 5 &&           // 최소 5개 상품
  qualityScore >= 80 &&           // 80% 이상 유효
  priceValidProducts >= totalProducts * 0.5;  // 50% 이상 가격 유효
```

**가격 검증 패턴:**
```typescript
// 유효한 가격: "10,630원", "5,100원", "21,000"
const pricePattern = /^[\d,]+원?$/;

// 무효한 가격 (할인율): "29%", "44 %"
const discountPattern = /^\d+\s*%$/;
```

## 프롬프트 엔지니어링

### 핵심 프롬프트 지침

```
src/infrastructure/ai/prompts/xpath-generation.prompt.ts
```

**1. 여러 상품 타입 대응:**
```
### CRITICAL - Multiple selector patterns
- A page may have MULTIPLE product types with DIFFERENT HTML structures
- Use the "selectors" array to provide MULTIPLE selectors that cover ALL variants
- Example: "selectors": ["[class*='priceValue']", "[class*='salePrice']"]
```

**2. 셀렉터 견고성:**
```
### CRITICAL - Selector robustness
- AVOID direct child selectors (>) in field selectors
- BAD: "a > div[class*='productName']"
- GOOD: "div[class*='productName']"
```

**3. 필드 특이성:**
```
### CRITICAL - Field selector specificity
- name: 상품 제목만 포함하는 요소 (전체 카드 X)
- price: 최종 판매가만 포함하는 요소 (할인율, 원가 X)
```

## 데이터 흐름

### 입력 (Raw HTML)
```html
<li class="ProductUnit_productUnit__abc123">
  <a href="/products/123">
    <figure class="ProductUnit_productImage__def456">
      <img src="https://cdn.example.com/thumb.jpg">
    </figure>
    <div class="ProductUnit_productNameV2__ghi789">상품명</div>
    <div class="PriceArea_priceArea__jkl012">
      <strong class="Price_priceValue__mno345">10,630원</strong>
    </div>
  </a>
</li>
```

### LLM 분석 결과 (XPath Map)
```json
{
  "productCard": "li[class*='ProductUnit_productUnit__']",
  "name": "div[class*='ProductUnit_productNameV2__']",
  "price": "strong[class*='Price_priceValue__'], div[class*='fw-text-[20px]']",
  "url": "a/@href",
  "thumbnail": "figure[class*='ProductUnit_productImage__'] img/@src"
}
```

### 추출 결과
```json
{
  "products": [
    {
      "name": "상품명",
      "price": "10,630원",
      "url": "https://www.example.com/products/123",
      "thumbnail": "https://cdn.example.com/thumb.jpg"
    }
  ]
}
```

---

## 문제 해결 레슨

### 레슨 1: 할인율 vs 실제 가격 혼동

**문제:**
```
기대: "10,630원"
실제: "29%"
```

**원인:**
LLM이 할인율을 표시하는 요소를 가격으로 선택

**해결:**
1. 가격 검증 패턴 추가 (`/^[\d,]+원?$/`)
2. 프롬프트에 명시: "할인율(%)이 아닌 최종 가격 요소를 선택"
3. 품질 검증 시 `priceValidProducts` 별도 추적

### 레슨 2: 동일 페이지 내 다른 상품 구조

**문제:**
```
일반 검색 결과: fw-text-[20px] 클래스
위젯/추천 상품: Price_priceValue__ 클래스
→ 일부 상품만 가격 추출됨
```

**원인:**
LLM이 첫 번째 패턴만 반환, 다른 구조의 상품 누락

**해결:**
1. 프롬프트에 "Multiple selector patterns" 지침 추가
2. `selectors` 배열에 여러 패턴 허용
3. CSS OR 연산자(`,`)로 병합: `"[class*='priceValue'], [class*='salePrice']"`

```typescript
// 여러 셀렉터를 CSS OR 연산자로 연결
const combinedSelector = field.selectors.join(', ');
```

### 레슨 3: 캐시된 XPath 품질 저하

**문제:**
- 새로 생성한 XPath: 좋은 품질
- 캐시된 XPath: 나쁜 품질
- 동일한 HTML인데 결과가 다름

**원인:**
두 테스트가 독립적으로 LLM을 호출하여 다른 결과 생성

**해결:**
1. 캐시 저장 전 품질 검증 필수화
2. 품질 기준 미달 시 캐시 저장 안함
3. 캐시 사용 시에도 품질 재검증

```typescript
// 품질 검증 후 캐시 저장
const quality = extractorService.evaluateExtractionQuality(extracted);
if (quality.qualityScore >= 50) {
  await xpathRepository.upsert(domain, PageType.LISTING, xpaths);
}
```

### 레슨 4: 유틸리티 클래스 의존성

**문제:**
```
셀렉터: div[class*='fw-text-[20px]']
→ Tailwind 유틸리티 클래스, 스타일 변경 시 깨짐
```

**원인:**
LLM이 시맨틱 클래스보다 눈에 띄는 스타일 클래스 선택

**해결:**
프롬프트에 우선순위 명시:
```
- Prefer semantic class names (productName, price, title)
- AVOID utility/styling classes (fw-text-[20px], fw-font-bold)
```

### 레슨 5: "함께 본 상품" 위젯 오염

**문제:**
```
총 73개 상품 추출
- 58개: 정상 상품 (이름, 가격 있음)
- 15개: 빈 상품 (URL만 있음) ← "also_viewed" 위젯
```

**원인:**
productCard 셀렉터가 추천 위젯의 링크도 매칭

**해결:**
품질 검증에서 자동 필터링:
- `validProducts`: name이 있고 (price 또는 url)이 있는 상품만 카운트
- 빈 상품은 `qualityScore` 계산에서 유효하지 않은 것으로 처리

---

## 테스트 구조

```
test/unit/listing/listing-xpath-extraction.spec.ts
```

### 테스트 케이스

1. **LLM XPath 추출 테스트**
   - HTML 필터링 → LLM 분석 → 데이터 추출 → 품질 검증

2. **캐시 저장/재사용 테스트**
   - XPath 생성 → 품질 검증 → 캐시 저장 → 캐시 재사용 → 품질 재검증

3. **JSON-LD 데이터 검증 테스트**
   - JSON-LD 파싱 → 상품 데이터 추출 (API 키 불필요)

4. **다중 스토어 테스트** (describe.each)
   - 쿠팡, 네이버 등 여러 사이트에 동일 로직 적용

### 테스트 출력 파일

```
data/extracted/
├── coupang-xpath-listing-test.json        # XPath 추출 결과
├── coupang-xpath-cached-listing-test.json # 캐시된 XPath 추출 결과
├── coupang-jsonld-listing-test.json       # JSON-LD 추출 결과
├── naver-xpath-listing-test.json
└── naver-xpath-cached-listing-test.json
```

---

## 파일 구조

```
src/
├── domain/
│   ├── entities/
│   │   └── xpath-cache.entity.ts     # XPathMap, ListingXPathMap 정의
│   └── services/
│       ├── extractor.service.ts      # 데이터 추출 + 품질 평가
│       ├── analyzer.service.ts       # LLM 분석 + 응답 파싱
│       ├── validator.service.ts      # 검증 + 피드백 생성
│       └── html-filter.service.ts    # HTML 노이즈 제거
├── infrastructure/
│   ├── ai/
│   │   ├── prompts/
│   │   │   └── xpath-generation.prompt.ts  # LLM 프롬프트
│   │   └── gemini.client.ts          # Gemini API 클라이언트
│   └── persistence/
│       └── xpath-cache.repository.ts # XPath 캐시 저장소
└── application/
    └── services/
        └── crawler.service.ts        # 전체 크롤링 플로우 조율

test/
└── unit/
    ├── listing/
    │   └── listing-xpath-extraction.spec.ts  # 통합 테스트
    └── domain/
        └── extractor.service.spec.ts         # 단위 테스트
```

---

## 향후 개선 방향

1. **JSON-LD 폴백**: XPath 추출 실패 시 JSON-LD 데이터 사용
2. **재시도 루프 구현**: CrawlerService에서 품질 미달 시 LLM 재호출
3. **사이트별 프롬프트 힌트**: 특정 사이트 패턴 학습 후 프롬프트에 반영
4. **A/B 테스트**: 여러 LLM 모델 비교 (Gemini vs GPT vs Claude)
