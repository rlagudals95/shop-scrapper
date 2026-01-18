/**
 * Site-specific Browser Client Interface
 *
 * 각 사이트별로 봇 탐지 우회 전략이 다르므로 사이트별 클라이언트를 구현
 * - Coupang: Akamai Bot Manager 우회 (Residential Proxy + Stealth)
 * - Naver: 기본 Stealth
 * - Brand Store: 사이트별 상이
 */

export interface PageResult {
  html: string;
  url: string;
  success: boolean;
  error?: string;
}

export interface BrowserClientConfig {
  headless?: boolean;
  proxy?: ProxyConfig;
  userDataDir?: string;
  viewport?: { width: number; height: number };
  locale?: string;
  timezoneId?: string;
}

export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

/**
 * 사이트별 브라우저 클라이언트 인터페이스
 */
export interface ISiteBrowserClient {
  /**
   * 클라이언트 초기화
   */
  initialize(config?: BrowserClientConfig): Promise<void>;

  /**
   * 검색 결과 페이지(Listing) HTML 가져오기
   * @param keyword 검색어
   * @returns 페이지 결과
   */
  getListingPage(keyword: string): Promise<PageResult>;

  /**
   * 상품 상세 페이지(PDP) HTML 가져오기
   * @param url 상품 URL
   * @returns 페이지 결과
   */
  getProductPage(url: string): Promise<PageResult>;

  /**
   * 브라우저 컨텍스트 정리
   */
  close(): Promise<void>;

  /**
   * 현재 IP 주소 확인 (프록시 동작 확인용)
   */
  getCurrentIP(): Promise<string | null>;

  /**
   * 지원하는 사이트 도메인 목록
   */
  getSupportedDomains(): string[];
}

/**
 * 사이트 타입
 */
export type SiteType = 'coupang' | 'naver' | 'naver-brand-store' | 'generic';
