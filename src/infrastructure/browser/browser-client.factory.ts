import {
  ISiteBrowserClient,
  SiteType,
  BrowserClientConfig,
} from './browser-client.interface';
import { CoupangBrowserClient } from './coupang-browser.client';

/**
 * Browser Client Factory
 *
 * URL 또는 사이트 타입에 따라 적절한 클라이언트를 생성
 */
export class BrowserClientFactory {
  private static readonly DOMAIN_TO_SITE_TYPE: Record<string, SiteType> = {
    'coupang.com': 'coupang',
    'www.coupang.com': 'coupang',
    'shopping.naver.com': 'naver',
    'smartstore.naver.com': 'naver-brand-store',
    'brand.naver.com': 'naver-brand-store',
  };

  /**
   * URL에서 사이트 타입 추론
   */
  static getSiteTypeFromUrl(url: string): SiteType {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      // 정확한 도메인 매칭
      if (this.DOMAIN_TO_SITE_TYPE[hostname]) {
        return this.DOMAIN_TO_SITE_TYPE[hostname];
      }

      // 부분 매칭
      for (const [domain, siteType] of Object.entries(this.DOMAIN_TO_SITE_TYPE)) {
        if (hostname.includes(domain) || hostname.endsWith(domain)) {
          return siteType;
        }
      }

      return 'generic';
    } catch {
      return 'generic';
    }
  }

  /**
   * 사이트 타입에 맞는 클라이언트 생성
   */
  static async create(
    siteType: SiteType,
    config?: BrowserClientConfig,
  ): Promise<ISiteBrowserClient> {
    switch (siteType) {
      case 'coupang':
        const coupangClient = new CoupangBrowserClient();
        await coupangClient.initialize(config);
        return coupangClient;

      case 'naver':
        // TODO: NaverBrowserClient 구현 후 교체
        throw new Error('NaverBrowserClient not implemented yet');

      case 'naver-brand-store':
        // TODO: NaverBrandStoreBrowserClient 구현 후 교체
        throw new Error('NaverBrandStoreBrowserClient not implemented yet');

      case 'generic':
      default:
        // TODO: GenericBrowserClient 구현 후 교체
        throw new Error('GenericBrowserClient not implemented yet');
    }
  }

  /**
   * URL에서 자동으로 적절한 클라이언트 생성
   */
  static async createFromUrl(
    url: string,
    config?: BrowserClientConfig,
  ): Promise<ISiteBrowserClient> {
    const siteType = this.getSiteTypeFromUrl(url);
    return this.create(siteType, config);
  }

  /**
   * 쿠팡 전용 클라이언트 생성 (Proxy 포함)
   */
  static async createCoupangClient(
    config?: BrowserClientConfig,
  ): Promise<CoupangBrowserClient> {
    return CoupangBrowserClient.createWithProxy(config);
  }

  /**
   * 쿠팡 전용 클라이언트 생성 (Proxy 없음, 테스트용)
   */
  static async createCoupangClientWithoutProxy(
    config?: BrowserClientConfig,
  ): Promise<CoupangBrowserClient> {
    return CoupangBrowserClient.createWithoutProxy(config);
  }

  /**
   * 지원하는 사이트 타입 목록
   */
  static getSupportedSiteTypes(): SiteType[] {
    return ['coupang', 'naver', 'naver-brand-store', 'generic'];
  }

  /**
   * 구현된 사이트 타입 목록
   */
  static getImplementedSiteTypes(): SiteType[] {
    return ['coupang'];
  }

  /**
   * 특정 사이트 타입이 구현되어 있는지 확인
   */
  static isImplemented(siteType: SiteType): boolean {
    return this.getImplementedSiteTypes().includes(siteType);
  }
}
