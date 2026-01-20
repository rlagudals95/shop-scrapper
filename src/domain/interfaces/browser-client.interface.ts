/**
 * Site-specific configuration for anti-bot bypass
 */
export interface SiteConfig {
  /** URL to visit first for cookie warmup (e.g., homepage) */
  warmupUrl?: string;
  /** Intermediate URL to visit before target page (e.g., search results page) */
  intermediateUrl?: string;
  /** Whether to use search flow (warmup → intermediate → target) for product pages */
  useSearchFlow?: boolean;
  /** Extra delay in milliseconds after page load (site-specific) */
  extraDelay?: number;
  /** Custom referer header */
  referer?: string;
  /** Whether to simulate more human-like behavior */
  enhancedHumanBehavior?: boolean;
  /** Minimum delay between actions (ms) */
  minDelay?: number;
  /** Maximum delay between actions (ms) */
  maxDelay?: number;
  /** 네이버에서 검색할 키워드 (예: "쿠팡") */
  naverSearchKeyword?: string;
  /** 쿠팡 내에서 검색할 상품 키워드 (변수로 받음) */
  productSearchKeyword?: string;
}

/**
 * Pre-configured site settings for known e-commerce sites
 */
export const SITE_CONFIGS: Record<string, SiteConfig> = {
  'coupang.com': {
    warmupUrl: 'https://www.coupang.com', // 쿠키 워밍업을 위한 메인 페이지 방문
    intermediateUrl: 'https://www.coupang.com/np/search?component=&q=%ED%97%A4%EC%96%B4%EB%B0%B4%EB%93%9C', // 검색 결과 페이지
    useSearchFlow: true, // 상세 페이지 접근 시 검색 플로우 사용
    extraDelay: 15000, // 페이지 로드 후 추가 대기 (15초)
    referer: 'https://www.coupang.com/np/search?component=&q=%ED%97%A4%EC%96%B4%EB%B0%B4%EB%93%9C',
    enhancedHumanBehavior: true,
    minDelay: 10000, // 최소 10초 대기
    maxDelay: 20000, // 최대 20초 대기
    naverSearchKeyword: '쿠팡', // 네이버에서 검색할 키워드
    productSearchKeyword: '헤어밴드', // 기본 상품 검색 키워드 (옵션)
  },
  'naver.com': {
    warmupUrl: 'https://shopping.naver.com',
    extraDelay: 1000,
    referer: 'https://shopping.naver.com/',
    enhancedHumanBehavior: false,
    minDelay: 1000,
    maxDelay: 3000,
  },
};

export interface ProxyConfig {
  /** Proxy server URL (e.g., 'http://proxy.example.com:8080') */
  server: string;
  /** Optional username for proxy authentication */
  username?: string;
  /** Optional password for proxy authentication */
  password?: string;
}

export interface FetchOptions {
  /** Timeout in milliseconds */
  timeout?: number;
  /** Force headful mode (visible browser window) */
  headful?: boolean;
  /** Site-specific configuration for anti-bot bypass */
  siteConfig?: SiteConfig;
  /** Skip cookie warmup even if siteConfig specifies it */
  skipWarmup?: boolean;
  /** Proxy configuration for requests */
  proxy?: ProxyConfig;
  /** 쿠팡 내에서 검색할 상품 키워드 (동적으로 설정 가능) */
  productSearchKeyword?: string;
  /** Enable automatic fallback to Playwright when HTTP fetch fails */
  autoFallback?: boolean;
}

export interface FetchResult {
  html: string;
  /** Whether Playwright was used */
  usedPlaywright: boolean;
  /** Content length in bytes */
  contentLength: number;
  /** Whether the response appears to be blocked */
  blocked?: boolean;
}

/**
 * 쿠팡 검색 결과 (리스트 페이지)
 */
export interface CoupangSearchResult {
  /** 검색 결과 HTML */
  html: string;
  /** 검색된 상품 링크들 */
  productLinks: string[];
  /** 차단 여부 */
  blocked: boolean;
}

/**
 * 쿠팡 상품 상세 정보 (JSON 데이터)
 */
export interface CoupangProductDetail {
  /** 상품 HTML */
  html: string;
  /** exports.sdp JSON 데이터 (파싱된 상태) */
  sdpData?: Record<string, unknown>;
  /** 원본 JSON 문자열 */
  sdpRawJson?: string;
  /** 차단 여부 */
  blocked: boolean;
}

/**
 * 쿠팡 Vendor Item API 결과
 */
export interface CoupangVendorItemResult {
  /** API JSON 응답 */
  data: Record<string, unknown> | null;
  /** 원본 JSON 문자열 */
  rawJson?: string;
  /** 에러 메시지 */
  error?: string;
  /** 디버깅용 페이지 HTML */
  pageHtml?: string;
}

export interface IBrowserClient {
  /**
   * Get page content using simple HTTP fetch first, fallback to Playwright if needed
   * @param url Target URL
   * @param options Fetch options
   */
  getPageContent(url: string, options?: FetchOptions): Promise<string>;

  /**
   * Get page content with detailed result information
   * @param url Target URL
   * @param options Fetch options
   */
  getPageContentWithInfo(url: string, options?: FetchOptions): Promise<FetchResult>;

  /**
   * Close browser resources
   */
  close(): Promise<void>;
}

/**
 * 사이트별 브라우저 클라이언트 결과
 */
export interface SiteFetchResult {
  /** 페이지 HTML */
  html: string;
  /** 최종 URL */
  url: string;
  /** 성공 여부 */
  success: boolean;
  /** 에러 메시지 */
  error?: string;
  /** 차단 여부 */
  blocked?: boolean;
}

/**
 * 사이트별 브라우저 클라이언트 인터페이스
 *
 * 사이트마다 봇 탐지 우회 전략이 다르므로 사이트별 구현 필요:
 * - Coupang: Akamai Bot Manager 우회 (Residential Proxy + Stealth)
 * - Naver: 기본 Stealth
 * - Brand Store: 사이트별 상이
 */
export interface ISiteBrowserClient {
  /**
   * 클라이언트 초기화
   */
  initialize(): Promise<void>;

  /**
   * 검색 결과 페이지(Listing) HTML 가져오기
   * @param keyword 검색어 (예: "헤어밴드", "갤럭시25 자급제")
   * @returns 페이지 결과
   */
  getListingPage(keyword: string): Promise<SiteFetchResult>;

  /**
   * 상품 상세 페이지(PDP) HTML 가져오기
   * @param url 상품 URL
   * @returns 페이지 결과
   */
  getProductPage(url: string): Promise<SiteFetchResult>;

  /**
   * 브라우저 컨텍스트 정리
   */
  close(): Promise<void>;

  /**
   * 지원하는 사이트 도메인 목록
   */
  getSupportedDomains(): string[];
}

/**
 * 사이트 타입
 */
export type SiteType = 'coupang' | 'naver' | 'naver-brand-store' | 'generic';
