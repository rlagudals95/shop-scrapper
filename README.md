# AI 기반 자가 복구 크롤링 프레임워크

전자상거래 사이트의 HTML 구조 변경에 자동으로 대응하는 "스마트 자가 복구(Smartly Self-recovering)" 크롤러입니다. Google Gemini AI를 활용하여 XPath를 자동 생성하고 관리합니다.

## 목차

- [프로젝트 개요](#프로젝트-개요)
- [아키텍처](#아키텍처)
- [기술 스택](#기술-스택)
- [프로젝트 구조](#프로젝트-구조)
- [설치 및 실행](#설치-및-실행)
- [CLI 사용법](#cli-사용법)
- [핵심 로직 설명](#핵심-로직-설명)
- [테스트](#테스트)
- [확장 가이드](#확장-가이드)

---

## 프로젝트 개요

### 해결하려는 문제

전자상거래 사이트는 빈번하게 HTML 구조를 변경합니다. 기존 크롤러는 이런 변경이 발생할 때마다 수동으로 XPath를 수정해야 했습니다.

### 솔루션

AI가 페이지 구조를 분석하여 XPath를 자동 생성하고, 추출 실패 시 자동으로 재분석하여 복구합니다.

```
[크롤링 요청] → [캐시 확인] → [데이터 추출] → [검증]
                    ↓              ↓           ↓
               캐시 없음        추출 실패    검증 실패
                    ↓              ↓           ↓
              [AI 분석] ←─────────┴───────────┘
                    ↓
              [캐시 저장] → [재시도]
```

---

## 아키텍처

### 레이어드 아키텍처 (Layered Architecture)

NestJS의 모듈 시스템을 활용한 4계층 구조입니다.

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│                      (CLI Commands)                          │
│         crawl.command / list.command / cache.command         │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    Application Layer                         │
│                     (Use Cases)                              │
│                    CrawlerService                            │
│            - 복구 루프 오케스트레이션                          │
│            - 재시도 전략 관리                                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                      Domain Layer                            │
│                   (Business Logic)                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │ Extractor   │ │ Validator   │ │  Analyzer   │            │
│  │  Service    │ │  Service    │ │   Service   │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
│        │               │               │                     │
│  ┌─────▼───────────────▼───────────────▼─────┐              │
│  │           Interfaces (Ports)              │              │
│  │  IXPathRepository / IBrowserClient / IAi  │              │
│  └───────────────────────────────────────────┘              │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                  Infrastructure Layer                        │
│                  (External Adapters)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Database │  │ Browser  │  │    AI    │  │  Config  │    │
│  │ (SQLite) │  │(Playwright)│ │ (Gemini) │  │          │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 의존성 방향

- **상위 레이어 → 하위 레이어** (단방향)
- **Domain Layer는 Infrastructure에 의존하지 않음** (인터페이스를 통한 역전)

```typescript
// Domain Layer에서 정의한 인터페이스
interface IXPathRepository {
  findByDomain(domain: string, pageType: PageType): Promise<XPathCache | null>;
  upsert(domain: string, pageType: PageType, xpaths: XPathMap): Promise<XPathCache>;
}

// Infrastructure Layer에서 구현
@Injectable()
class XPathCacheRepository implements IXPathRepository {
  // TypeORM을 사용한 구현
}

// NestJS DI를 통한 주입
{
  provide: INJECTION_TOKENS.XPATH_REPOSITORY,
  useExisting: XPathCacheRepository,
}
```

---

## 기술 스택

| 구분 | 기술 | 선택 이유 |
|------|------|----------|
| 런타임 | Node.js + TypeScript | 요구사항 필수, 타입 안정성 |
| 프레임워크 | NestJS | DI 컨테이너, 모듈화, 테스트 용이 |
| 크롤링 | Playwright | 안정성, 멀티 브라우저, TS 지원 |
| AI | Google Gemini | 요구사항 명시, 비용 효율적 |
| 데이터베이스 | SQLite (TypeORM) | 서버 불필요, 이식성 |
| CLI | nest-commander | NestJS 통합, DI 활용 가능 |
| 테스트 | Jest | NestJS 기본, Mock 지원 |

---

## 프로젝트 구조

```
commerce-crawler/
├── src/
│   ├── main.ts                          # CLI 엔트리포인트
│   ├── app.module.ts                    # 루트 모듈
│   │
│   ├── common/                          # 공통 유틸리티
│   │   ├── constants/
│   │   │   └── injection-tokens.ts      # DI 토큰 정의
│   │   ├── exceptions/
│   │   │   ├── crawl.exception.ts       # 크롤링 관련 예외
│   │   │   └── validation.exception.ts  # 검증 관련 예외
│   │   └── utils/
│   │       └── logger.ts                # 로거 및 유틸 함수
│   │
│   ├── domain/                          # 도메인 레이어
│   │   ├── entities/                    # 도메인 엔티티
│   │   │   ├── page-type.enum.ts        # LISTING | PDP
│   │   │   ├── xpath-cache.entity.ts    # XPath 캐시 타입
│   │   │   └── product.entity.ts        # 추출 데이터 타입
│   │   ├── interfaces/                  # 포트 (추상화)
│   │   │   ├── xpath-repository.interface.ts
│   │   │   ├── browser-client.interface.ts
│   │   │   └── ai-client.interface.ts
│   │   └── services/                    # 비즈니스 로직
│   │       ├── extractor.service.ts     # XPath로 데이터 추출
│   │       ├── validator.service.ts     # 추출 데이터 검증
│   │       └── analyzer.service.ts      # AI 분석 로직
│   │
│   ├── infrastructure/                  # 인프라 레이어
│   │   ├── config/                      # 환경 설정
│   │   ├── database/                    # SQLite + TypeORM
│   │   │   ├── entities/
│   │   │   │   └── xpath-cache.orm-entity.ts
│   │   │   └── repositories/
│   │   │       └── xpath-cache.repository.ts
│   │   ├── browser/                     # Playwright 클라이언트
│   │   │   └── playwright.client.ts
│   │   └── ai/                          # Gemini 클라이언트
│   │       ├── gemini.client.ts
│   │       └── prompts/                 # AI 프롬프트
│   │           ├── page-type.prompt.ts
│   │           └── xpath-generation.prompt.ts
│   │
│   ├── application/                     # 애플리케이션 레이어
│   │   ├── dto/                         # 데이터 전송 객체
│   │   │   ├── crawl-request.dto.ts
│   │   │   └── crawl-result.dto.ts
│   │   └── services/
│   │       └── crawler.service.ts       # 메인 유스케이스
│   │
│   └── presentation/                    # 프레젠테이션 레이어
│       └── cli/
│           └── commands/
│               ├── crawl.command.ts     # 단일 URL 크롤링
│               ├── list.command.ts      # 목록 페이지 크롤링
│               └── cache.command.ts     # 캐시 관리
│
├── test/
│   ├── unit/                            # 단위 테스트
│   ├── integration/                     # 통합 테스트
│   ├── fixtures/                        # 테스트용 HTML
│   └── mocks/                           # Mock 객체
│
├── .env                                 # 환경 변수 (gitignore)
├── env.example                          # 환경 변수 예시
├── package.json
└── tsconfig.json
```

---

## 설치 및 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

```bash
cp env.example .env
```

`.env` 파일을 열고 Gemini API 키를 설정합니다:

```env
GEMINI_API_KEY=your_gemini_api_key_here
DATABASE_PATH=./data/crawler.db
```

### 3. Playwright 브라우저 설치

```bash
npx playwright install chromium
```

### 4. 빌드

```bash
npm run build
```

### 5. 실행

```bash
# 개발 모드
npm run start:dev

# 빌드 후 실행
npm run start:prod
```

---

## CLI 사용법

### 단일 URL 크롤링 (PDP/Listing 자동 감지)

```bash
npx commerce-crawler crawl <url> [options]

# 예시
npx commerce-crawler crawl https://www.coupang.com/vp/products/123456
npx commerce-crawler crawl https://www.coupang.com/np/search?q=laptop

# 옵션
-t, --type <type>   페이지 타입 지정 (listing | pdp)
-f, --force         캐시 무시하고 AI 재분석
-j, --json          JSON 형식 출력
```

### 목록 페이지 크롤링

```bash
npx commerce-crawler list <url> [options]

# 예시
npx commerce-crawler list https://www.coupang.com/np/search?q=laptop
npx commerce-crawler list https://www.coupang.com/np/search?q=laptop --limit 10

# 옵션
-l, --limit <n>     출력할 상품 수 제한
-j, --json          JSON 형식 출력
```

### 캐시 관리

```bash
# 캐시 목록 조회
npx commerce-crawler cache --list

# 특정 사이트 캐시 삭제
npx commerce-crawler cache --clear --site coupang.com

# 전체 캐시 삭제
npx commerce-crawler cache --clear-all
```

---

## 핵심 로직 설명

### 1. 스마트 복구 루프 (CrawlerService)

프로젝트의 핵심 로직으로, 크롤링 실패 시 자동 복구를 수행합니다.

```typescript
// src/application/services/crawler.service.ts

async crawl(request: CrawlRequestDto): Promise<CrawlResult> {
  while (retryCount <= maxRetries) {
    // 1. 캐시 확인
    const cached = await xpathRepository.findByDomain(domain, pageType);

    // 2. HTML 가져오기
    const html = await browserClient.getPageContent(url);

    // 3. XPath 결정 (캐시 or AI 분석)
    if (cached && retryCount === 0) {
      xpaths = cached.xpaths;  // 캐시 사용
    } else {
      xpaths = await analyzerService.analyze(html);  // AI 분석
      await xpathRepository.upsert(domain, pageType, xpaths);
    }

    // 4. 데이터 추출
    const data = extractorService.extract(html, xpaths, pageType);

    // 5. 검증
    const validation = validatorService.validate(data, pageType);

    if (validation.isValid) {
      return { success: true, data };
    }

    // 6. 검증 실패 → 캐시 무효화 후 재시도
    await xpathRepository.invalidate(domain, pageType);
    retryCount++;
  }

  return { success: false, error: 'Max retries exceeded' };
}
```

### 2. AI 분석 (AnalyzerService)

Gemini AI를 사용하여 HTML을 분석하고 XPath를 생성합니다.

```typescript
// src/domain/services/analyzer.service.ts

async analyze(html: string): Promise<AnalyzerResult> {
  // 1. HTML 전처리 (토큰 절약)
  const simplified = this.simplifyHtml(html);

  // 2. 페이지 타입 감지
  const pageType = await this.detectPageType(simplified);

  // 3. XPath 생성
  const xpaths = await this.generateXPaths(simplified, pageType);

  return { pageType, xpaths, confidence };
}
```

**프롬프트 구조**:
- `page-type.prompt.ts`: LISTING vs PDP 판별
- `xpath-generation.prompt.ts`: 필드별 XPath 생성

### 3. 데이터 검증 (ValidatorService)

추출된 데이터의 유효성을 검사하고, 복구 트리거 여부를 결정합니다.

```typescript
// src/domain/services/validator.service.ts

// Listing 검증 규칙
const listingProductRules = [
  { field: 'name', required: true, type: 'string', minLength: 1 },
  { field: 'price', required: true, type: 'string', pattern: /[\d,]+/ },
  { field: 'url', required: true, type: 'string' },
];

// PDP 검증 규칙
const pdpRules = [
  { field: 'productName', required: true, type: 'string', minLength: 1 },
  { field: 'price', required: true, type: 'string', pattern: /[\d,]+/ },
  { field: 'brandName', required: false, type: 'string' },
];
```

### 4. 데이터 추출 (ExtractorService)

XPath를 CSS 셀렉터로 변환하여 Cheerio로 데이터를 추출합니다.

```typescript
// src/domain/services/extractor.service.ts

// XPath → CSS 셀렉터 변환
private xpathToSelector(xpath: string): string {
  return xpath
    .replace(/^\/\//, '')
    .replace(/\[contains\(@class,\s*['"]([^'"]+)['"]\)\]/g, '.$1')
    .replace(/\[@class=['"]([^'"]+)['"]\]/g, '.$1')
    .replace(/\//g, ' ');
}
```

---

## 테스트

### 테스트 실행

```bash
# 전체 테스트
npm test

# 단위 테스트만
npm run test:unit

# 통합 테스트만
npm run test:integration

# 커버리지 리포트
npm run test:cov

# Watch 모드
npm run test:watch
```

### 테스트 구조

```
test/
├── unit/
│   ├── domain/
│   │   ├── extractor.service.spec.ts   # 데이터 추출 테스트
│   │   └── validator.service.spec.ts   # 데이터 검증 테스트
│   └── infrastructure/
│       └── xpath-cache.repository.spec.ts  # 캐시 저장소 테스트
├── integration/
│   └── crawler.service.spec.ts         # 복구 루프 통합 테스트
├── fixtures/
│   ├── coupang-listing.html            # 목록 페이지 샘플
│   └── coupang-pdp.html                # 상세 페이지 샘플
└── mocks/
    ├── gemini.mock.ts                  # AI 클라이언트 Mock
    └── browser.mock.ts                 # 브라우저 클라이언트 Mock
```

### Mock 사용 예시

```typescript
// test/mocks/gemini.mock.ts
export class MockGeminiClient implements IAiClient {
  async generate(prompt: string): Promise<AiResponse> {
    if (prompt.includes('페이지 유형을 판별')) {
      return {
        content: JSON.stringify({
          pageType: 'LISTING',
          confidence: 0.95,
        }),
      };
    }
    // ...
  }
}
```

---

## 확장 가이드

### 새로운 추출 필드 추가

1. **엔티티 수정**: `src/domain/entities/product.entity.ts`
2. **검증 규칙 추가**: `src/domain/services/validator.service.ts`
3. **프롬프트 수정**: `src/infrastructure/ai/prompts/xpath-generation.prompt.ts`

### 새로운 사이트 지원

별도 코드 수정 없이 AI가 자동으로 분석합니다. 다만 특수한 구조의 사이트는 프롬프트 튜닝이 필요할 수 있습니다.

### 새로운 저장소 추가 (예: Redis)

1. `IXPathRepository` 인터페이스 구현
2. 새로운 모듈 생성
3. DI 토큰 변경

```typescript
// src/infrastructure/redis/redis-cache.repository.ts
@Injectable()
export class RedisCacheRepository implements IXPathRepository {
  // Redis 구현
}

// 모듈에서 교체
{
  provide: INJECTION_TOKENS.XPATH_REPOSITORY,
  useClass: RedisCacheRepository,  // 변경
}
```

---

## 주의사항

1. **Rate Limiting**: 크롤링 대상 사이트의 정책을 준수하세요
2. **User-Agent**: 실제 브라우저와 유사한 헤더가 기본 설정되어 있습니다
3. **API 비용**: Gemini API 호출 시 토큰 비용이 발생합니다
4. **로그인 페이지**: 현재 버전은 로그인 필요 페이지를 지원하지 않습니다

---

## 라이선스

MIT License
