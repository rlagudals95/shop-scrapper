import { Page } from 'playwright';
import * as path from 'path';
import { BaseBrowserClient } from './base-browser.client';
import { BrowserClientConfig, PageResult } from './browser-client.interface';

/**
 * Coupang Browser Client
 *
 * Akamai Bot Manager 우회 전략:
 * 1. Residential Proxy (한국 가정용 IP)
 * 2. Stealth 스크립트 (navigator.webdriver 등)
 * 3. 자연스러운 트래픽 흐름 (네이버 → 쿠팡)
 * 4. 검색창 직접 타이핑 (URL 직접 접근 대신)
 * 5. JS 챌린지 재시도 로직
 */
export class CoupangBrowserClient extends BaseBrowserClient {
  private static readonly SUPPORTED_DOMAINS = ['coupang.com', 'www.coupang.com'];

  getSupportedDomains(): string[] {
    return CoupangBrowserClient.SUPPORTED_DOMAINS;
  }

  protected getDefaultConfig(): BrowserClientConfig {
    return {
      headless: false,
      viewport: { width: 1920, height: 1080 },
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      userDataDir: path.join(process.cwd(), 'data', 'browser-profile-coupang'),
      proxy: BaseBrowserClient.createBrightDataProxy(),
    };
  }

  /**
   * 쿠팡 검색 결과 페이지(Listing) 가져오기
   *
   * 전략:
   * 1. 네이버에서 '쿠팡' 검색 후 쿠팡 링크 클릭 (자연스러운 유입)
   * 2. 쿠팡 메인 페이지에서 JS 챌린지 통과 대기
   * 3. 검색창에 키워드 타이핑 후 검색
   * 4. 검색 결과 페이지 JS 챌린지 통과 대기
   */
  async getListingPage(keyword: string): Promise<PageResult> {
    if (!this.context) {
      return {
        html: '',
        url: '',
        success: false,
        error: 'Browser context not initialized. Call initialize() first.',
      };
    }

    let mainPage: Page | null = null;
    let searchPage: Page | null = null;

    try {
      // Step 1: 네이버에서 쿠팡 검색
      mainPage = await this.context.newPage();
      const coupangUrl = await this.findCoupangViaNaverSearch(mainPage);

      // Step 2: 쿠팡 메인 페이지 접근
      searchPage = await this.context.newPage();
      const mainResult = await this.navigateToCoupangMain(searchPage, coupangUrl);

      if (!mainResult.success) {
        return {
          html: mainResult.html,
          url: searchPage.url(),
          success: false,
          error: 'Failed to load Coupang main page',
        };
      }

      // Step 3: 검색창에서 검색
      const searchResult = await this.searchViaSearchBox(searchPage, keyword);

      // HTML 저장
      if (searchResult.success) {
        this.saveHtml(searchResult.html, 'coupang-listing');
      }

      return {
        html: searchResult.html,
        url: searchPage.url(),
        success: searchResult.success,
        error: searchResult.success ? undefined : 'Search result page blocked',
      };
    } catch (error) {
      return {
        html: '',
        url: searchPage?.url() || '',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await mainPage?.close().catch(() => {});
      await searchPage?.close().catch(() => {});
    }
  }

  /**
   * 쿠팡 상품 상세 페이지(PDP) 가져오기
   */
  async getProductPage(url: string): Promise<PageResult> {
    if (!this.context) {
      return {
        html: '',
        url: '',
        success: false,
        error: 'Browser context not initialized. Call initialize() first.',
      };
    }

    let page: Page | null = null;

    try {
      page = await this.context.newPage();

      // 먼저 쿠팡 메인으로 이동 (세션 설정)
      const mainResult = await this.navigateToCoupangMain(page, 'https://www.coupang.com');
      if (!mainResult.success) {
        return {
          html: mainResult.html,
          url: page.url(),
          success: false,
          error: 'Failed to establish Coupang session',
        };
      }

      // PDP로 이동
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.randomDelay(3000, 5000);

      // JS 챌린지 대기
      const result = await this.waitForJsChallenge(page, {
        maxAttempts: 6,
        intervalMs: 5000,
        minHtmlLength: 5000,
      });

      if (result.success) {
        this.saveHtml(result.html, 'coupang-pdp');
      }

      return {
        html: result.html,
        url: page.url(),
        success: result.success,
        error: result.success ? undefined : 'PDP page blocked',
      };
    } catch (error) {
      return {
        html: '',
        url: page?.url() || url,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await page?.close().catch(() => {});
    }
  }

  /**
   * 네이버에서 쿠팡 검색하여 링크 찾기
   */
  private async findCoupangViaNaverSearch(page: Page): Promise<string> {
    // 네이버 방문
    await page.goto('https://www.naver.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await this.randomDelay(2000, 3000);

    // 쿠팡 검색
    await page.locator('input[name="query"]').fill('쿠팡');
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await this.randomDelay(2000, 3000);

    // 쿠팡 링크 찾기
    const allLinks = page.locator('a');
    const linkCount = await allLinks.count();

    for (let i = 0; i < linkCount; i++) {
      const href = await allLinks.nth(i).getAttribute('href');
      if (href && (href.includes('coupang.com') || href.includes('ader.naver.com'))) {
        const text = await allLinks.nth(i).textContent();
        if (text?.includes('쿠팡')) {
          return href;
        }
      }
    }

    // 기본값
    return 'https://www.coupang.com';
  }

  /**
   * 쿠팡 메인 페이지로 이동 및 JS 챌린지 통과
   */
  private async navigateToCoupangMain(
    page: Page,
    url: string,
  ): Promise<{ html: string; success: boolean }> {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
      // 네비게이션 에러는 무시 (JS 리다이렉트 등)
    }

    // JS 챌린지 통과 대기 - 더 긴 대기 시간
    const result = await this.waitForJsChallenge(page, {
      maxAttempts: 8,
      intervalMs: 5000,
      minHtmlLength: 5000,
    });

    return result;
  }

  /**
   * 검색창을 통한 검색
   */
  private async searchViaSearchBox(
    page: Page,
    keyword: string,
  ): Promise<{ html: string; success: boolean }> {
    try {
      // 검색창 찾기
      const searchInput = page.locator(
        'input.headerSearchKeyword, input[name="q"], input.SearchBox-input',
      );
      await searchInput.first().waitFor({ state: 'visible', timeout: 10000 });

      // 검색창 클릭
      await searchInput.first().click();
      await this.randomDelay(500, 1000);

      // 자연스러운 타이핑
      await this.naturalType(page, keyword);
      await this.randomDelay(1000, 1500);

      // Enter 키로 검색
      await page.keyboard.press('Enter');

      // 페이지 로드 대기
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
      await this.randomDelay(5000, 8000);

      // JS 챌린지 통과 대기
      return await this.waitForJsChallenge(page, {
        maxAttempts: 6,
        intervalMs: 5000,
        minHtmlLength: 5000,
      });
    } catch (e) {
      // 검색창 실패 시 URL 직접 접근 (폴백)
      const searchQuery = encodeURIComponent(keyword);
      const searchUrl = `https://www.coupang.com/np/search?component=&q=${searchQuery}&channel=user`;

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.randomDelay(10000, 15000);

      return await this.waitForJsChallenge(page, {
        maxAttempts: 6,
        intervalMs: 5000,
        minHtmlLength: 5000,
      });
    }
  }

  /**
   * Residential Proxy가 설정되어 있는지 확인
   */
  hasProxy(): boolean {
    return !!this.config.proxy;
  }

  /**
   * Proxy 없이 초기화 (테스트용)
   */
  static async createWithoutProxy(
    config?: Partial<BrowserClientConfig>,
  ): Promise<CoupangBrowserClient> {
    const client = new CoupangBrowserClient();
    await client.initialize({
      ...config,
      proxy: undefined,
    });
    return client;
  }

  /**
   * Proxy와 함께 초기화
   */
  static async createWithProxy(
    config?: Partial<BrowserClientConfig>,
  ): Promise<CoupangBrowserClient> {
    const client = new CoupangBrowserClient();
    const proxy = BaseBrowserClient.createBrightDataProxy();

    if (!proxy) {
      throw new Error('BRIGHT_DATA_API_KEY environment variable is required for proxy');
    }

    await client.initialize({
      ...config,
      proxy,
    });
    return client;
  }
}
