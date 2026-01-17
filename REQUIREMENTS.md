# AI 기반 크롤링 프레임워크 구현 (AI based Crawling framework)

# 프로젝트 개요 (Project Overview)

AI를 활용하여 전자상거래 사이트의 HTML 구조 변경(Listing, PDP)에 자동으로 대응하고 XPath를 관리하는 "스마트 자가 복구(Smartly Self-recovering)" 크롤러를 개발합니다. 목표는 사이트 구조 변경 시 수동으로 코드를 수정하는 비용을 제거하는 것입니다.

# 기술 스택 (Tech Stack)

- **언어 (Language):** TypeScript (필수)
- **크롤링 프레임워크:** 개발팀 자율 선택 (예: Puppeteer, Playwright 등)
- **AI 모델:** Google Gemini (Credit 활용 권장)

# 주요 기능 요구사항 (Functional Requirements)

### 1. 페이지 유형 인식 (Page Type Recognition)

대다수 커머스 사이트의 공통적인 구조(Uniformity Assumption)를 기반으로 페이지를 식별합니다.

- **목록 페이지 (Listing Page):** 썸네일이 포함된 다수의 상품 목록 구조 식별
- **상품 상세 페이지 (PDP):** 다음 주요 정보가 포함된 구조 식별
    - 브랜드명 (Brand Name)
    - 상품명 (Product Name)
    - 상품 설명 (Description)
    - 옵션 (Options)
    - 가격 (Price)
    - 상세 이미지 (Detail Images)

### 2. 스마트 캐싱 및 복구 루프 (Smart Caching & Recovery Loop)

크롤러는 다음 로직에 따라 동작해야 합니다.

1. **캐시 확인 (Check Cache):** 대상 사이트/페이지에 대한 XPath가 존재하는지 확인합니다.
2. **데이터 추출 시도 (Attempt Extraction):** 캐시된 XPath를 사용하여 데이터 추출을 시도합니다.
3. **유효성 검증 및 트리거 (Validation & Trigger):** 다음 실패 조건 발생 시 **재분석(Re-analysis)** 단계로 진입합니다.
    - **필수 데이터 누락:** 주요 필드 값이 `null`이거나 비어있는 경우
    - **에러 발생:** HTTP 에러 또는 DOM 접근 오류 발생 시
    - **데이터 패턴 불일치:** 추출된 데이터가 기존 형식을 크게 벗어나는 경우
4. **AI 재분석 및 업데이트 (AI Analysis & Update):**
    - Gemini를 호출하여 변경된 페이지의 정적 HTML을 분석합니다.
    - 새로운 XPath를 생성하여 캐시(DB)를 갱신합니다.
    - *참고: 현재 단계에서 동적 렌더링(SPA) 처리는 제외합니다.*
5. **재시도 (Retry):** 갱신된 XPath로 데이터 추출을 재시도합니다.

### 3. 관리 및 운영 (Management)

- **상태 관리:** 별도의 관리자 대시보드(UI) 없이 **로그 파일** 또는 **데이터베이스** 수준에서 XPath 및 크롤링 상태를 관리합니다.
- **버전 관리:** XPath의 이력(History) 관리는 불필요하며, 항상 최신 상태를 유지합니다.

# 대상 사이트 범위 (Target Scope)

- 쿠팡 (Coupang)
- 네이버 쇼핑 (Naver Shopping)
- 개별 브랜드 스토어 (Private Brand Shops)