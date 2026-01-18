/**
 * Stealth level for bot detection bypass
 * - none: No stealth measures (fastest, for testing)
 * - basic: Standard stealth plugin (current default)
 * - full: Maximum stealth with additional anti-detection measures
 */
export enum StealthLevel {
  NONE = 'none',
  BASIC = 'basic',
  FULL = 'full',
}

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
}

/**
 * Pre-configured site settings for known e-commerce sites
 */
export const SITE_CONFIGS: Record<string, SiteConfig> = {
  'coupang.com': {
    warmupUrl: 'https://www.coupang.com', // 쿠키 워밍업을 위한 메인 페이지 방문
    intermediateUrl: 'https://www.coupang.com/np/search?component=&q=%ED%97%A4%EC%96%B4%EB%B0%B4%EB%93%9C', // 검색 결과 페이지
    useSearchFlow: true, // 상세 페이지 접근 시 검색 플로우 사용
    extraDelay: 5000,
    referer: 'https://www.coupang.com/np/search?component=&q=%ED%97%A4%EC%96%B4%EB%B0%B4%EB%93%9C',
    enhancedHumanBehavior: true,
    minDelay: 5000,
    maxDelay: 10000,
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

export interface FetchOptions {
  /** Use Playwright instead of simple HTTP fetch */
  forcePlaywright?: boolean;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Stealth level for bot detection bypass */
  stealthLevel?: StealthLevel;
  /** Force headful mode (visible browser window) */
  headful?: boolean;
  /** Automatically fallback to Playwright if HTTP fetch fails (default: false) */
  autoFallback?: boolean;
  /** Site-specific configuration for anti-bot bypass */
  siteConfig?: SiteConfig;
  /** Skip cookie warmup even if siteConfig specifies it */
  skipWarmup?: boolean;
}

export interface FetchResult {
  html: string;
  /** Whether Playwright was used (fallback from HTTP) */
  usedPlaywright: boolean;
  /** Content length in bytes */
  contentLength: number;
  /** Stealth level used */
  stealthLevel?: StealthLevel;
  /** Whether the response appears to be blocked */
  blocked?: boolean;
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
